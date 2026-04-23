/**
 * Task Event Helpers
 *
 * Emit Task rows as side-effects of primary mutations. Each helper is
 * idempotent — a retry with the same sourceKey is a no-op.
 *
 * Callers should:
 *  - Call AFTER the primary mutation succeeds
 *  - Fire-and-forget (`.catch(() => {})`)
 *  - Never let a task-creation failure roll back the main action
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type TaskEmitResult = {
  ok: boolean
  action: string
  detail?: string
  taskId?: string
}

type BaseTask = {
  sourceKey: string
  title: string
  description?: string | null
  assigneeId: string
  creatorId?: string | null // defaults to assignee
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category?:
    | 'GENERAL'
    | 'READINESS_CHECK'
    | 'MATERIAL_VERIFICATION'
    | 'BUILDER_COMMUNICATION'
    | 'CREW_DISPATCH'
    | 'QUALITY_REVIEW'
    | 'INVOICE_FOLLOW_UP'
    | 'SCHEDULING'
    | 'EXCEPTION_RESOLUTION'
  jobId?: string | null
  builderId?: string | null
  communityId?: string | null
  dueDate?: Date | null
}

// ── helpers ──────────────────────────────────────────────────────────────

async function systemStaffId(): Promise<string> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`,
  )
  return rows[0]?.id ?? 'system'
}

/**
 * Find the staff best suited to own the given role for a task.
 * Order of precedence:
 *  1. Assigned PM on the Job, if provided
 *  2. Any Staff with role = role
 *  3. Oldest Staff (system fallback)
 */
async function findAssigneeForRole(
  role: 'PROJECT_MANAGER' | 'ACCOUNTING' | 'DRIVER' | 'QC_INSPECTOR' | 'WAREHOUSE_LEAD',
  opts?: { jobId?: string | null },
): Promise<string> {
  if (opts?.jobId) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "assignedPMId" FROM "Job" WHERE "id" = $1 LIMIT 1`,
      opts.jobId,
    )
    const pm = rows[0]?.assignedPMId
    if (pm && role === 'PROJECT_MANAGER') return pm
  }
  const roleRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "role" = $1::"StaffRole"
         OR $1 = ANY(COALESCE(string_to_array("roles", ','), ARRAY[]::text[]))
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    role,
  )
  if (roleRows[0]?.id) return roleRows[0].id
  return systemStaffId()
}

/**
 * Core emitter — all typed helpers delegate to this.
 * Idempotent via Task.sourceKey unique key.
 */
async function emitTask(t: BaseTask): Promise<TaskEmitResult> {
  try {
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Task" WHERE "sourceKey" = $1 LIMIT 1`,
      t.sourceKey,
    )
    if (existing.length > 0) {
      return { ok: true, action: 'emitTask', detail: 'already_emitted', taskId: existing[0].id }
    }

    const id = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" (
         "id", "assigneeId", "creatorId", "jobId", "builderId", "communityId",
         "title", "description", "priority", "status", "category",
         "dueDate", "sourceKey", "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9::"TaskPriority", 'TODO'::"TaskStatus", $10::"TaskCategory",
         $11, $12, NOW(), NOW()
       )
       ON CONFLICT ("sourceKey") DO NOTHING`,
      id,
      t.assigneeId,
      t.creatorId ?? t.assigneeId,
      t.jobId ?? null,
      t.builderId ?? null,
      t.communityId ?? null,
      t.title,
      t.description ?? null,
      t.priority || 'MEDIUM',
      t.category || 'GENERAL',
      t.dueDate ?? null,
      t.sourceKey,
    )

    return { ok: true, action: 'emitTask', detail: 'inserted', taskId: id }
  } catch (e: any) {
    logger.error('task_emit_failed', e, { sourceKey: t.sourceKey, title: t.title })
    return { ok: false, action: 'emitTask', detail: e?.message?.slice(0, 200) }
  }
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Create a Task when an order hits RECEIVED.
 * Assigned to: Job's PM if present, else any PM, else system.
 */
export async function createTaskForOrderReceived(orderId: string): Promise<TaskEmitResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT o."id", o."orderNumber", o."builderId", o."deliveryDate",
              (SELECT j."id" FROM "Job" j WHERE j."orderId" = o."id" LIMIT 1) AS "jobId",
              b."companyName" AS "builderName"
         FROM "Order" o
         LEFT JOIN "Builder" b ON b."id" = o."builderId"
        WHERE o."id" = $1 LIMIT 1`,
      orderId,
    )
    if (rows.length === 0) return { ok: false, action: 'createTaskForOrderReceived', detail: 'order_not_found' }
    const o = rows[0]
    const jobId = o.jobId ?? null

    const assigneeId = await findAssigneeForRole('PROJECT_MANAGER', { jobId })
    const title = `Confirm ${o.orderNumber}`
    const description = o.builderName
      ? `Review order ${o.orderNumber} for ${o.builderName} and move to CONFIRMED once verified.`
      : `Review order ${o.orderNumber} and move to CONFIRMED once verified.`

    return emitTask({
      sourceKey: `order:${orderId}:received`,
      title,
      description,
      assigneeId,
      jobId,
      builderId: o.builderId || null,
      priority: 'MEDIUM',
      category: 'READINESS_CHECK',
      dueDate: o.deliveryDate ? new Date(o.deliveryDate) : null,
    })
  } catch (e: any) {
    logger.error('createTaskForOrderReceived_failed', e, { orderId })
    return { ok: false, action: 'createTaskForOrderReceived', detail: e?.message }
  }
}

/**
 * Create a Task for collections when an invoice becomes OVERDUE.
 * Assigned to: any ACCOUNTING staff.
 */
export async function createTaskForOverdueInvoice(invoiceId: string): Promise<TaskEmitResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."id", i."invoiceNumber", i."builderId", i."total", i."amountPaid", i."dueDate",
              b."companyName" AS "builderName"
         FROM "Invoice" i
         LEFT JOIN "Builder" b ON b."id" = i."builderId"
        WHERE i."id" = $1 LIMIT 1`,
      invoiceId,
    )
    if (rows.length === 0) return { ok: false, action: 'createTaskForOverdueInvoice', detail: 'invoice_not_found' }
    const inv = rows[0]

    const balance = Number(inv.total || 0) - Number(inv.amountPaid || 0)
    if (balance <= 0) {
      return { ok: true, action: 'createTaskForOverdueInvoice', detail: 'no_balance' }
    }

    const assigneeId = await findAssigneeForRole('ACCOUNTING')
    const builderLabel = inv.builderName || 'builder'
    const title = `Collect $${balance.toFixed(2)} from ${builderLabel}`
    const description = `Invoice ${inv.invoiceNumber} is overdue. Balance: $${balance.toFixed(2)}. Due date: ${
      inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : 'unknown'
    }.`

    return emitTask({
      sourceKey: `invoice:${invoiceId}:overdue`,
      title,
      description,
      assigneeId,
      builderId: inv.builderId || null,
      priority: 'HIGH',
      category: 'INVOICE_FOLLOW_UP',
    })
  } catch (e: any) {
    logger.error('createTaskForOverdueInvoice_failed', e, { invoiceId })
    return { ok: false, action: 'createTaskForOverdueInvoice', detail: e?.message }
  }
}

/**
 * Create a Task when an Inspection (or QualityCheck) fails.
 * Assigned to: Job's PM if present, else any PM.
 */
export async function createTaskForQCFailure(params: {
  inspectionId: string
  jobId?: string | null
  jobNumber?: string | null
  notes?: string | null
}): Promise<TaskEmitResult> {
  try {
    const { inspectionId, notes } = params
    let jobId = params.jobId ?? null
    let jobNumber = params.jobNumber ?? null

    if (jobId && !jobNumber) {
      const jobRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "jobNumber" FROM "Job" WHERE "id" = $1 LIMIT 1`,
        jobId,
      )
      jobNumber = jobRows[0]?.jobNumber ?? null
    }

    const assigneeId = await findAssigneeForRole('PROJECT_MANAGER', { jobId })
    const labelJob = jobNumber ? `Job ${jobNumber}` : jobId ? `Job ${jobId.slice(0, 8)}` : 'unknown job'
    const title = `Resolve QC failure on ${labelJob}`
    const description =
      `QC inspection ${inspectionId} failed.${notes ? ` Inspector notes: ${notes}` : ''} ` +
      `Triage the defects, document the fix, and re-inspect before release.`

    return emitTask({
      sourceKey: `inspection:${inspectionId}:fail`,
      title,
      description,
      assigneeId,
      jobId,
      priority: 'HIGH',
      category: 'QUALITY_REVIEW',
    })
  } catch (e: any) {
    logger.error('createTaskForQCFailure_failed', e, { inspectionId: params.inspectionId })
    return { ok: false, action: 'createTaskForQCFailure', detail: e?.message }
  }
}

/**
 * Create a Task when a delivery is rescheduled.
 * Assigned to: dispatcher (WAREHOUSE_LEAD as closest available role), with
 * delivery driver as a fallback.
 */
export async function createTaskForDeliveryReschedule(params: {
  deliveryId: string
  oldDate?: Date | string | null
  newDate?: Date | string | null
  jobId?: string | null
  reason?: string | null
}): Promise<TaskEmitResult> {
  try {
    const { deliveryId, oldDate, newDate, reason } = params
    let jobId = params.jobId ?? null
    let jobNumber: string | null = null
    let deliveryNumber: string | null = null

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."jobId", j."jobNumber"
         FROM "Delivery" d
         LEFT JOIN "Job" j ON j."id" = d."jobId"
        WHERE d."id" = $1 LIMIT 1`,
      deliveryId,
    )
    if (rows.length > 0) {
      jobId = jobId ?? rows[0].jobId
      jobNumber = rows[0].jobNumber ?? null
      deliveryNumber = rows[0].deliveryNumber ?? null
    }

    const assigneeId = await findAssigneeForRole('WAREHOUSE_LEAD', { jobId })
    const label = deliveryNumber || `DELV-${deliveryId.slice(0, 8)}`
    const title = `Re-route delivery ${label}`
    const fmt = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString().slice(0, 10) : 'TBD'
    const description =
      `Delivery ${label}${jobNumber ? ` (Job ${jobNumber})` : ''} moved from ${fmt(oldDate)} to ${fmt(newDate)}.` +
      (reason ? ` Reason: ${reason}.` : '') +
      ` Confirm crew capacity and notify the builder.`

    // sourceKey includes newDate so each reschedule produces a distinct task
    const dateTag = newDate ? new Date(newDate).toISOString().slice(0, 10) : 'unset'
    return emitTask({
      sourceKey: `delivery:${deliveryId}:reschedule:${dateTag}`,
      title,
      description,
      assigneeId,
      jobId,
      priority: 'HIGH',
      category: 'CREW_DISPATCH',
      dueDate: newDate ? new Date(newDate) : null,
    })
  } catch (e: any) {
    logger.error('createTaskForDeliveryReschedule_failed', e, { deliveryId: params.deliveryId })
    return { ok: false, action: 'createTaskForDeliveryReschedule', detail: e?.message }
  }
}
