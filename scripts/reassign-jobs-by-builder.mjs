#!/usr/bin/env node
/**
 * One-shot reassignment: every active Job → its correct PM per Nate's mapping.
 *
 * Abel has 4 PMs covering specific builders:
 *   Brittney Werner:  Pulte (incl. Centex/Del Webb), Toll Brothers
 *   Chad Zeh:         Brookfield, Joseph Paul Homes
 *   Ben Wilson:       Shaddock, Cross Custom, Bill Durham, M Cooper
 *   Thomas Robinson:  RDR, Fig Tree, Laird Construction, F7, Stoffels,
 *                     Eugster, True Grit
 *
 * Jobs on builders NOT in Nate's mapping (Imagination Homes, AGD, Villa-May,
 * etc.) are unassigned and surfaced as InboxItem for Nate's decision.
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

// Builder → PM matcher. Order matters — more specific patterns first.
// Returns the email of the target PM, or null for "unmapped".
function mapBuilderToPMEmail(builder) {
  if (!builder) return null
  const b = builder.toLowerCase().trim()

  // Brittney: Pulte + Toll Brothers
  if (/\b(pulte|centex|del\s*webb)\b/.test(b)) return 'brittney.werner@abellumber.com'
  if (/\btoll\s*brothers?\b/.test(b)) return 'brittney.werner@abellumber.com'

  // Chad: Brookfield + Joseph Paul
  if (/\bbrookfield\b/.test(b)) return 'chad.zeh@abellumber.com'
  if (/\bjoseph\s*paul\b|\bjph\b/.test(b)) return 'chad.zeh@abellumber.com'

  // Ben: Shaddock, Cross Custom, Bill Durham, M Cooper
  if (/\bshaddock\b/.test(b)) return 'ben.wilson@abellumber.com'
  if (/\bcross\s*custom\b/.test(b)) return 'ben.wilson@abellumber.com'
  if (/\bbill\s*durham\b/.test(b)) return 'ben.wilson@abellumber.com'
  if (/\b(?:m\.?|mike|matthew|mcooper)\s*cooper\b/.test(b) || /\bm\s+cooper\b/.test(b))
    return 'ben.wilson@abellumber.com'

  // Thomas: RDR, Fig Tree, Laird, F7, Stoffels, Eugster, True Grit
  if (/\brdr\b/.test(b)) return 'thomas@abellumber.com'
  if (/\bfig\s*tree\b/.test(b)) return 'thomas@abellumber.com'
  if (/\blaird\b/.test(b)) return 'thomas@abellumber.com'
  if (/\bf7\b/.test(b)) return 'thomas@abellumber.com'
  if (/\bstoffels?\b/.test(b)) return 'thomas@abellumber.com'
  if (/\beugster\b/.test(b)) return 'thomas@abellumber.com'
  if (/\btrue\s*grit\b/.test(b)) return 'thomas@abellumber.com'

  return null
}

async function main() {
  // Resolve PM staffIds by email
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
  const emailToId = Object.fromEntries(pmRows.map((r) => [r.email, r.id]))
  const idToName = Object.fromEntries(pmRows.map((r) => [r.id, r.name]))

  console.log('PM lookup:')
  for (const r of pmRows) console.log(`  ${r.email.padEnd(35)} ${r.id}  ${r.name}`)
  if (pmRows.length !== 4) {
    console.error(`\nExpected 4 PMs, found ${pmRows.length}. Check emails.`)
    process.exit(1)
  }

  // Pull every active Job with current PM
  const jobs = await sql.query(
    `SELECT j.id, j."jobNumber", j."builderName", j."assignedPMId",
            s."firstName" || ' ' || s."lastName" AS current_pm_name, s.active AS pm_active
       FROM "Job" j
       LEFT JOIN "Staff" s ON j."assignedPMId" = s.id
      WHERE j.status::text = ANY($1)`,
    [ACTIVE_STATUSES],
  )

  console.log(`\nActive jobs scanned: ${jobs.length}`)

  const plan = {
    correct: 0, // already on right PM
    reassign: [], // will move to right PM
    unmap: [], // builder not in Nate's mapping
    nullBuilder: [], // no builderName at all
  }

  const unmappedBuilders = new Map() // builder → count

  for (const j of jobs) {
    if (!j.builderName || j.builderName === 'Unknown') {
      plan.nullBuilder.push(j)
      continue
    }
    const targetEmail = mapBuilderToPMEmail(j.builderName)
    if (!targetEmail) {
      plan.unmap.push(j)
      unmappedBuilders.set(j.builderName, (unmappedBuilders.get(j.builderName) || 0) + 1)
      continue
    }
    const targetId = emailToId[targetEmail]
    if (j.assignedPMId === targetId) {
      plan.correct++
    } else {
      plan.reassign.push({
        ...j,
        targetId,
        targetName: idToName[targetId],
      })
    }
  }

  console.log('\n--- Plan ---')
  console.log(`  Already correct:        ${plan.correct}`)
  console.log(`  Will reassign:          ${plan.reassign.length}`)
  console.log(`  Unmapped builders:      ${plan.unmap.length}`)
  console.log(`  Null/Unknown builder:   ${plan.nullBuilder.length}`)

  // Reassign breakdown by target PM
  const byTarget = {}
  for (const r of plan.reassign) {
    byTarget[r.targetName] = (byTarget[r.targetName] || 0) + 1
  }
  console.log('\nReassignment targets:')
  for (const [name, n] of Object.entries(byTarget)) console.log(`  ${name.padEnd(25)} +${n}`)

  // Unmapped builders for Nate's decision
  console.log('\nUnmapped builders needing Nate decision:')
  const unmapSorted = Array.from(unmappedBuilders.entries()).sort((a, b) => b[1] - a[1])
  for (const [builder, n] of unmapSorted) {
    console.log(`  ${builder.padEnd(35)} ${n} jobs`)
  }

  if (!commit) {
    console.log('\n[DRY RUN] Re-run with --commit to apply.')
    return
  }

  console.log('\n--- Applying ---')
  let applied = 0
  for (const r of plan.reassign) {
    await sql.query(`UPDATE "Job" SET "assignedPMId" = $1, "updatedAt" = NOW() WHERE id = $2`, [
      r.targetId,
      r.id,
    ])
    applied++
  }
  console.log(`Reassigned: ${applied}`)

  // Null unmapped assignments + surface as InboxItem
  let unassigned = 0
  let inboxCreated = 0
  for (const j of [...plan.unmap, ...plan.nullBuilder]) {
    await sql.query(`UPDATE "Job" SET "assignedPMId" = NULL, "updatedAt" = NOW() WHERE id = $1`, [
      j.id,
    ])
    unassigned++
  }
  console.log(`Un-assigned (set NULL): ${unassigned}`)

  // Single rollup InboxItem per unmapped builder (not one per job — avoid flood)
  for (const [builder, n] of unmapSorted) {
    const id = `cmrb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    try {
      await sql.query(
        `INSERT INTO "InboxItem" (id, type, title, description, status, priority, source, "entityType", "entityId", "createdAt", "updatedAt")
         VALUES ($1, 'ACTION_REQUIRED', $2, $3, 'PENDING', 'HIGH', 'job-reassignment', 'Builder', $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [
          id,
          `Assign PM for builder "${builder}" (${n} jobs)`,
          `${n} active jobs on builder "${builder}" have no PM — builder isn't in the 4-PM mapping. Assign a PM to this builder or merge it under an existing builder assignment. Current 4 PMs: Brittney (Pulte/Toll), Chad (Brookfield/JPH), Ben (Shaddock/CrossCustom/BillDurham/MCooper), Thomas (RDR/FigTree/Laird/F7/Stoffels/Eugster/TrueGrit).`,
          builder,
        ],
      )
      inboxCreated++
    } catch (e) {
      console.error(`InboxItem for "${builder}" failed: ${e.message}`)
    }
  }
  console.log(`InboxItems created: ${inboxCreated}`)

  // Post-apply verification
  const verify = await sql.query(
    `SELECT s."firstName" || ' ' || s."lastName" AS pm, COUNT(j.id)::int n
       FROM "Job" j
       LEFT JOIN "Staff" s ON j."assignedPMId" = s.id
      WHERE j.status::text = ANY($1)
      GROUP BY s.id
      ORDER BY n DESC`,
    [ACTIVE_STATUSES],
  )
  console.log('\n--- Post-apply PM distribution ---')
  for (const r of verify) console.log(`  ${(r.pm || 'UNASSIGNED').padEnd(25)} ${r.n}`)

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
