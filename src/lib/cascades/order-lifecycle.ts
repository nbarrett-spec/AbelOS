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
import { isSystemAutomationEnabled } from '@/lib/system-automations'
import {
  notifyStaff,
  getStaffByRole,
  getAssignedPM,
  getSystemCreatorId,
} from '@/lib/notifications'

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

    // Idempotency: if a Job is already linked, return early — but still
    // run the inbox toggle below in case Job exists yet inbox wasn't
    // posted. Today the only caller path that creates a Job is this
    // function, so existence implies inbox was already attempted.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber" FROM "Job" WHERE "orderId" = $1 LIMIT 1`,
      orderId
    )
    if (existing.length > 0) {
      return { ok: true, action: 'onOrderConfirmed', detail: 'job_already_linked', jobId: existing[0].id }
    }

    // ── Toggle: order.confirmed.create_job ───────────────────────────────
    let jobId: string | null = null
    let jobNumber: string | null = null

    if (await isSystemAutomationEnabled('order.confirmed.create_job')) {
      // Derive a job number — JOB-YYYY-NNNN based on current MAX
      const year = new Date().getFullYear()
      const maxRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
         FROM "Job" WHERE "jobNumber" LIKE $1`,
        `JOB-${year}-%`
      )
      const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
      jobNumber = `JOB-${year}-${String(nextNumber).padStart(4, '0')}`
      jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

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
    }

    // ── Toggle: order.confirmed.pm_inbox ─────────────────────────────────
    // Independent of Job creation. If Job was skipped, the inbox item
    // points back at the Order so a PM can still claim it.
    if (await isSystemAutomationEnabled('order.confirmed.pm_inbox')) {
      await safeInboxInsert({
        type: 'JOB_ASSIGNMENT',
        source: 'order-lifecycle',
        title: jobNumber
          ? `New job ${jobNumber} — ${order.builderName || 'Unknown'}`
          : `New order ${order.orderNumber} — ${order.builderName || 'Unknown'}`,
        description: jobNumber
          ? `Job created from confirmed order ${order.orderNumber}. Assign a PM and schedule delivery.`
          : `Order ${order.orderNumber} confirmed (auto-job-creation disabled). Manually create a Job or re-enable the toggle.`,
        priority: 'MEDIUM',
        entityType: jobId ? 'Job' : 'Order',
        entityId: jobId || orderId,
      })
    }

    // ── Phase 3 staff notifications + tasks ──────────────────────────────
    // All fire-and-forget. Each gated by its own SystemAutomation toggle.
    // Failures here must never roll back the order confirmation.

    // Notify warehouse leads — order confirmed, prep stock + production
    if (await isSystemAutomationEnabled('order.confirmed.notify_warehouse')) {
      try {
        const warehouseLeads = await getStaffByRole('WAREHOUSE_LEAD')
        if (warehouseLeads.length > 0) {
          const itemRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "OrderItem" WHERE "orderId" = $1`,
            orderId,
          )
          const itemCount = itemRows[0]?.cnt ?? 0
          notifyStaff({
            staffIds: warehouseLeads,
            type: 'JOB_UPDATE',
            title: `Order ${order.orderNumber} confirmed — ${itemCount} item${itemCount === 1 ? '' : 's'}`,
            body: `${order.builderName || 'Builder'} order confirmed. Check stock and begin production.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
      } catch (err) {
        logger.error('cascade_notify_warehouse_failed', err as Error, { orderId })
      }
    }

    // Notify accounting — heads-up on incoming invoice
    if (await isSystemAutomationEnabled('order.confirmed.notify_accounting')) {
      try {
        const accounting = await getStaffByRole('ACCOUNTING')
        if (accounting.length > 0) {
          const totalRow: any[] = await prisma.$queryRawUnsafe(
            `SELECT "total", "paymentTerm"::text AS "paymentTerm" FROM "Order" WHERE "id" = $1`,
            orderId,
          )
          const total = Number(totalRow[0]?.total || 0)
          const paymentTerm = totalRow[0]?.paymentTerm || 'NET_15'
          notifyStaff({
            staffIds: accounting,
            type: 'JOB_UPDATE',
            title: `Order ${order.orderNumber} confirmed — expect invoice on delivery`,
            body: `${order.builderName || 'Builder'}, $${total.toLocaleString()}, terms ${paymentTerm}. Invoice will auto-create on delivery.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
      } catch (err) {
        logger.error('cascade_notify_accounting_failed', err as Error, { orderId })
      }
    }

    // ── Phase 3B.2: Check inventory on confirm ───────────────────────────
    // Flags backorder/shortage situations as soon as an order is confirmed
    // so the PM and warehouse can react before production starts. Read-only
    // signal — never blocks the cascade.
    if (await isSystemAutomationEnabled('order.confirmed.check_inventory')) {
      try {
        const shortages: any[] = await prisma.$queryRawUnsafe(
          `SELECT oi."productId", oi."description", oi."quantity" AS "needed",
                  COALESCE(ii."onHand", 0) AS "onHand"
           FROM "OrderItem" oi
           LEFT JOIN "InventoryItem" ii ON ii."productId" = oi."productId"
           WHERE oi."orderId" = $1
             AND oi."productId" IS NOT NULL
             AND COALESCE(ii."onHand", 0) < oi."quantity"`,
          orderId,
        )
        if (shortages.length > 0) {
          await safeInboxInsert({
            type: 'BACKORDER_ALERT',
            source: 'order-lifecycle',
            title: `Backorder alert — ${shortages.length} item${shortages.length === 1 ? '' : 's'} short on ${order.orderNumber}`,
            description: `${order.builderName || 'Builder'} order has ${shortages.length} short item${shortages.length === 1 ? '' : 's'}. Review and trigger purchasing or substitution.`,
            priority: 'HIGH',
            entityType: 'Order',
            entityId: orderId,
          })
        }
      } catch (err) {
        logger.error('cascade_check_inventory_failed', err as Error, { orderId })
      }
    }

    // Create task — assigned PM schedules delivery. Only fires if a PM is
    // already assigned to the Job; otherwise the inbox item handles claim
    // routing.
    if (jobId && (await isSystemAutomationEnabled('order.confirmed.task_schedule'))) {
      try {
        const pmId = await getAssignedPM(orderId)
        const creatorId = await getSystemCreatorId()
        if (pmId && creatorId) {
          const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Task" (
              "id", "assigneeId", "creatorId", "jobId", "title", "description",
              "priority", "status", "category", "dueDate",
              "createdAt", "updatedAt", "createdById"
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              'HIGH'::"TaskPriority", 'TODO'::"TaskStatus", 'GENERAL'::"TaskCategory",
              (NOW() + INTERVAL '2 days'),
              NOW(), NOW(), $3
            )`,
            taskId,
            pmId,
            creatorId,
            jobId,
            `Schedule delivery for Job ${jobNumber || ''}`.trim(),
            `${order.builderName || 'Builder'} — order ${order.orderNumber} confirmed. Coordinate delivery date and assign crew.`,
          )
        }
      } catch (err) {
        logger.error('cascade_task_schedule_failed', err as Error, { orderId })
      }
    }

    return {
      ok: true,
      action: 'onOrderConfirmed',
      detail: jobId ? 'job_created' : 'job_creation_disabled',
      jobId: jobId || undefined,
    }
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
              b."companyName" AS "builderName",
              b."autoInvoiceOnDelivery" AS "autoInvoiceOnDelivery"
       FROM "Order" o
       LEFT JOIN "Builder" b ON b."id" = o."builderId"
       WHERE o."id" = $1`,
      orderId
    )
    if (orders.length === 0) return { ok: false, action: 'onOrderDelivered', detail: 'order_not_found' }
    const order = orders[0]

    // Respect the builder-level toggle. Default true (column has DB default),
    // but if an op explicitly turned it off we skip invoice creation.
    if (order.autoInvoiceOnDelivery === false) {
      return { ok: true, action: 'onOrderDelivered', detail: 'skipped_auto_invoice_disabled' }
    }

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

    let invId: string | null = null
    const paymentTerm = order.paymentTerm || 'NET_15'
    const dueDate = computeDueDate(paymentTerm)

    // ── Toggle: order.delivered.create_invoice ───────────────────────────
    if (await isSystemAutomationEnabled('order.delivered.create_invoice')) {
      const year = new Date().getFullYear()
      const maxRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
         FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
        `INV-${year}-%`
      )
      const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
      const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`
      invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      // Need a createdById — try to pick any active admin; fall back to 'system'.
      const staff: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`
      )
      const createdById = staff[0]?.id ?? 'system'

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
    }

    // ── Toggle: order.delivered.set_invoiced ─────────────────────────────
    // Independent — admins may want the invoice created without flipping
    // paymentStatus (or vice versa) for accounting workflow reasons.
    if (await isSystemAutomationEnabled('order.delivered.set_invoiced')) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Order" SET "paymentStatus" = 'INVOICED'::"PaymentStatus",
                           "dueDate" = COALESCE("dueDate", $1),
                           "updatedAt" = NOW()
         WHERE "id" = $2`,
        dueDate, orderId
      )
    }

    return {
      ok: true,
      action: 'onOrderDelivered',
      detail: invId ? 'invoice_created_draft' : 'invoice_creation_disabled',
      invoiceId: invId || undefined,
    }
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
    // ── Toggle: order.complete.ensure_invoice ────────────────────────────
    // Backfill safety net — only fires if no invoice exists yet AND the
    // toggle is on. Independent of order.delivered.create_invoice (which
    // governs the regular DELIVERED-stage path).
    if (await isSystemAutomationEnabled('order.complete.ensure_invoice')) {
      const invRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Invoice" WHERE "orderId" = $1 LIMIT 1`, orderId
      )
      if (invRow.length === 0) {
        await onOrderDelivered(orderId)
      }
    }

    // ── Toggle: order.complete.advance_job ───────────────────────────────
    if (await isSystemAutomationEnabled('order.complete.advance_job')) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
         SET "status" = 'COMPLETE'::"JobStatus",
             "completedAt" = COALESCE("completedAt", NOW()),
             "updatedAt" = NOW()
         WHERE "orderId" = $1
           AND "status"::text NOT IN ('COMPLETE', 'INVOICED', 'CLOSED')`,
        orderId
      )
    }

    return { ok: true, action: 'onOrderComplete' }
  } catch (e: any) {
    logger.error('cascade_onOrderComplete_failed', e, { orderId })
    return { ok: false, action: 'onOrderComplete', detail: e?.message }
  }
}

/**
 * onOrderCancelled — fires when an Order moves to CANCELLED.
 * Phase 3B.7: voids any DRAFT invoice and releases reserved inventory back
 * to onHand. Both actions gated by their own SystemAutomation toggles so
 * they default to OFF; admins flip them on once they trust the behavior.
 *
 * IMPORTANT: only voids DRAFT invoices. ISSUED, SENT, or PARTIALLY_PAID
 * invoices need manual handling (credit memos, refunds) — those workflows
 * shouldn't be auto-voided.
 */
export async function onOrderCancelled(orderId: string): Promise<CascadeResult> {
  try {
    let voidedInvoiceId: string | null = null
    let releasedItemCount = 0

    // ── Toggle: order.cancelled.void_draft_invoice ────────────────────────
    if (await isSystemAutomationEnabled('order.cancelled.void_draft_invoice')) {
      try {
        const drafts: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Invoice"
           WHERE "orderId" = $1 AND "status"::text = 'DRAFT'
           LIMIT 1`,
          orderId,
        )
        if (drafts[0]?.id) {
          voidedInvoiceId = drafts[0].id
          await prisma.$executeRawUnsafe(
            `UPDATE "Invoice"
             SET "status" = 'VOID'::"InvoiceStatus", "updatedAt" = NOW()
             WHERE "id" = $1`,
            voidedInvoiceId,
          )
        }
      } catch (err) {
        logger.error('cascade_cancel_void_invoice_failed', err as Error, { orderId })
      }
    }

    // ── Toggle: order.cancelled.release_inventory ─────────────────────────
    // Walks OrderItems, increments InventoryItem.onHand by the order qty.
    // No-op for OrderItems with no productId (custom line items / labor).
    if (await isSystemAutomationEnabled('order.cancelled.release_inventory')) {
      try {
        const items: any[] = await prisma.$queryRawUnsafe(
          `SELECT "productId", "quantity"
           FROM "OrderItem"
           WHERE "orderId" = $1 AND "productId" IS NOT NULL`,
          orderId,
        )
        for (const item of items) {
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE "InventoryItem"
               SET "onHand" = "onHand" + $1, "updatedAt" = NOW()
               WHERE "productId" = $2`,
              Number(item.quantity || 0),
              item.productId,
            )
            releasedItemCount++
          } catch {
            // best-effort per-item — keep going on partial failure
          }
        }
      } catch (err) {
        logger.error('cascade_cancel_release_inventory_failed', err as Error, { orderId })
      }
    }

    return {
      ok: true,
      action: 'onOrderCancelled',
      detail: `voided=${voidedInvoiceId ? 1 : 0} released=${releasedItemCount}`,
      invoiceId: voidedInvoiceId || undefined,
    }
  } catch (e: any) {
    logger.error('cascade_onOrderCancelled_failed', e, { orderId })
    return { ok: false, action: 'onOrderCancelled', detail: e?.message }
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
    if (s === 'CANCELLED') {
      await onOrderCancelled(orderId)
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
