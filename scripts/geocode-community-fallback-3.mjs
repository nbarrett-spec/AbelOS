#!/usr/bin/env node
/**
 * Phase 3 of community-fallback geocoding — extends Phase 1/2 coverage.
 *
 * Prerequisite: Phase 1 (`geocode-community-fallback.mjs`) and Phase 2
 * (`geocode-community-fallback-2.mjs`) have already been applied. This
 * script does NOT modify those scripts.
 *
 * Problem this solves:
 *   Community table has only 11 rows, but active Jobs reference ~62 distinct
 *   community names (e.g. "Heritage Hills", "Shadow Creek", "Monarch Ranch")
 *   that aren't in the Community table. Phase 2 Pass D (neighbor-average)
 *   only helps groups where at least 2 siblings are already geocoded — it
 *   can't bootstrap a group from zero. This is why Phase 2 closed 0% when
 *   the expected close was 350+.
 *
 * Strategy:
 *   1. For each distinct Job.community value where NO sibling is geocoded
 *      (or too few to pass the std-dev filter), geocode the community name
 *      itself via Nominatim ("<community>, <city from sibling address or
 *      'DFW'>, TX" with sensible fallbacks).
 *   2. Cache the result. Stamp every sibling job with the community-centroid
 *      coordinates.
 *   3. Report before/after.
 *
 * Usage:
 *   node scripts/geocode-community-fallback-3.mjs            # dry run
 *   node scripts/geocode-community-fallback-3.mjs --apply    # write to DB
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Strip qualifiers/numbers that confuse Nominatim (e.g. "Ashford Crossing 30's"
// -> "Ashford Crossing"; "Creekview Meadows 5-40 Lite" -> "Creekview Meadows").
function cleanCommunityName(raw) {
  if (!raw) return ''
  let s = raw
    .replace(/&amp;?/gi, '&')
    .replace(/['’`]s\b/g, '')          // "30's" -> "30"
    .replace(/\b\d{1,3}(-\d{1,3})?\b/g, '') // lot-size qualifiers: "30", "40", "5-40"
    .replace(/\b(lite|light|phase|ph|section|sec)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  // strip trailing prepositions/hyphens
  s = s.replace(/[\s&\-]+$/g, '').trim()
  return s
}

async function geocode(q) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'Aegis-Geocoder/1.0 (n.barrett@abellumber.com)' } }
    )
    if (!r.ok) return null
    const j = await r.json()
    if (j.length > 0) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) }
    return null
  } catch { return null }
}

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

async function getUngeocodedGroups() {
  // All active-Job community groups with at least one NULL lat/lng,
  // annotated with whether any sibling is already geocoded (for query hints).
  const rows = await sql.query(`
    WITH g AS (
      SELECT community,
             COUNT(*)::int AS total,
             COUNT(latitude)::int AS geocoded
      FROM "Job"
      WHERE community IS NOT NULL AND community != ''
        AND status::text IN (${STATUS_LIST})
      GROUP BY community
    )
    SELECT community, total, geocoded, (total - geocoded) AS missing
    FROM g
    WHERE (total - geocoded) > 0
    ORDER BY missing DESC
  `)
  return rows
}

// Heuristic: extract a city from a sample Job.jobAddress in the same group.
// jobAddress samples look like "1234 Elm St, Frisco, TX 75033" or just
// "LOT 4 CREEKSIDE PHASE 2".
function extractCity(addr) {
  if (!addr) return null
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean)
  // Typical "<street>, <city>, <state> <zip>" or "<street>, <city>, TX"
  if (parts.length >= 2) {
    // Take the element before the state/zip (last with 'TX' or 5-digit zip)
    for (let i = parts.length - 1; i >= 1; i--) {
      const p = parts[i]
      if (/\bTX\b|\b7\d{4}\b/i.test(p)) {
        return parts[i - 1]
      }
    }
    return parts[parts.length - 1]
  }
  return null
}

async function getCityHint(community) {
  const r = await sql.query(`
    SELECT "jobAddress" FROM "Job"
    WHERE community = $1
      AND "jobAddress" IS NOT NULL AND "jobAddress" != ''
      AND status::text IN (${STATUS_LIST})
    LIMIT 25
  `, [community])
  const cities = new Map()
  for (const j of r) {
    const c = extractCity(j.jobAddress)
    if (!c) continue
    // Skip if it looks like a lot marker (contains "LOT", all caps short)
    if (/^LOT\b/i.test(c)) continue
    cities.set(c, (cities.get(c) || 0) + 1)
  }
  if (cities.size === 0) return null
  // Pick most common
  return [...cities.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'}`)

  const total = await countTotal()
  const before = await countMissing()
  console.log(`Active jobs: ${total} total, ${before} missing lat/lng.`)

  const groups = await getUngeocodedGroups()
  console.log(`Ungeocoded community groups (active): ${groups.length}`)

  let geocoded = 0, failed = 0, wouldWrite = 0, written = 0
  const results = []

  console.log(`\nGeocoding distinct community names (Nominatim, 1 req/sec)...`)
  const start = Date.now()

  for (const g of groups) {
    const cleaned = cleanCommunityName(g.community)
    const cityHint = await getCityHint(g.community)

    // Build query variations, most-specific first
    const queries = []
    if (cleaned && cityHint) queries.push(`${cleaned}, ${cityHint}, TX`)
    if (cleaned)             queries.push(`${cleaned}, TX`)
    if (cityHint)            queries.push(`${cityHint}, TX`)

    let coords = null, usedQ = null
    for (const q of queries) {
      coords = await geocode(q)
      if (coords) { usedQ = q; break }
      await sleep(1050)
    }

    if (coords) {
      // Sanity: must be in Texas bbox (25.8 - 36.5 lat, -106.7 - -93.5 lng)
      if (coords.lat < 25.8 || coords.lat > 36.5 || coords.lng < -106.7 || coords.lng > -93.5) {
        console.log(`  OUT-OF-TX  "${g.community}" -> (${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}) [${usedQ}] — rejected`)
        failed++
        coords = null
      }
    }

    if (coords) {
      geocoded++
      results.push({ community: g.community, lat: coords.lat, lng: coords.lng, missing: g.missing, q: usedQ })
      console.log(`  OK  n=${g.missing.toString().padStart(3)}  "${g.community}" -> (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}) [${usedQ}]`)

      if (APPLY) {
        const res = await sql.query(`
          UPDATE "Job" SET latitude=$1, longitude=$2
          WHERE community = $3
            AND (latitude IS NULL OR longitude IS NULL)
            AND status::text IN (${STATUS_LIST})
        `, [coords.lat, coords.lng, g.community])
        written += g.missing
      } else {
        wouldWrite += g.missing
      }
    } else {
      failed++
      console.log(`  FAIL  n=${g.missing.toString().padStart(3)}  "${g.community}" (tried ${queries.length} queries)`)
    }

    await sleep(1050) // Nominatim 1 req/sec policy
  }

  const secs = ((Date.now() - start) / 1000).toFixed(0)
  const after = APPLY ? await countMissing() : before
  const closed = APPLY ? (before - after) : wouldWrite

  console.log('')
  console.log('=== Summary ===')
  console.log(`  Groups scanned:   ${groups.length}`)
  console.log(`  Groups geocoded:  ${geocoded}`)
  console.log(`  Groups failed:    ${failed}`)
  console.log(`  Runtime:          ${secs}s`)
  console.log('')
  console.log(`  Before: ${before} missing / ${total} active`)
  if (APPLY) {
    console.log(`  After:  ${after} missing / ${total} active`)
    console.log(`  Closed: ${closed} rows (${total ? ((closed/total)*100).toFixed(1) : '0'}%)`)
  } else {
    console.log(`  Projected writes on --apply: ${wouldWrite} rows`)
    console.log(`  Projected after:             ${before - wouldWrite} missing`)
    console.log('\nRe-run with --apply to write.')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
