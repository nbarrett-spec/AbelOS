/**
 * Order Lifecycle Cascades
 *
 * Single source of truth for the downstream side-effects triggered by
 * Order status transitions. Each helper is idempotent — safe to call
 * multiple times for the same order. Callers should fire-and-forget
 * (`.catch(() => {})`) unless they need to block on the cascade.
 *
 * Triggered from:
 *  - POST   /api/ops/orders                       (when initial status >= CONFIRMED)
 *  - PATCH  /api/ops/orders/[id]                  (on any status update)
 *  - POST   /api/ops/delivery/[deliveryId]/complete (via onOrderDelivered)
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

type CascadeResult = {
  ok: boolean
  action: string
  detail?: string
  jobId?: string
  invoiceId?: string
}

/**
 * onOrderConfirmed — fires when an Order moves past RECEIVED into CONFIRMED.
 * Creates a Job row (if one isn't already linked) so PMs see it in the board.
 * Also puts an InboxItem in the PM's queue asking them to schedule/claim it.
 */
export async function onOrderConfirmed(orderId: string): Promise<CascadeResult> {
  try {
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT o."id", o."orderNumber", o."builderId", o."status"::text AS status,
              o."deliveryDate", b."companyName" AS "builderName"
       FROM "Order" o
       LEFT JOIN "Builder" b ON b."id" = o."builderId"
       WHERE o."id" = $1`,
      orderId
    )
    if (orders.length === 0) return { ok: false, action: 'onOrderConfirmed', detail: 'order_not_found' }
    const order = orders[0]

    // Idempotency: if a Job is already linked, do nothing.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Job" WHERE "orderId" = $1 LIMIT 1`,
      orderId
    )
    if (existing.length > 0) {
      return { ok: true, action: 'onOrderConfirmed', detail: 'job_already_linked', jobId: existing[0].id }
    }

    // Derive a job number — JOB-YYYY-NNNN based on current MAX
    const year = new Date().getFullYear()
    const maxRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
       FROM "Job" WHERE "jobNumber" LIKE $1`,
      `JOB-${year}-%`
    )
    const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
    const jobNumber = `JOB-${year}-${String(nextNumber).padStart(4, '0')}`

    const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Job" (
        "id", "jobNumber", "orderId",
        "builderName", "scopeType", "status",
        "scheduledDate",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3,
        $4, 'DOORS_AND_TRIM'::"ScopeType", 'CREATED'::"JobStatus",
        $5,
        NOW(), NOW()
      )`,
      jobId, jobNumber, orderId,
      order.builderName || 'Unknown Builder',
      order.deliveryDate ? new Date(order.deliveryDate) : null,
    )

    // Put it on the PM queue — no PM auto-assigned yet, so route to dispatch.
    await safeInboxInsert({
      type: 'JOB_ASSIGNMENT',
      source: 'order-lifecycle',
      title: `New job ${jobNumber} — ${order.builderName || 'Unknown'}`,
      description: `Job created from confirmed order ${order.orderNumber}. Assign a PM and schedule delivery.`,
      priority: 'MEDIUM',
      entityType: 'Job',
      entityId: jobId,
    })

    return { ok: true, action: 'onOrderConfirmed', detail: 'job_created', jobId }
  } catch (e: any) {
    logger.error('cascade_onOrderConfirmed_failed', e, { orderId })
    return { ok: false, action: 'onOrderConfirmed', detail: e?.message }
  }
}

/**
 * onOrderDelivered — fires when Order status flips to DELIVERED.
 * Ensures an Invoice row exists. Policy: auto-create as DRAFT and let
 * accounting promote to ISSUED manually (safer than auto-billing).
 *
 * If an invoice already exists for this order we refresh dueDate only.
 */
export async function onOrderDelivered(orderId: string): Promise<CascadeResult> {
  try {
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT o."id", o."orderNumber", o."builderId", o."subtotal", o."taxAmount",
              o."total", o."paymentTerm"::text AS "paymentTerm",
              b."companyName" AS "builderName"
       FROM "Order" o
       LEFT JOIN "Builder" b ON b."id" = o."builderId"
       WHERE o."id" = $1`,
      orderId
    )
    if (orders.length === 0) return { ok: false, action: 'onOrderDelivered', detail: 'order_not_found' }
    const order = orders[0]

    // Any linked job for cross-reference
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Job" WHERE "orderId" = $1 LIMIT 1`, orderId
    )
    const jobId: string | null = jobs[0]?.id ?? null

    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "status"::text AS status, "dueDate" FROM "Invoice" WHERE "orderId" = $1 LIMIT 1`,
      orderId
    )
    if (existing.length > 0) {
      return { ok: true, action: 'onOrderDelivered', detail: 'invoice_already_exists', invoiceId: existing[0].id }
    }

    const year = new Date().getFullYear()
    const maxRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
       FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
      `INV-${year}-%`
    )
    const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
    const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`
    const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Need a createdById — try to pick any active admin; fall back to 'system'.
    const staff: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`
    )
    const createdById = staff[0]?.id ?? 'system'

    const paymentTerm = order.paymentTerm || 'NET_15'
    const dueDate = computeDueDate(paymentTerm)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Invoice" (
        "id", "invoiceNumber", "builderId", "orderId", "jobId", "createdById",
        "subtotal", "taxAmount", "total", "amountPaid", "balanceDue",
        "status", "paymentTerm", "issuedAt", "dueDate",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, 0, $9,
        'DRAFT'::"InvoiceStatus", $10::"PaymentTerm", NULL, $11,
        NOW(), NOW()
      )`,
      invId, invoiceNumber, order.builderId, orderId, jobId, createdById,
      Number(order.subtotal || 0), Number(order.taxAmount || 0), Number(order.total || 0),
      paymentTerm, dueDate,
    )

    // Update order payment status to INVOICED (but not PAID yet).
    await prisma.$executeRawUnsafe(
      `UPDATE "Order" SET "paymentStatus" = 'INVOICED'::"PaymentStatus",
                         "dueDate" = COALESCE("dueDate", $1),
                         "updatedAt" = NOW()
       WHERE "id" = $2`,
      dueDate, orderId
    )

    return { ok: true, action: 'onOrderDelivered', detail: 'invoice_created_draft', invoiceId: invId }
  } catch (e: any) {
    logger.error('cascade_onOrderDelivered_failed', e, { orderId })
    return { ok: false, action: 'onOrderDelivered', detail: e?.message }
  }
}

/**
 * onOrderComplete — fires when Order hits COMPLETE.
 * Ensures an Invoice exists (reuses onOrderDelivered if not) and pushes any
 * linked Job to COMPLETE if it isn't already.
 */
export async function onOrderComplete(orderId: string): Promise<CascadeResult> {
  try {
    // Ensure an invoice exists
    const invRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Invoice" WHERE "orderId" = $1 LIMIT 1`, orderId
    )
    if (invRow.length === 0) {
      await onOrderDelivered(orderId)
    }

    // Advance any linked Job to COMPLETE if in earlier stage
    await prisma.$executeRawUnsafe(
      `UPDATE "Job"
       SET "status" = 'COMPLETE'::"JobStatus",
           "completedAt" = COALESCE("completedAt", NOW()),
           "updatedAt" = NOW()
       WHERE "orderId" = $1
         AND "status"::text NOT IN ('COMPLETE', 'INVOICED', 'CLOSED')`,
      orderId
    )

    return { ok: true, action: 'onOrderComplete' }
  } catch (e: any) {
    logger.error('cascade_onOrderComplete_failed', e, { orderId })
    return { ok: false, action: 'onOrderComplete', detail: e?.message }
  }
}

/**
 * Hub dispatcher — call this from any route that mutates Order.status and
 * we'll pick the right cascade(s) based on the new status. Idempotent.
 */
export async function runOrderStatusCascades(orderId: string, newStatus: string | null | undefined): Promise<void> {
  if (!newStatus) return
  const s = newStatus.toUpperCase()
  try {
    if (s === 'CONFIRMED' || s === 'IN_PRODUCTION' || s === 'READY_TO_SHIP' || s === 'SHIPPED') {
      await onOrderConfirmed(orderId)
    }
    if (s === 'DELIVERED') {
      await onOrderConfirmed(orderId) // ensure a job exists even if we skipped earlier
      await onOrderDelivered(orderId)
    }
    if (s === 'COMPLETE') {
      await onOrderConfirmed(orderId)
      await onOrderComplete(orderId)
    }
  } catch (e: any) {
    logger.error('runOrderStatusCascades_failed', e, { orderId, newStatus })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function computeDueDate(paymentTerm: string): Date {
  const d = new Date()
  switch (paymentTerm) {
    case 'PAY_AT_ORDER':
    case 'PAY_ON_DELIVERY':
      return d
    case 'NET_15':
      d.setDate(d.getDate() + 15)
      return d
    case 'NET_30':
      d.setDate(d.getDate() + 30)
      return d
    default:
      d.setDate(d.getDate() + 15)
      return d
  }
}

async function safeInboxInsert(item: {
  type: string
  source: string
  title: string
  description?: string
  priority?: string
  entityType?: string
  entityId?: string
  financialImpact?: number
  assignedTo?: string
  dueBy?: Date
}): Promise<void> {
  try {
    const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (
        "id", "type", "source", "title", "description",
        "priority", "status", "entityType", "entityId",
        "financialImpact", "assignedTo", "dueBy",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'PENDING', $7, $8,
        $9, $10, $11,
        NOW(), NOW()
      )`,
      id, item.type, item.source, item.title, item.description || null,
      item.priority || 'MEDIUM', item.entityType || null, item.entityId || null,
      item.financialImpact ?? null, item.assignedTo ?? null, item.dueBy ?? null,
    )
  } catch {
    // InboxItem is best-effort; swallow.
  }
}
