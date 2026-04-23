#!/usr/bin/env node
// scripts/backfill-activity-and-tasks.mjs
//
// Populates the Activity and Task tables from their source events so the new
// builder/sales/QC portals stop rendering empty-state.
//
// Four passes, each idempotent:
//   1. CommunicationLog → Activity (type=EMAIL/CALL/TEXT_MESSAGE/SITE_VISIT/NOTE)
//      Dedupe: Activity.sourceKey = "commlog:<id>"
//   2. OVERDUE Invoice  → Task (category=INVOICE_FOLLOW_UP, assigned to ACCOUNTING)
//      Dedupe: Task.sourceKey = "invoice:<id>:overdue"
//   3. FAIL Inspection  → PunchItem + Task
//      Dedupe: PunchItem.punchNumber = "PI-<inspectionId[:12]>"
//              Task.sourceKey       = "inspection:<inspectionId>:fail"
//   4. FAIL QualityCheck (legacy, not yet mirrored to Inspection)
//      → Inspection row + PunchItem + Task via the same dedupe above
//
// Dry-run by default. Pass --apply to actually write.
//
// USAGE:
//   node scripts/backfill-activity-and-tasks.mjs           # preview
//   node scripts/backfill-activity-and-tasks.mjs --apply   # execute
//
// Exit codes:
//   0  success (including no-op)
//   1  hard failure (connection lost, etc.)

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

// Counters we'll print at the end.
const counts = {
  activitiesScanned: 0,
  activitiesCreated: 0,
  activitiesSkipped: 0,
  tasksOverdueScanned: 0,
  tasksOverdueCreated: 0,
  tasksOverdueSkipped: 0,
  inspectionsFailScanned: 0,
  punchItemsCreated: 0,
  punchItemsSkipped: 0,
  tasksQCCreated: 0,
  tasksQCSkipped: 0,
  qcChecksScanned: 0,
  inspectionsMirrored: 0,
  inspectionsAlreadyMirrored: 0,
  errors: 0,
}

function log(...args) {
  console.log('[backfill]', ...args)
}

function err(...args) {
  console.error('[backfill][err]', ...args)
  counts.errors++
}

async function systemStaffId() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`,
  )
  return rows[0]?.id
}

async function findAssigneeForRole(role) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "role" = $1::"StaffRole"
         OR $1 = ANY(COALESCE(string_to_array("roles", ','), ARRAY[]::text[]))
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    role,
  )
  if (rows[0]?.id) return rows[0].id
  return systemStaffId()
}

// ── Pass 1: CommunicationLog → Activity ──────────────────────────────────

function channelToActivityType(channel) {
  const c = String(channel || '').toUpperCase()
  if (c === 'EMAIL') return 'EMAIL'
  if (c === 'PHONE' || c === 'VIDEO_CALL') return 'CALL'
  if (c === 'TEXT' || c === 'SMS') return 'TEXT_MESSAGE'
  if (c === 'IN_PERSON') return 'SITE_VISIT'
  return 'NOTE'
}

async function backfillCommLogActivities() {
  log('── Pass 1/4: CommunicationLog → Activity')

  const rows = await prisma.$queryRawUnsafe(`
    SELECT cl."id", cl."builderId", cl."jobId", cl."communityId",
           cl."staffId", cl."channel"::text AS "channel",
           cl."direction"::text AS "direction",
           cl."subject", cl."body", cl."sentAt", cl."duration", cl."createdAt"
      FROM "CommunicationLog" cl
      LEFT JOIN "Activity" a ON a."sourceKey" = ('commlog:' || cl."id")
     WHERE a."id" IS NULL
     ORDER BY cl."createdAt" DESC
  `)
  counts.activitiesScanned = rows.length
  log(`scanned ${rows.length} comm-log rows without mirrored activities`)

  const sysStaff = await systemStaffId()

  for (const c of rows) {
    const staffId = c.staffId || sysStaff
    if (!staffId) {
      counts.activitiesSkipped++
      continue
    }

    const activityType = channelToActivityType(c.channel)
    const subject =
      c.subject || `${c.channel || 'NOTE'} ${c.direction || ''}`.trim()
    const notes = c.body ? String(c.body).slice(0, 500) : null
    const durationMins =
      typeof c.duration === 'number' ? Math.round(c.duration / 60) : null
    const completedAt = c.sentAt || c.createdAt
    const sourceKey = `commlog:${c.id}`
    const id = `act_bf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`

    if (!APPLY) {
      counts.activitiesCreated++
      continue
    }

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Activity" (
           "id", "staffId", "builderId", "jobId", "communityId",
           "activityType", "subject", "notes",
           "completedAt", "durationMins",
           "sourceKey", "createdAt"
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6::"ActivityType", $7, $8,
           $9, $10,
           $11, $12
         )
         ON CONFLICT ("sourceKey") DO NOTHING`,
        id,
        staffId,
        c.builderId,
        c.jobId,
        c.communityId,
        activityType,
        subject,
        notes,
        completedAt,
        durationMins,
        sourceKey,
        c.createdAt, // preserve original timeline
      )
      counts.activitiesCreated++
    } catch (e) {
      err(`commlog ${c.id}:`, e?.message?.slice(0, 140))
      counts.activitiesSkipped++
    }
  }
  log(
    `created ${counts.activitiesCreated}, skipped ${counts.activitiesSkipped}`,
  )
}

// ── Pass 2: OVERDUE Invoice → Task ───────────────────────────────────────

async function backfillOverdueTasks() {
  log('── Pass 2/4: OVERDUE invoices → Task')

  const rows = await prisma.$queryRawUnsafe(`
    SELECT i."id", i."invoiceNumber", i."builderId",
           i."total", i."amountPaid", i."dueDate",
           (i."total" - COALESCE(i."amountPaid", 0))::float AS "balance",
           b."companyName" AS "builderName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      LEFT JOIN "Task" t ON t."sourceKey" = ('invoice:' || i."id" || ':overdue')
     WHERE t."id" IS NULL
       AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
       AND i."dueDate" IS NOT NULL
       AND i."dueDate" < NOW()
       AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
     ORDER BY i."dueDate" ASC
  `)
  counts.tasksOverdueScanned = rows.length
  log(`scanned ${rows.length} overdue invoices without a collection task`)

  const assignee = await findAssigneeForRole('ACCOUNTING')
  if (!assignee) {
    log('no Staff to assign overdue tasks to — aborting pass 2')
    counts.tasksOverdueSkipped = rows.length
    return
  }

  for (const inv of rows) {
    const balance = Number(inv.balance || 0)
    if (balance <= 0) {
      counts.tasksOverdueSkipped++
      continue
    }
    const sourceKey = `invoice:${inv.id}:overdue`
    const title = `Collect $${balance.toFixed(2)} from ${inv.builderName || 'builder'}`
    const description = `Invoice ${inv.invoiceNumber} is overdue. Balance: $${balance.toFixed(2)}. Due: ${
      inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : 'unknown'
    }.`
    const id = `tsk_bf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`

    if (!APPLY) {
      counts.tasksOverdueCreated++
      continue
    }

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Task" (
           "id", "assigneeId", "creatorId", "builderId",
           "title", "description", "priority", "status", "category",
           "sourceKey", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $2, $3,
           $4, $5, 'HIGH'::"TaskPriority", 'TODO'::"TaskStatus", 'INVOICE_FOLLOW_UP'::"TaskCategory",
           $6, NOW(), NOW()
         )
         ON CONFLICT ("sourceKey") DO NOTHING`,
        id,
        assignee,
        inv.builderId,
        title,
        description,
        sourceKey,
      )
      counts.tasksOverdueCreated++
    } catch (e) {
      err(`invoice ${inv.id}:`, e?.message?.slice(0, 140))
      counts.tasksOverdueSkipped++
    }
  }
  log(
    `created ${counts.tasksOverdueCreated}, skipped ${counts.tasksOverdueSkipped}`,
  )
}

// ── Pass 3: FAIL Inspection → PunchItem + Task ───────────────────────────

async function ensureInstallationForJob(jobId, inspectionId) {
  if (!jobId) return null
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Installation" WHERE "jobId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    jobId,
  )
  if (existing[0]?.id) return existing[0].id

  if (!APPLY) {
    // Dry-run — pretend we'd create one
    return `dry_run_install_${jobId.slice(0, 8)}`
  }

  const installId = `inst_bf_${Math.random().toString(36).slice(2, 10)}`
  const installNumber = `INS-QC-${String(inspectionId).slice(0, 8)}`
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Installation" (
         "id", "jobId", "installNumber", "scopeNotes", "status",
         "passedQC", "beforePhotos", "afterPhotos",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4, 'SCHEDULED'::"InstallationStatus",
         false, ARRAY[]::text[], ARRAY[]::text[],
         NOW(), NOW()
       )
       ON CONFLICT ("installNumber") DO NOTHING`,
      installId,
      jobId,
      installNumber,
      'Auto-created by QC failure backfill.',
    )
    const post = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Installation" WHERE "installNumber" = $1 LIMIT 1`,
      installNumber,
    )
    return post[0]?.id || installId
  } catch (e) {
    err(`install stub for job ${jobId}:`, e?.message?.slice(0, 140))
    return null
  }
}

async function backfillFailInspections() {
  log('── Pass 3/4: FAILED Inspections → PunchItem + Task')

  const rows = await prisma.$queryRawUnsafe(`
    SELECT i."id", i."jobId", i."notes", i."inspectorId", i."createdAt",
           j."jobNumber"
      FROM "Inspection" i
      LEFT JOIN "Job" j ON j."id" = i."jobId"
     WHERE UPPER(i."status") IN ('FAIL', 'FAILED')
     ORDER BY i."createdAt" DESC
  `)
  counts.inspectionsFailScanned = rows.length
  log(`scanned ${rows.length} failed Inspection rows`)

  const pmAssignee = await findAssigneeForRole('PROJECT_MANAGER')

  for (const insp of rows) {
    const punchNumber = `PI-${String(insp.id).slice(0, 12)}`
    const taskKey = `inspection:${insp.id}:fail`

    // PunchItem side
    const existingPunch = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "PunchItem" WHERE "punchNumber" = $1 LIMIT 1`,
      punchNumber,
    )
    if (existingPunch.length > 0) {
      counts.punchItemsSkipped++
    } else if (!insp.jobId) {
      counts.punchItemsSkipped++
    } else {
      const installationId = await ensureInstallationForJob(insp.jobId, insp.id)
      if (!installationId) {
        counts.punchItemsSkipped++
      } else if (APPLY) {
        try {
          const pid = `pun_bf_${Math.random().toString(36).slice(2, 10)}`
          const description = insp.notes
            ? `QC failure: ${String(insp.notes).slice(0, 400)}`
            : 'QC failure — see inspection notes'
          await prisma.$executeRawUnsafe(
            `INSERT INTO "PunchItem" (
               "id", "punchNumber", "installationId", "jobId",
               "description", "severity", "status",
               "reportedById", "photoUrls", "fixPhotoUrls",
               "createdAt", "updatedAt"
             ) VALUES (
               $1, $2, $3, $4,
               $5, 'MAJOR', 'OPEN',
               $6, ARRAY[]::text[], ARRAY[]::text[],
               $7, NOW()
             )
             ON CONFLICT ("punchNumber") DO NOTHING`,
            pid,
            punchNumber,
            installationId,
            insp.jobId,
            description,
            insp.inspectorId,
            insp.createdAt,
          )
          counts.punchItemsCreated++
        } catch (e) {
          err(`punch for inspection ${insp.id}:`, e?.message?.slice(0, 140))
          counts.punchItemsSkipped++
        }
      } else {
        counts.punchItemsCreated++
      }
    }

    // Task side
    const existingTask = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Task" WHERE "sourceKey" = $1 LIMIT 1`,
      taskKey,
    )
    if (existingTask.length > 0) {
      counts.tasksQCSkipped++
      continue
    }
    if (!pmAssignee) {
      counts.tasksQCSkipped++
      continue
    }
    const jobLabel = insp.jobNumber
      ? `Job ${insp.jobNumber}`
      : insp.jobId
        ? `Job ${String(insp.jobId).slice(0, 8)}`
        : 'unknown job'
    const title = `Resolve QC failure on ${jobLabel}`
    const description = `QC inspection ${insp.id} failed.${
      insp.notes ? ` Inspector notes: ${String(insp.notes).slice(0, 300)}` : ''
    } Triage defects, document fix, and re-inspect before release.`
    const id = `tsk_bf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`

    if (!APPLY) {
      counts.tasksQCCreated++
      continue
    }

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Task" (
           "id", "assigneeId", "creatorId", "jobId",
           "title", "description", "priority", "status", "category",
           "sourceKey", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $2, $3,
           $4, $5, 'HIGH'::"TaskPriority", 'TODO'::"TaskStatus", 'QUALITY_REVIEW'::"TaskCategory",
           $6, $7, NOW()
         )
         ON CONFLICT ("sourceKey") DO NOTHING`,
        id,
        pmAssignee,
        insp.jobId,
        title,
        description,
        taskKey,
        insp.createdAt,
      )
      counts.tasksQCCreated++
    } catch (e) {
      err(`task for inspection ${insp.id}:`, e?.message?.slice(0, 140))
      counts.tasksQCSkipped++
    }
  }
  log(
    `punch created ${counts.punchItemsCreated}/${counts.punchItemsSkipped} skipped; ` +
      `task created ${counts.tasksQCCreated}/${counts.tasksQCSkipped} skipped`,
  )
}

// ── Pass 4: FAIL QualityCheck (legacy) → mirror into Inspection ──────────

async function backfillQualityCheckToInspection() {
  log('── Pass 4/4: QualityCheck → Inspection mirror (legacy)')

  // Unmirrored QC rows don't yet have an Inspection with "[qc:<id>]" tag.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT qc."id", qc."jobId", qc."checkType"::text AS "checkType",
           qc."result"::text AS "result", qc."notes", qc."inspectorId", qc."createdAt"
      FROM "QualityCheck" qc
     ORDER BY qc."createdAt" DESC
  `)
  counts.qcChecksScanned = rows.length
  log(`scanned ${rows.length} QualityCheck rows for mirroring`)

  for (const qc of rows) {
    const dedupeTag = `[qc:${qc.id}]`
    const existing = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Inspection" WHERE "notes" LIKE $1 LIMIT 1`,
      `%${dedupeTag}%`,
    )
    if (existing.length > 0) {
      counts.inspectionsAlreadyMirrored++
      continue
    }

    if (!APPLY) {
      counts.inspectionsMirrored++
      continue
    }

    const statusMap = { PASS: 'PASSED', FAIL: 'FAILED', CONDITIONAL_PASS: 'CONDITIONAL' }
    const status = statusMap[qc.result] || 'COMPLETED'
    const passRate = qc.result === 'PASS' ? 1 : qc.result === 'FAIL' ? 0 : 0.5
    const combinedNotes = `${qc.notes ? qc.notes + ' ' : ''}${dedupeTag}`

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Inspection" (
           "templateId", "jobId", "inspectorId", "status",
           "scheduledDate", "completedDate", "results", "passRate",
           "notes", "photos",
           "createdAt", "updatedAt"
         ) VALUES (
           NULL, $1, $2, $3,
           $4, $4, $5, $6,
           $7, '[]'::jsonb,
           $4, NOW()
         )`,
        qc.jobId,
        qc.inspectorId,
        status,
        qc.createdAt,
        JSON.stringify({
          checkType: qc.checkType,
          result: qc.result,
          source: 'QualityCheck',
          sourceId: qc.id,
        }),
        passRate,
        combinedNotes,
      )
      counts.inspectionsMirrored++
    } catch (e) {
      err(`mirror qc ${qc.id}:`, e?.message?.slice(0, 140))
    }
  }
  log(
    `mirrored ${counts.inspectionsMirrored}, already-mirrored ${counts.inspectionsAlreadyMirrored}`,
  )
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  log(APPLY ? 'APPLY MODE — writes will happen' : 'DRY RUN — no writes')
  log(`started at ${new Date().toISOString()}`)

  try {
    await backfillCommLogActivities()
    await backfillOverdueTasks()
    // Run pass 4 before pass 3 so newly mirrored Inspections get caught by
    // the pass-3 fail sweep in the same run (if apply mode).
    await backfillQualityCheckToInspection()
    await backfillFailInspections()
  } catch (e) {
    err('fatal:', e?.message?.slice(0, 300))
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }

  log('── summary')
  console.log(JSON.stringify(counts, null, 2))
  log(APPLY ? 'apply complete' : 'dry run complete (pass --apply to write)')
}

main()
