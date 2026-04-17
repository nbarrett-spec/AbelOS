export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/automations/dunnage-to-final-front
//
// POST — Trigger the dunnage door → final front door workflow
//
// When a house reaches the "Final Front" stage (usually during finishing),
// this automation:
//   1. Finds the job's dunnage door line items (sales orders or deliveries)
//   2. Creates a task to PICK UP the dunnage door from the jobsite
//   3. Creates a task/installation for the FINAL FRONT door delivery+install
//   4. Updates the job's status notes
//   5. Logs the automation trigger in AuditLog
//
// Can be triggered:
//   • Manually from the job detail page ("Trigger Final Front" button)
//   • Automatically when job status changes to a configured stage
//   • Via the automations page rule engine
//
// GET — Check which jobs have dunnage doors that haven't been swapped yet
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Find jobs that have dunnage door products but no final front trigger yet
    // We look for jobs with line items containing "dunnage" in the product name
    // that don't have a corresponding "final front" task
    const jobsWithDunnage = await prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT
        j."id",
        j."jobNumber",
        j."jobAddress",
        j."status",
        j."builderName",
        j."community",
        j."scheduledDate",
        (
          SELECT COUNT(*)::int
          FROM "SalesOrderLineItem" soli
          JOIN "SalesOrder" so ON so."id" = soli."salesOrderId"
          WHERE so."jobId" = j."id"
          AND (
            LOWER(soli."productName") LIKE '%dunnage%'
            OR LOWER(soli."description") LIKE '%dunnage%'
          )
        ) AS "dunnageDoorCount",
        (
          SELECT COUNT(*)::int
          FROM "Task" t
          WHERE t."jobId" = j."id"
          AND (
            LOWER(t."title") LIKE '%final front%'
            OR LOWER(t."title") LIKE '%dunnage pickup%'
            OR LOWER(t."title") LIKE '%dunnage swap%'
          )
        ) AS "finalFrontTaskCount"
      FROM "Job" j
      WHERE j."status" NOT IN ('COMPLETE', 'INVOICED', 'CANCELLED')
      AND EXISTS (
        SELECT 1
        FROM "SalesOrderLineItem" soli
        JOIN "SalesOrder" so ON so."id" = soli."salesOrderId"
        WHERE so."jobId" = j."id"
        AND (
          LOWER(soli."productName") LIKE '%dunnage%'
          OR LOWER(soli."description") LIKE '%dunnage%'
        )
      )
      ORDER BY j."scheduledDate" ASC NULLS LAST
    `)

    const needsSwap = jobsWithDunnage.filter((j: any) => j.finalFrontTaskCount === 0)
    const alreadyTriggered = jobsWithDunnage.filter((j: any) => j.finalFrontTaskCount > 0)

    return safeJson({
      summary: {
        totalWithDunnage: jobsWithDunnage.length,
        needsSwap: needsSwap.length,
        alreadyTriggered: alreadyTriggered.length,
      },
      jobsNeedingSwap: needsSwap.map((j: any) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        builderName: j.builderName,
        community: j.community,
        jobAddress: j.jobAddress,
        status: j.status,
        scheduledDate: j.scheduledDate,
        dunnageDoorCount: j.dunnageDoorCount,
      })),
      jobsAlreadyTriggered: alreadyTriggered.map((j: any) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        builderName: j.builderName,
        status: j.status,
      })),
    })
  } catch (error: any) {
    return safeJson({ error: error.message || 'Failed to check dunnage status' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || 'system'

  let body: { jobId?: string; jobIds?: string[]; autoAssign?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    return safeJson({ error: 'Request body required with jobId or jobIds' }, { status: 400 })
  }

  const jobIds = body.jobIds || (body.jobId ? [body.jobId] : [])
  if (jobIds.length === 0) {
    return safeJson({ error: 'Provide jobId or jobIds' }, { status: 400 })
  }

  const results: any[] = []

  for (const jobId of jobIds) {
    try {
      // Verify job exists
      const jobs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "jobNumber", "jobAddress", "builderName", "status"
         FROM "Job" WHERE "id" = $1 LIMIT 1`,
        jobId
      )
      if (jobs.length === 0) {
        results.push({ jobId, success: false, error: 'Job not found' })
        continue
      }
      const job = jobs[0]

      // Check for existing final front tasks (idempotency)
      const existingTasks = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id" FROM "Task"
         WHERE "jobId" = $1
         AND (LOWER("title") LIKE '%final front%' OR LOWER("title") LIKE '%dunnage swap%')
         LIMIT 1`,
        jobId
      )
      if (existingTasks.length > 0) {
        results.push({
          jobId,
          jobNumber: job.jobNumber,
          success: false,
          error: 'Final front workflow already triggered for this job',
          existingTaskId: existingTasks[0].id,
        })
        continue
      }

      // Count dunnage doors on this job
      const dunnageItems = await prisma.$queryRawUnsafe<any[]>(
        `SELECT soli."id", soli."productName", soli."quantity", so."soNumber"
         FROM "SalesOrderLineItem" soli
         JOIN "SalesOrder" so ON so."id" = soli."salesOrderId"
         WHERE so."jobId" = $1
         AND (
           LOWER(soli."productName") LIKE '%dunnage%'
           OR LOWER(soli."description") LIKE '%dunnage%'
         )`,
        jobId
      )

      // ── Create Task 1: Dunnage Door Pickup ──────────────────────────
      const pickupTaskId = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "Task" (
          "id", "assigneeId", "creatorId", "jobId", "title", "description",
          "category", "priority", "status", "dueDate", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $1, $2,
          $3, $4,
          'DELIVERY', 'HIGH', 'TODO',
          NOW() + INTERVAL '3 days',
          NOW(), NOW()
        ) RETURNING "id"`,
        staffId,
        jobId,
        `Dunnage Door Pickup — ${job.jobNumber}`,
        `AUTOMATED: Pick up ${dunnageItems.length} dunnage door(s) from ${job.jobAddress || 'jobsite'}.\n\n` +
          `Dunnage items:\n${dunnageItems.map((d: any) => `  • ${d.productName} (qty: ${d.quantity}) — SO: ${d.soNumber}`).join('\n')}\n\n` +
          `Return dunnage door(s) to warehouse for reuse or disposal.\n` +
          `This task was auto-generated by the Final Front workflow trigger.`
      )

      // ── Create Task 2: Final Front Door Install ─────────────────────
      const installTaskId = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "Task" (
          "id", "assigneeId", "creatorId", "jobId", "title", "description",
          "category", "priority", "status", "dueDate", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $1, $2,
          $3, $4,
          'INSTALLATION', 'HIGH', 'TODO',
          NOW() + INTERVAL '5 days',
          NOW(), NOW()
        ) RETURNING "id"`,
        staffId,
        jobId,
        `Final Front Door — Deliver & Install — ${job.jobNumber}`,
        `AUTOMATED: Deliver and install the Final Front door at ${job.jobAddress || 'jobsite'}.\n\n` +
          `Steps:\n` +
          `  1. Verify final front door is in stock / ordered\n` +
          `  2. Coordinate with builder for install date\n` +
          `  3. Schedule crew for delivery + install\n` +
          `  4. Remove dunnage door (if not already picked up)\n` +
          `  5. Install final front door\n` +
          `  6. Take before/after photos\n` +
          `  7. Get builder sign-off\n\n` +
          `Builder: ${job.builderName}\n` +
          `This task was auto-generated by the Final Front workflow trigger.`
      )

      // ── Create Decision Note ────────────────────────────────────────
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DecisionNote" (
          "id", "jobId", "staffId", "note", "category", "createdAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, 'AUTOMATION', NOW()
        )`,
        jobId,
        staffId,
        `Final Front workflow triggered. ${dunnageItems.length} dunnage door(s) flagged for pickup. ` +
          `Two tasks created: dunnage pickup and final front install.`
      )

      // ── Audit Log ───────────────────────────────────────────────────
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AuditLog" (
          "id", "action", "entity", "entityId", "staffId",
          "details", "createdAt"
        ) VALUES (
          gen_random_uuid()::text, 'AUTOMATION_TRIGGER', 'Job', $1, $2,
          $3::jsonb, NOW()
        )`,
        jobId,
        staffId,
        JSON.stringify({
          automation: 'dunnage-to-final-front',
          dunnageItems: dunnageItems.length,
          pickupTaskId: pickupTaskId[0]?.id,
          installTaskId: installTaskId[0]?.id,
        })
      )

      results.push({
        jobId,
        jobNumber: job.jobNumber,
        success: true,
        dunnageDoorsFound: dunnageItems.length,
        tasksCreated: {
          pickupTask: pickupTaskId[0]?.id,
          installTask: installTaskId[0]?.id,
        },
      })
    } catch (error: any) {
      results.push({ jobId, success: false, error: error.message })
    }
  }

  const successCount = results.filter((r) => r.success).length
  return safeJson({
    triggered: successCount,
    total: jobIds.length,
    results,
  })
}
