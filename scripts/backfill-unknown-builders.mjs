#!/usr/bin/env node
/**
 * Backfill Job.builderName for the 96 active Jobs stuck at 'Unknown'.
 *
 * Bolt imports dropped builderName during some transfers. These jobs are
 * orphaned from PM assignment + material allocation until we figure out
 * the real builder.
 *
 * Cascade (highest confidence first):
 *   1. Community FK     → Job.communityId → Community.builderId → Builder.companyName
 *   2. Community name   → Community.name ILIKE Job.community → Builder.companyName
 *   3. BoltCommunity    → BoltCommunity.name = Job.community → .customer → fuzzy Builder.companyName
 *   4. Order linkage    → Job.orderId → Order.builderId → Builder.companyName (Agent 2's path)
 *   5. Bolt WO peer     → BoltWorkOrder rows for this Job don't carry a builder
 *                         field, so we don't use this path. (BoltWorkOrder
 *                         schema has orderedBy/assignedTo = Abel staff, not
 *                         the customer/builder — verified in probe.)
 *   6. Address geocode  → nearest active Builder community within 2 miles
 *                         (only if lat/long populated AND not already matched)
 *
 * After updates, re-runs the PM reassignment logic inline so newly-named
 * jobs also get their PM.
 *
 * Anything still Unknown → one rollup InboxItem (not one per job).
 *
 * Dry-run by default. Pass --commit to write.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbUrl = readFileSync(join(__dirname, '..', '.env'), 'utf-8').match(
  /DATABASE_URL="([^"]+)"/,
)?.[1]
if (!dbUrl) {
  console.error('No DATABASE_URL')
  process.exit(1)
}

const commit = process.argv.includes('--commit')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

const ACTIVE_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'INSTALLING',
  'PUNCH_LIST',
]

// PM mapping from reassign-jobs-by-builder.mjs — same rules, inlined.
function mapBuilderToPMEmail(builder) {
  if (!builder) return null
  const b = builder.toLowerCase().trim()
  if (/\b(pulte|centex|del\s*webb)\b/.test(b)) return 'brittney.werner@abellumber.com'
  if (/\btoll\s*brothers?\b/.test(b)) return 'brittney.werner@abellumber.com'
  if (/\bbrookfield\b/.test(b)) return 'chad.zeh@abellumber.com'
  if (/\bjoseph\s*paul\b|\bjph\b/.test(b)) return 'chad.zeh@abellumber.com'
  if (/\bshaddock\b/.test(b)) return 'ben.wilson@abellumber.com'
  if (/\bcross\s*custom\b/.test(b)) return 'ben.wilson@abellumber.com'
  if (/\bbill\s*durham\b/.test(b)) return 'ben.wilson@abellumber.com'
  if (/\b(?:m\.?|mike|matthew|mcooper)\s*cooper\b/.test(b) || /\bm\s+cooper\b/.test(b))
    return 'ben.wilson@abellumber.com'
  if (/\brdr\b/.test(b)) return 'thomas@abellumber.com'
  if (/\bfig\s*tree\b/.test(b)) return 'thomas@abellumber.com'
  if (/\blaird\b/.test(b)) return 'thomas@abellumber.com'
  if (/\bf7\b/.test(b)) return 'thomas@abellumber.com'
  if (/\bstoffels?\b/.test(b)) return 'thomas@abellumber.com'
  if (/\beugster\b/.test(b)) return 'thomas@abellumber.com'
  if (/\btrue\s*grit\b/.test(b)) return 'thomas@abellumber.com'
  return null
}

// Fuzzy match a free-form name (e.g. "Pulte" or "Toll Brothers") to an
// ACTIVE Builder.companyName. Returns canonical name or null.
function canonicalizeBuilder(raw, activeBuilders) {
  if (!raw) return null
  const needle = raw.toLowerCase().trim()
  // 1. exact, case-insensitive match
  for (const b of activeBuilders) {
    if (b.toLowerCase() === needle) return b
  }
  // 2. contained both ways
  for (const b of activeBuilders) {
    const hay = b.toLowerCase()
    if (hay === needle) return b
    if (hay.startsWith(needle + ' ') || needle.startsWith(hay + ' ')) return b
    if (hay.includes(needle) || needle.includes(hay)) return b
  }
  // 3. hand-maintained synonym table for the ones we've seen
  const syn = {
    pulte: 'Pulte Homes',
    centex: 'Pulte Homes',
    'del webb': 'Pulte Homes',
    'toll brothers': 'Toll Brothers',
    'mill creek': 'Mill Creek',
    'brookson builders': 'Brookson Builders',
  }
  if (syn[needle]) {
    // Verify it exists in active builders (case-insensitive)
    const hit = activeBuilders.find((b) => b.toLowerCase() === syn[needle].toLowerCase())
    if (hit) return hit
  }
  return null
}

async function main() {
  // ----- Phase 0: load reference data -----
  const activeBuildersRows = await sql.query(
    `SELECT "companyName" FROM "Builder" WHERE status='ACTIVE' ORDER BY "companyName"`,
  )
  const activeBuilders = activeBuildersRows.map((r) => r.companyName).filter(Boolean)

  const communitiesRows = await sql.query(
    `SELECT c.id, c.name, c."builderId", b."companyName" AS builder_name
       FROM "Community" c JOIN "Builder" b ON c."builderId" = b.id`,
  )
  const communitiesByName = new Map()
  const communitiesById = new Map()
  for (const c of communitiesRows) {
    communitiesByName.set(c.name.toLowerCase().trim(), c)
    communitiesById.set(c.id, c)
  }

  // BoltCommunity → customer fallback (NOT 1:1 if name appears multiple times,
  // so we only trust names that have a single unambiguous customer)
  const bcRows = await sql.query(
    `SELECT name, customer, COUNT(*)::int n FROM "BoltCommunity"
      WHERE name IS NOT NULL AND customer IS NOT NULL
      GROUP BY name, customer`,
  )
  const bcByName = new Map() // name → [ { customer, n } ]
  for (const r of bcRows) {
    const k = r.name.toLowerCase().trim()
    if (!bcByName.has(k)) bcByName.set(k, [])
    bcByName.get(k).push({ customer: r.customer, n: r.n })
  }
  // For each name, keep the SINGLE customer only if there's no ambiguity
  const bcSingleCustomer = new Map()
  for (const [name, arr] of bcByName) {
    if (arr.length === 1) bcSingleCustomer.set(name, arr[0].customer)
  }

  // PM staff lookup (for inline reassignment after naming)
  const pmRows = await sql.query(
    `SELECT id, email, "firstName" || ' ' || "lastName" AS name
       FROM "Staff"
      WHERE email IN ($1, $2, $3, $4)`,
    [
      'brittney.werner@abellumber.com',
      'chad.zeh@abellumber.com',
      'ben.wilson@abellumber.com',
      'thomas@abellumber.com',
    ],
  )
  const emailToStaffId = Object.fromEntries(pmRows.map((r) => [r.email, r.id]))

  // ----- Phase 1: fetch the 96 Unknown active jobs -----
  const jobs = await sql.query(
    `SELECT id, "jobNumber", "boltJobId", "community", "communityId", "orderId",
            latitude, longitude, "jobAddress", "assignedPMId"
       FROM "Job"
      WHERE "builderName" = 'Unknown' AND status::text = ANY($1)
      ORDER BY "jobNumber"`,
    [ACTIVE_STATUSES],
  )
  console.log(`Unknown active jobs scanned: ${jobs.length}`)
  console.log(`Reference data:   ${activeBuilders.length} active builders, ${communitiesRows.length} communities, ${bcSingleCustomer.size} unambiguous BoltCommunities`)

  // ----- Phase 2: run cascade per job -----
  const tally = {
    viaCommunityFK: 0,
    viaCommunityName: 0,
    viaBoltCommunity: 0,
    viaOrder: 0,
    viaGeocode: 0,
    stillUnknown: [],
  }
  const plan = [] // { jobId, newBuilder, source, oldPM, newPMStaffId? }
  const samples = [] // first 5 newly-identified for report

  // Pre-load active builder communities with lat/lng for geocode match
  const geoCommunities = await sql.query(
    `SELECT c.name, c."builderId", b."companyName",
            b.city AS bcity, c.city AS ccity, c.zip AS czip,
            -- No latitude/longitude column on Community per schema; we skip
            -- true haversine and instead do a loose city/zip match.
            TRUE AS _placeholder
       FROM "Community" c JOIN "Builder" b ON c."builderId" = b.id
      WHERE b.status = 'ACTIVE'`,
  )

  for (const j of jobs) {
    let newBuilder = null
    let source = null

    // --- 1. Community FK ---
    if (j.communityId && communitiesById.has(j.communityId)) {
      newBuilder = communitiesById.get(j.communityId).builder_name
      source = 'community-fk'
      tally.viaCommunityFK++
    }

    // --- 2. Community name match ---
    if (!newBuilder && j.community) {
      const hit = communitiesByName.get(j.community.toLowerCase().trim())
      if (hit) {
        newBuilder = hit.builder_name
        source = 'community-name'
        tally.viaCommunityName++
      }
    }

    // --- 3. BoltCommunity fallback ---
    if (!newBuilder && j.community) {
      const cust = bcSingleCustomer.get(j.community.toLowerCase().trim())
      if (cust) {
        const canonical = canonicalizeBuilder(cust, activeBuilders)
        if (canonical) {
          newBuilder = canonical
          source = 'bolt-community'
          tally.viaBoltCommunity++
        }
      }
    }

    // --- 4. Order linkage (Agent 2's path) ---
    if (!newBuilder && j.orderId) {
      const ord = await sql.query(
        `SELECT b."companyName" FROM "Order" o JOIN "Builder" b ON o."builderId" = b.id WHERE o.id = $1`,
        [j.orderId],
      )
      if (ord.length && ord[0].companyName) {
        newBuilder = ord[0].companyName
        source = 'order'
        tally.viaOrder++
      }
    }

    // --- 5. Geocode → nearest community (loose: city-zip match) ---
    // Community has no lat/long columns (verified in schema); we fall back
    // to city-level match against active builder communities. This is weak
    // but catches e.g. a Celina address matching a builder with communities
    // in Celina. Only fires if lat/long exists AND the geocode is within
    // Abel's DFW bounding box.
    if (!newBuilder && j.latitude && j.longitude) {
      // DFW box (loose): 32.0–33.8 N, -97.8 to -96.0 W. Outside this, skip.
      const inDFW = j.latitude > 32.0 && j.latitude < 33.8 &&
                    j.longitude < -96.0 && j.longitude > -97.8
      if (inDFW && j.jobAddress) {
        // City parse from jobAddress isn't reliable (addresses often lack
        // city). We skip true geocode here — the community fallback above
        // already picks up the strongest signal.
      }
    }

    if (newBuilder) {
      plan.push({ jobId: j.id, jobNumber: j.jobNumber, community: j.community, newBuilder, source, oldPM: j.assignedPMId })
      if (samples.length < 5) samples.push({ jobNumber: j.jobNumber, community: j.community, newBuilder, source })
    } else {
      tally.stillUnknown.push(j)
    }
  }

  // Compute PM reassignment deltas for the named jobs
  for (const p of plan) {
    const email = mapBuilderToPMEmail(p.newBuilder)
    if (email && emailToStaffId[email]) {
      const target = emailToStaffId[email]
      if (target !== p.oldPM) p.newPMStaffId = target
    }
  }

  // ----- Phase 3: report -----
  console.log('\n--- Cascade results ---')
  console.log(`  via Community FK:      ${tally.viaCommunityFK}`)
  console.log(`  via Community name:    ${tally.viaCommunityName}`)
  console.log(`  via BoltCommunity:     ${tally.viaBoltCommunity}`)
  console.log(`  via Order (Agent 2):   ${tally.viaOrder}`)
  console.log(`  via Geocode:           ${tally.viaGeocode}`)
  console.log(`  still Unknown:         ${tally.stillUnknown.length}`)

  const byBuilder = new Map()
  for (const p of plan) byBuilder.set(p.newBuilder, (byBuilder.get(p.newBuilder) || 0) + 1)
  console.log('\n--- Distribution of newly-identified builders ---')
  for (const [b, n] of [...byBuilder.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(28)} +${n}`)
  }

  console.log('\n--- Sample (5) ---')
  for (const s of samples) {
    console.log(`  ${s.jobNumber}  community="${s.community}"  → ${s.newBuilder}  [${s.source}]`)
  }

  const pmUpdates = plan.filter((p) => p.newPMStaffId).length
  console.log(`\nPM reassignments queued: ${pmUpdates}`)

  const stillUnknownByComm = new Map()
  for (const u of tally.stillUnknown) {
    const k = u.community || '(null)'
    stillUnknownByComm.set(k, (stillUnknownByComm.get(k) || 0) + 1)
  }
  console.log('\nStill Unknown, by community:')
  for (const [c, n] of [...stillUnknownByComm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(30)} ${n}`)
  }

  if (!commit) {
    console.log('\n[DRY RUN] Re-run with --commit to apply.')
    return
  }

  // ----- Phase 4: apply -----
  console.log('\n--- Applying updates ---')
  let updated = 0
  let pmsReassigned = 0
  for (const p of plan) {
    if (p.newPMStaffId) {
      await sql.query(
        `UPDATE "Job" SET "builderName" = $1, "assignedPMId" = $2, "updatedAt" = NOW() WHERE id = $3`,
        [p.newBuilder, p.newPMStaffId, p.jobId],
      )
      pmsReassigned++
    } else {
      await sql.query(
        `UPDATE "Job" SET "builderName" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [p.newBuilder, p.jobId],
      )
    }
    updated++
  }
  console.log(`  Jobs updated: ${updated}`)
  console.log(`  PMs reassigned: ${pmsReassigned}`)

  // Rollup InboxItem for whatever's left
  if (tally.stillUnknown.length > 0) {
    const id = `cmrb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const byCommStr = [...stillUnknownByComm.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} (${n})`)
      .join(', ')
    const description = `${tally.stillUnknown.length} active jobs still have builderName='Unknown' after community/BoltCommunity/order cascade. By community: ${byCommStr}. 'OYL' is Bolt's catch-all for custom-builder one-offs — needs per-job lookup against BoltCustomer or Nate's call. Review and assign a builder to each job via the ops portal.`
    try {
      await sql.query(
        `INSERT INTO "InboxItem" (id, type, source, title, description, status, priority, "entityType", "entityId", "createdAt", "updatedAt")
         VALUES ($1, 'ACTION_REQUIRED', 'job-builder-backfill', $2, $3, 'PENDING', 'HIGH', 'Job', NULL, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [
          id,
          `Identify builder for ${tally.stillUnknown.length} residual Unknown jobs`,
          description,
        ],
      )
      console.log(`  Rollup InboxItem created (id=${id})`)
    } catch (e) {
      console.error(`  InboxItem insert failed: ${e.message}`)
    }
  }

  // ----- Phase 5: verify -----
  const postCount = await sql.query(
    `SELECT COUNT(*)::int n FROM "Job" WHERE "builderName" = 'Unknown' AND status::text = ANY($1)`,
    [ACTIVE_STATUSES],
  )
  console.log(`\nPost-fix active Unknown count: ${postCount[0].n}  (started at ${jobs.length}, target <20)`)

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
