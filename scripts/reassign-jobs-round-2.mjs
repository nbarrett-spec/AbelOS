#!/usr/bin/env node
/**
 * Round-2 PM reassignment + Builder status cleanup + sales-owner linkage.
 *
 * Nate's round-2 mapping:
 *   Ben Wilson:    Imagination Homes (customer LOST), AGD Homes, Royal Crest
 *   Thomas:        McCage Properties, Restore Grounds Management
 *   (inactive):    Villa-May Construction (no longer active)
 *   (contractor):  DFW Installations (not a builder — third-party trim crew)
 *
 * Also: Dalton Whatley is the sales owner for every builder in Thomas's book
 * (RDR, Fig Tree, Laird, F7, Stoffels, Eugster, True Grit, McCage, Restore
 * Grounds). Adds Builder.salesOwnerId column + wires Dalton.
 *
 * Resolves the rollup InboxItems created by the first reassignment pass.
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
  // Resolve staff IDs
  const staff = await sql.query(
    `SELECT id, email FROM "Staff" WHERE email = ANY($1)`,
    [[
      'brittney.werner@abellumber.com',
      'chad.zeh@abellumber.com',
      'ben.wilson@abellumber.com',
      'thomas@abellumber.com',
      'dalton@abellumber.com',
    ]],
  )
  const ids = Object.fromEntries(staff.map((r) => [r.email, r.id]))
  const ben = ids['ben.wilson@abellumber.com']
  const thomas = ids['thomas@abellumber.com']
  const dalton = ids['dalton@abellumber.com']
  if (!ben || !thomas || !dalton) {
    console.error('Missing staff:', { ben, thomas, dalton })
    process.exit(1)
  }

  console.log('Staff resolved:')
  console.log(`  Ben Wilson:      ${ben}`)
  console.log(`  Thomas Robinson: ${thomas}`)
  console.log(`  Dalton Whatley:  ${dalton}`)

  // =========================================================================
  // STEP 1: Round-2 mapping — who gets which builder's jobs
  // =========================================================================
  const newAssignments = [
    // Ben Wilson: Imagination (customer lost), AGD, Royal Crest, Brookson (dormant)
    { builder: /imagination/i, pmId: ben, pmName: 'Ben Wilson' },
    { builder: /agd/i, pmId: ben, pmName: 'Ben Wilson' },
    { builder: /royal\s*crest/i, pmId: ben, pmName: 'Ben Wilson' },
    { builder: /brookson/i, pmId: ben, pmName: 'Ben Wilson' },
    // Thomas: McCage, Restore Grounds, Hayhurst, Haven Home Remodeling
    { builder: /mccage/i, pmId: thomas, pmName: 'Thomas Robinson' },
    { builder: /restore\s*grounds/i, pmId: thomas, pmName: 'Thomas Robinson' },
    { builder: /hayhurst/i, pmId: thomas, pmName: 'Thomas Robinson' },
    { builder: /haven\s*home/i, pmId: thomas, pmName: 'Thomas Robinson' },
    { builder: /tristar/i, pmId: thomas, pmName: 'Thomas Robinson' },
    // Villa-May: no longer active → set PMId NULL (below in builder-status step)
  ]

  // Pull affected jobs
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

  console.log(`\nRound-2 reassignments: ${reassignPlan.length}`)
  const byPM = {}
  for (const r of reassignPlan) byPM[r.newPMName] = (byPM[r.newPMName] || 0) + 1
  for (const [name, n] of Object.entries(byPM)) console.log(`  ${name.padEnd(20)} +${n}`)

  // =========================================================================
  // STEP 2: Builder status cleanup
  // =========================================================================
  const statusUpdates = []

  // Check the valid Builder status enum values
  const statusEnum = await sql.query(
    `SELECT unnest(enum_range(NULL::"AccountStatus"))::text AS val`,
  )
  const validStatuses = statusEnum.map((r) => r.val)
  console.log(`\nValid Builder statuses: ${validStatuses.join(', ')}`)

  // AccountStatus enum: PENDING, ACTIVE, SUSPENDED, CLOSED
  // Lost customer (no coming back) → CLOSED
  // Dormant / no-longer-active (might return) → SUSPENDED
  const lostStatus = validStatuses.includes('CLOSED') ? 'CLOSED' : 'SUSPENDED'
  const inactiveStatus = validStatuses.includes('SUSPENDED')
    ? 'SUSPENDED'
    : validStatuses.includes('CLOSED')
    ? 'CLOSED'
    : 'ACTIVE'

  statusUpdates.push({
    pattern: /imagination/i,
    newStatus: lostStatus,
    reason: 'Customer LOST (per Nate 2026-04-23)',
  })
  statusUpdates.push({
    pattern: /villa[\s\-]*may/i,
    newStatus: inactiveStatus,
    reason: 'No longer active (per Nate 2026-04-23)',
  })
  // DFW Installations: not a builder at all — mark INACTIVE with a flag note;
  // real fix is re-classifying associated jobs' builderName to the actual
  // customer, which Nate has to do manually.
  statusUpdates.push({
    pattern: /dfw\s*install/i,
    newStatus: inactiveStatus,
    reason: 'Third-party trim crew, not a customer (per Nate 2026-04-23)',
  })

  // =========================================================================
  // STEP 3: Add Builder.salesOwnerId column + wire Dalton to Thomas's book
  // =========================================================================
  const thomasBuilders = [
    /\brdr\b/i,
    /\bfig\s*tree\b/i,
    /\blaird\b/i,
    /\bf7\b/i,
    /\bstoffels?\b/i,
    /\beugster\b/i,
    /\btrue\s*grit\b/i,
    /mccage/i,
    /restore\s*grounds/i,
    /hayhurst/i,
    /haven\s*home/i,
    /tristar/i,
  ]

  const allBuilders = await sql.query(
    `SELECT id, "companyName" FROM "Builder" WHERE status::text != 'ARCHIVED'`,
  )
  const thomasBuilderIds = allBuilders
    .filter((b) => thomasBuilders.some((rx) => rx.test(b.companyName)))
    .map((b) => ({ id: b.id, name: b.companyName }))

  console.log(`\nSetting Dalton as salesOwner for ${thomasBuilderIds.length} builders:`)
  for (const b of thomasBuilderIds) console.log(`  ${b.name}`)

  if (!commit) {
    console.log('\n[DRY RUN] Re-run with --commit to apply.')
    return
  }

  // =========================================================================
  // APPLY
  // =========================================================================
  console.log('\n--- Applying ---')

  // A. Add salesOwnerId column if missing (idempotent)
  await sql.query(
    `ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "salesOwnerId" TEXT REFERENCES "Staff"(id)`,
  )
  await sql.query(
    `CREATE INDEX IF NOT EXISTS "Builder_salesOwnerId_idx" ON "Builder"("salesOwnerId")`,
  )
  console.log('✓ Builder.salesOwnerId column ensured')

  // B. Round-2 job reassignments
  let reassigned = 0
  for (const r of reassignPlan) {
    await sql.query(
      `UPDATE "Job" SET "assignedPMId" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [r.newPMId, r.id],
    )
    reassigned++
  }
  console.log(`✓ Reassigned ${reassigned} jobs`)

  // C. Villa-May jobs: set PMId NULL (customer dead; no active PM responsible)
  const villaMayResult = await sql.query(
    `UPDATE "Job" SET "assignedPMId" = NULL, "updatedAt" = NOW()
      WHERE "builderName" ~* 'villa[\\s\\-]*may'
        AND status::text = ANY($1)
      RETURNING id`,
    [ACTIVE_STATUSES],
  )
  console.log(`✓ Villa-May jobs unassigned: ${villaMayResult.length}`)

  // D. DFW Installations jobs: set PMId NULL + we'll make a specific InboxItem
  const dfwResult = await sql.query(
    `UPDATE "Job" SET "assignedPMId" = NULL, "updatedAt" = NOW()
      WHERE "builderName" ~* 'dfw\\s*install'
        AND status::text = ANY($1)
      RETURNING id`,
    [ACTIVE_STATUSES],
  )
  console.log(`✓ DFW Installations jobs unassigned: ${dfwResult.length}`)

  // E. Builder status updates
  for (const s of statusUpdates) {
    const patternStr = s.pattern.source
    const result = await sql.query(
      `UPDATE "Builder"
          SET status = $2::"AccountStatus", "updatedAt" = NOW()
        WHERE "companyName" ~* $1
        RETURNING "companyName"`,
      [patternStr, s.newStatus],
    )
    for (const r of result)
      console.log(`  ✓ ${r.companyName} → ${s.newStatus} (${s.reason})`)
  }

  // F. Set Dalton as salesOwner for Thomas's builders
  for (const b of thomasBuilderIds) {
    await sql.query(
      `UPDATE "Builder" SET "salesOwnerId" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [dalton, b.id],
    )
  }
  console.log(`✓ Dalton wired as salesOwner on ${thomasBuilderIds.length} builders`)

  // G. Resolve the rollup InboxItems from round-1 for builders we've now mapped
  const mappedBuilderNames = [
    'Imagination Homes',
    'AGD Homes',
    'Royal Crest Homes',
    'McCage Properties',
    'Restore Grounds Management',
    'Villa-May Construction',
    'DFW Installations',
    'Brookson Builders',
    'Hayhurst',
    'Haven Home Remodeling',
    'Tristar Built',
  ]
  const resolvedInbox = await sql.query(
    `UPDATE "InboxItem"
        SET status = 'RESOLVED', "updatedAt" = NOW()
      WHERE source = 'job-reassignment'
        AND status = 'PENDING'
        AND "entityId" = ANY($1)
      RETURNING id, "entityId"`,
    [mappedBuilderNames],
  )
  console.log(`✓ Resolved ${resolvedInbox.length} InboxItem rollups`)

  // H. One more specific InboxItem: DFW Installations needs manual job-builder fix
  if (dfwResult.length > 0) {
    await sql.query(
      `INSERT INTO "InboxItem" (id, type, title, description, status, priority, source, "entityType", "entityId", "createdAt", "updatedAt")
       VALUES ($1, 'DATA_QUALITY', $2, $3, 'PENDING', 'HIGH', 'job-reassignment', 'Job', 'dfw-installations-builder-misclass', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [
        `cmrb2_dfw_${Date.now().toString(36)}`,
        `Fix builder on ${dfwResult.length} DFW Installations jobs`,
        `DFW Installations is a third-party trim crew, not a builder. ${dfwResult.length} active jobs were incorrectly filed under it and are now unassigned. Open each job and correct "builderName" to the actual customer, then reassign PM.`,
      ],
    )
    console.log('✓ DFW Installations data-quality InboxItem created')
  }

  // =========================================================================
  // VERIFY
  // =========================================================================
  const verify = await sql.query(
    `SELECT COALESCE(s."firstName" || ' ' || s."lastName", 'UNASSIGNED') AS pm, COUNT(j.id)::int n
       FROM "Job" j
       LEFT JOIN "Staff" s ON j."assignedPMId" = s.id
      WHERE j.status::text = ANY($1)
      GROUP BY s.id, s."firstName", s."lastName"
      ORDER BY n DESC`,
    [ACTIVE_STATUSES],
  )
  console.log('\n--- Post-apply PM distribution ---')
  for (const r of verify) console.log(`  ${r.pm.padEnd(25)} ${r.n}`)

  const salesOwnerCheck = await sql.query(
    `SELECT b."companyName", s."firstName" || ' ' || s."lastName" AS sales_owner
       FROM "Builder" b
       LEFT JOIN "Staff" s ON b."salesOwnerId" = s.id
      WHERE b."salesOwnerId" IS NOT NULL
      ORDER BY b."companyName"`,
  )
  console.log('\n--- Builders with salesOwner wired ---')
  for (const r of salesOwnerCheck)
    console.log(`  ${r.companyName.padEnd(35)} → ${r.sales_owner}`)

  const remainingUnassigned = await sql.query(
    `SELECT COALESCE("builderName", '(null)') AS builder, COUNT(*)::int n
       FROM "Job"
      WHERE status::text = ANY($1)
        AND "assignedPMId" IS NULL
      GROUP BY "builderName"
      ORDER BY n DESC`,
    [ACTIVE_STATUSES],
  )
  console.log('\n--- Still unassigned by builder ---')
  for (const r of remainingUnassigned) console.log(`  ${r.builder.padEnd(35)} ${r.n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
