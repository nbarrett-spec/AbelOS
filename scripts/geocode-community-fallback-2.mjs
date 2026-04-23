#!/usr/bin/env node
/**
 * Phase 2 of community-fallback geocoding.
 *
 * Prerequisite: run `geocode-community-fallback.mjs --apply` first so the
 * Community table has latitude / longitude populated.
 *
 * Purpose: close the active-Job geocoding gap (~500 rows) by borrowing
 * community-level coordinates, with no more Nominatim calls.
 *
 * Passes (each only touches rows still missing lat/lng):
 *   A) Jobs with communityId NOT NULL -> copy Community.lat/lng directly.
 *   B) Jobs with Job.community text -> fuzzy-match to Community.name (ILIKE
 *      both directions), take a match when it's unambiguous.
 *   C) Jobs where jobAddress contains a known Community.name as substring.
 *   D) Neighbor-average: group already-geocoded jobs by Job.community text,
 *      average lat/lng, and stamp the ungeocoded siblings with that average.
 *      This is the big lever — Community only has ~10 rows, but Job.community
 *      has ~40 distinct active values, and most of those already have 5-15
 *      sibling jobs already geocoded by the prior Nominatim pass.
 *
 * Scope: ACTIVE jobs only (same status list as geocode-active-jobs.mjs), to
 * match the stated 475/878 gap in the brief.
 *
 * Usage:
 *   node scripts/geocode-community-fallback-2.mjs            # dry run (default)
 *   node scripts/geocode-community-fallback-2.mjs --apply    # write to DB
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
const dbUrl = readFileSync(envPath, 'utf-8').match(/DATABASE_URL="([^"]+)"/)?.[1]
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1) }

const APPLY = process.argv.includes('--apply')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

const ACTIVE_STATUSES = [
  'CREATED','READINESS_CHECK','MATERIALS_LOCKED','IN_PRODUCTION','STAGED',
  'LOADED','IN_TRANSIT','DELIVERED','INSTALLING','PUNCH_LIST'
]
const STATUS_LIST = ACTIVE_STATUSES.map(s => `'${s}'`).join(',')

async function countMissing() {
  const r = await sql.query(`
    SELECT COUNT(*)::int AS n FROM "Job"
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND status::text IN (${STATUS_LIST})
  `)
  return r[0].n
}
async function countTotal() {
  const r = await sql.query(`
    SELECT COUNT(*)::int AS n FROM "Job"
    WHERE status::text IN (${STATUS_LIST})
  `)
  return r[0].n
}

async function communitiesWithCoords() {
  // Safe even if columns don't exist yet — we query columns dynamically.
  const cols = await sql.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Community'`
  )
  const names = cols.map(c => c.column_name)
  if (!names.includes('latitude') || !names.includes('longitude')) {
    console.log('NOTE: Community table has no latitude / longitude columns yet.')
    console.log('      Run `node scripts/geocode-community-fallback.mjs --apply` first.')
    return []
  }
  return sql.query(`
    SELECT id, name, latitude, longitude
    FROM "Community"
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  `)
}

function norm(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Fuzzy match a Job.community text against a list of Community rows.
// Returns the community row if exactly one is a viable match.
function matchCommunity(jobCommunityText, communities) {
  const jc = norm(jobCommunityText)
  if (!jc) return null

  // Exact normalized match
  let hits = communities.filter(c => norm(c.name) === jc)
  if (hits.length === 1) return hits[0]

  // Job community contains community name as whole-word substring
  hits = communities.filter(c => {
    const cn = norm(c.name)
    if (!cn) return false
    return jc === cn || jc.startsWith(cn + ' ') || jc.endsWith(' ' + cn) || jc.includes(' ' + cn + ' ')
  })
  if (hits.length === 1) return hits[0]

  // Fallback: community name contains job community text (rarer)
  hits = communities.filter(c => norm(c.name).includes(jc))
  if (hits.length === 1) return hits[0]

  return null
}

// Find a Community whose name appears as a substring inside a free-text address.
function matchByAddress(address, communities) {
  const a = norm(address)
  if (!a) return null
  const hits = communities.filter(c => {
    const cn = norm(c.name)
    if (!cn || cn.length < 4) return false // avoid noise on 3-letter codes
    return a.includes(cn)
  })
  if (hits.length === 1) return hits[0]
  return null
}

async function passA_communityId(communities) {
  // Jobs with explicit communityId FK -> copy coords.
  const byId = new Map(communities.map(c => [c.id, c]))
  const jobs = await sql.query(`
    SELECT id, "communityId"
    FROM "Job"
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND "communityId" IS NOT NULL
      AND status::text IN (${STATUS_LIST})
  `)
  let matched = 0, written = 0
  for (const j of jobs) {
    const c = byId.get(j.communityId)
    if (!c) continue
    matched++
    if (APPLY) {
      await sql.query(`UPDATE "Job" SET latitude=$1, longitude=$2 WHERE id=$3`,
        [c.latitude, c.longitude, j.id])
      written++
    }
  }
  return { scanned: jobs.length, matched, written }
}

async function passB_communityText(communities) {
  const jobs = await sql.query(`
    SELECT id, community
    FROM "Job"
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND community IS NOT NULL AND community != ''
      AND status::text IN (${STATUS_LIST})
  `)
  let matched = 0, written = 0
  const samples = []
  for (const j of jobs) {
    const c = matchCommunity(j.community, communities)
    if (!c) continue
    matched++
    if (samples.length < 10) samples.push(`  "${j.community}" -> "${c.name}"`)
    if (APPLY) {
      await sql.query(`UPDATE "Job" SET latitude=$1, longitude=$2 WHERE id=$3`,
        [c.latitude, c.longitude, j.id])
      written++
    }
  }
  if (samples.length) console.log('  sample matches:\n' + samples.join('\n'))
  return { scanned: jobs.length, matched, written }
}

async function passC_address(communities) {
  const jobs = await sql.query(`
    SELECT id, "jobAddress"
    FROM "Job"
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND "jobAddress" IS NOT NULL AND "jobAddress" != ''
      AND status::text IN (${STATUS_LIST})
  `)
  let matched = 0, written = 0
  const samples = []
  for (const j of jobs) {
    const c = matchByAddress(j.jobAddress, communities)
    if (!c) continue
    matched++
    if (samples.length < 10) samples.push(`  "${j.jobAddress}" -> "${c.name}"`)
    if (APPLY) {
      await sql.query(`UPDATE "Job" SET latitude=$1, longitude=$2 WHERE id=$3`,
        [c.latitude, c.longitude, j.id])
      written++
    }
  }
  if (samples.length) console.log('  sample matches:\n' + samples.join('\n'))
  return { scanned: jobs.length, matched, written }
}

async function passD_neighborAverage() {
  // Group geocoded active jobs by Job.community text, compute average coords,
  // then stamp any sibling ungeocoded job with that average.
  const groups = await sql.query(`
    SELECT community,
           COUNT(*)::int AS cnt,
           AVG(latitude)::float AS lat,
           AVG(longitude)::float AS lng,
           STDDEV(latitude)::float AS lat_std,
           STDDEV(longitude)::float AS lng_std
    FROM "Job"
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND community IS NOT NULL AND community != ''
      AND status::text IN (${STATUS_LIST})
    GROUP BY community
    HAVING COUNT(*) >= 2
  `)
  // Require coordinates to be reasonably clustered (within ~0.25 deg ~= 17mi),
  // otherwise the group is too spread out to trust as a community centroid.
  const MAX_STD = 0.25
  const byCommunity = new Map()
  let rejected = 0
  for (const g of groups) {
    const std = Math.max(g.lat_std || 0, g.lng_std || 0)
    if (std > MAX_STD) { rejected++; continue }
    byCommunity.set(g.community, { lat: g.lat, lng: g.lng, cnt: g.cnt })
  }
  console.log(`  neighbor groups: ${byCommunity.size} usable, ${rejected} rejected (std > ${MAX_STD} deg)`)

  const jobs = await sql.query(`
    SELECT id, community
    FROM "Job"
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND community IS NOT NULL AND community != ''
      AND status::text IN (${STATUS_LIST})
  `)
  let matched = 0, written = 0
  const samples = []
  for (const j of jobs) {
    const grp = byCommunity.get(j.community)
    if (!grp) continue
    matched++
    if (samples.length < 10) samples.push(`  "${j.community}" (n=${grp.cnt}) -> (${grp.lat.toFixed(4)}, ${grp.lng.toFixed(4)})`)
    if (APPLY) {
      await sql.query(`UPDATE "Job" SET latitude=$1, longitude=$2 WHERE id=$3`,
        [grp.lat, grp.lng, j.id])
      written++
    }
  }
  if (samples.length) console.log('  sample matches:\n' + samples.join('\n'))
  return { scanned: jobs.length, matched, written }
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'}`)

  const total = await countTotal()
  const before = await countMissing()
  console.log(`Active jobs: ${total} total, ${before} missing lat/lng (gap = ${before}).`)

  const communities = await communitiesWithCoords()
  console.log(`Communities with coords: ${communities.length}`)
  if (communities.length === 0 && !APPLY) {
    console.log('(dry-run continues but passes A/B/C will match nothing)')
  }

  console.log('\n--- Pass A: Job.communityId -> Community.lat/lng ---')
  const A = await passA_communityId(communities)
  console.log(`  scanned=${A.scanned}, matched=${A.matched}, written=${A.written}`)

  console.log('\n--- Pass B: Job.community (text) fuzzy match to Community.name ---')
  const B = await passB_communityText(communities)
  console.log(`  scanned=${B.scanned}, matched=${B.matched}, written=${B.written}`)

  console.log('\n--- Pass C: jobAddress contains Community.name as substring ---')
  const C = await passC_address(communities)
  console.log(`  scanned=${C.scanned}, matched=${C.matched}, written=${C.written}`)

  console.log('\n--- Pass D: neighbor-average from geocoded sibling jobs ---')
  const D = await passD_neighborAverage()
  console.log(`  scanned=${D.scanned}, matched=${D.matched}, written=${D.written}`)

  const after = await countMissing()
  const closed = before - after
  const totalMatched = A.matched + B.matched + C.matched + D.matched
  console.log('')
  console.log('=== Summary ===')
  console.log(`  Pass A (communityId):      ${A.matched.toString().padStart(4)} matched`)
  console.log(`  Pass B (community text):   ${B.matched.toString().padStart(4)} matched`)
  console.log(`  Pass C (address substr):   ${C.matched.toString().padStart(4)} matched`)
  console.log(`  Pass D (neighbor-avg):     ${D.matched.toString().padStart(4)} matched`)
  console.log(`  -----`)
  console.log(`  Total unique-row match candidates: ${totalMatched} (passes may overlap)`)
  console.log('')
  console.log(`  Before: ${before} missing / ${total} active`)
  console.log(`  After:  ${after} missing / ${total} active`)
  console.log(`  Closed: ${closed} rows (${total ? ((closed/total)*100).toFixed(1) : '0'}%)`)
  if (!APPLY) console.log('\nRe-run with --apply to write.')
}

main().catch(e => { console.error(e); process.exit(1) })
