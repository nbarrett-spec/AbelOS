#!/usr/bin/env node
/**
 * Round-3 PM reassignment + final builder status cleanup.
 *
 * Nate's round-3 mapping:
 *   Thomas:       Bailey Brothers Builders
 *   Brittney:     Texas Restoration & Rescue
 *   SUSPENDED:    Truth Construction (no longer active)
 *                 GH Homes (inactive)
 *   SUSPENDED +   McCoy's Building Supply (is a supplier, not a customer)
 *   SUSPENDED +   HWH Construction (3rd-party trim labor, not a customer)
 *   flag          (each gets a data-quality InboxItem to re-home the jobs)
 *
 * Bailey Brothers goes into Thomas's book, so Dalton automatically becomes
 * the salesOwner too.
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

async function main() {
  const staff = await sql.query(
    `SELECT id, email FROM "Staff" WHERE email = ANY($1)`,
    [[
      'brittney.werner@abellumber.com',
      'thomas@abellumber.com',
      'dalton@abellumber.com',
    ]],
  )
  const ids = Object.fromEntries(staff.map((r) => [r.email, r.id]))
  const brittney = ids['brittney.werner@abellumber.com']
  const thomas = ids['thomas@abellumber.com']
  const dalton = ids['dalton@abellumber.com']
  if (!brittney || !thomas || !dalton) {
    console.error('Missing staff')
    process.exit(1)
  }

  console.log('Staff:')
  console.log(`  Brittney: ${brittney}`)
  console.log(`  Thomas:   ${thomas}`)
  console.log(`  Dalton:   ${dalton}`)

  // Round-3 assignments
  const newAssignments = [
    { builder: /bailey\s*brothers?/i, pmId: thomas, pmName: 'Thomas Robinson' },
    { builder: /texas\s*restoration|texas\s*r&?r/i, pmId: brittney, pmName: 'Brittney Werner' },
  ]

  const jobs = await sql.query(
    `SELECT id, "jobNumber", "builderName", "assignedPMId"
       FROM "Job"
      WHERE status::text = ANY($1)
        AND "builderName" IS NOT NULL`,
    [ACTIVE_STATUSES],
  )

  const reassignPlan = []
  for (const j of jobs) {
    for (const rule of newAssignments) {
      if (rule.builder.test(j.builderName)) {
        if (j.assignedPMId !== rule.pmId) {
          reassignPlan.push({ ...j, newPMId: rule.pmId, newPMName: rule.pmName })
        }
        break
      }
    }
  }

  console.log(`\nRound-3 reassignments: ${reassignPlan.length}`)
  const byPM = {}
  for (const r of reassignPlan) byPM[r.newPMName] = (byPM[r.newPMName] || 0) + 1
  for (const [name, n] of Object.entries(byPM)) console.log(`  ${name.padEnd(20)} +${n}`)

  // Status updates + flags
  const suspended = [
    { pattern: /truth\s*construction/i, reason: 'No longer active (per Nate 2026-04-23)' },
    { pattern: /\bgh\s*homes\b/i, reason: 'Inactive (per Nate 2026-04-23)' },
  ]
  const suspendedMisclass = [
    {
      pattern: /mccoy/i,
      reason: 'Is a supplier, not a customer (per Nate 2026-04-23)',
      flagTitle: "Fix misclass: McCoy's Building Supply is a supplier",
      flagDesc:
        "McCoy's Building Supply is in the Builder table but is actually a supplier. Any active jobs assigned to them were unassigned. Consider moving to Vendor table if recurring supplier relationship.",
      entityKey: 'mccoys-supplier-misclass',
    },
    {
      pattern: /hwh\s*construction/i,
      reason: '3rd-party trim labor, not a customer (per Nate 2026-04-23)',
      flagTitle: 'Fix misclass: HWH Construction is a trim labor company',
      flagDesc:
        'HWH Construction is a third-party trim labor company, not a customer. Active jobs assigned to them have the wrong builderName — open each job and set to the actual customer.',
      entityKey: 'hwh-labor-misclass',
    },
  ]

  const thomasBuilders = [/bailey\s*brothers?/i]

  if (!commit) {
    console.log('\n[DRY RUN] Re-run with --commit to apply.')
    return
  }

  // APPLY
  console.log('\n--- Applying ---')

  // Reassign active jobs
  let reassigned = 0
  for (const r of reassignPlan) {
    await sql.query(
      `UPDATE "Job" SET "assignedPMId" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [r.newPMId, r.id],
    )
    reassigned++
  }
  console.log(`✓ Reassigned ${reassigned} jobs`)

  // Suspend builders + unassign their jobs
  for (const s of [...suspended, ...suspendedMisclass]) {
    const patternStr = s.pattern.source
    const upd = await sql.query(
      `UPDATE "Builder"
          SET status = 'SUSPENDED'::"AccountStatus", "updatedAt" = NOW()
        WHERE "companyName" ~* $1
        RETURNING "companyName"`,
      [patternStr],
    )
    for (const r of upd) console.log(`  ✓ ${r.companyName} → SUSPENDED (${s.reason})`)

    const nulled = await sql.query(
      `UPDATE "Job"
          SET "assignedPMId" = NULL, "updatedAt" = NOW()
        WHERE "builderName" ~* $1
          AND status::text = ANY($2)
        RETURNING id`,
      [patternStr, ACTIVE_STATUSES],
    )
    if (nulled.length)
      console.log(`    ${nulled.length} active jobs unassigned from "${patternStr}"`)

    // Misclass entries get a specific data-quality InboxItem
    if ('flagTitle' in s && nulled.length > 0) {
      const id = `cmrb3_${s.entityKey}_${Date.now().toString(36)}`
      await sql.query(
        `INSERT INTO "InboxItem" (id, type, title, description, status, priority, source, "entityType", "entityId", "createdAt", "updatedAt")
         VALUES ($1, 'DATA_QUALITY', $2, $3, 'PENDING', 'HIGH', 'job-reassignment', 'Builder', $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, s.flagTitle, s.flagDesc, s.entityKey],
      )
      console.log(`    Data-quality InboxItem created: ${s.entityKey}`)
    }
  }

  // Set Dalton as salesOwner for Bailey Brothers
  const baileyUpdates = await sql.query(
    `UPDATE "Builder" SET "salesOwnerId" = $1, "updatedAt" = NOW()
      WHERE "companyName" ~* $2
      RETURNING "companyName"`,
    [dalton, 'bailey\\s*brothers?'],
  )
  for (const r of baileyUpdates)
    console.log(`  ✓ ${r.companyName} → salesOwner = Dalton Whatley`)

  // Resolve any remaining round-1/2 InboxItem rollups for these builders
  const resolved = await sql.query(
    `UPDATE "InboxItem"
        SET status = 'RESOLVED', "updatedAt" = NOW()
      WHERE source = 'job-reassignment'
        AND status = 'PENDING'
        AND ("entityId" ILIKE ANY($1))
      RETURNING id`,
    [[
      '%Bailey%',
      '%Texas%',
      '%Truth%',
      '%GH HOMES%',
      '%McCoy%',
      '%HWH%',
    ]],
  )
  console.log(`✓ Resolved ${resolved.length} old InboxItem rollups`)

  // Final verification
  const dist = await sql.query(
    `SELECT COALESCE(s."firstName" || ' ' || s."lastName", 'UNASSIGNED') AS pm, COUNT(j.id)::int n
       FROM "Job" j
       LEFT JOIN "Staff" s ON j."assignedPMId" = s.id
      WHERE j.status::text = ANY($1)
      GROUP BY s.id, s."firstName", s."lastName"
      ORDER BY n DESC`,
    [ACTIVE_STATUSES],
  )
  console.log('\n--- Final PM distribution ---')
  for (const r of dist) console.log(`  ${r.pm.padEnd(25)} ${r.n}`)

  const remainingUnmapped = await sql.query(
    `SELECT COALESCE("builderName", '(null)') AS builder, COUNT(*)::int n
       FROM "Job"
      WHERE status::text = ANY($1)
        AND "assignedPMId" IS NULL
      GROUP BY "builderName"
      ORDER BY n DESC`,
    [ACTIVE_STATUSES],
  )
  console.log('\n--- Still unassigned (by builder) ---')
  for (const r of remainingUnmapped) console.log(`  ${r.builder.padEnd(35)} ${r.n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
