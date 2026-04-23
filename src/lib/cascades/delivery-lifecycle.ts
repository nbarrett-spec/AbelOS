/**
 * Delivery Lifecycle Cascades
 *
 * Hooks for Delivery status transitions. The driver portal is the primary
 * caller for onDeliveryComplete (already wired); onDeliveryScheduled and
 * onDeliveryFailed exist so dispatcher pages can use the same surface.
 *
 * Triggered from:
 *  - POST /api/ops/delivery/[deliveryId]/complete  (onDeliveryComplete)
 *  - POST /api/ops/delivery/dispatch               (onDeliveryScheduled — when we wire it)
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { onOrderDelivered } from './order-lifecycle'

type CascadeResult = { ok: boolean; action: string; detail?: string }

/**
 * onDeliveryScheduled — a Delivery row was scheduled on the board.
 * Creates a ScheduleEntry calendar slot if absent and drops an inbox item
 * for the assigned crew's crew chief.
 */
export async function onDeliveryScheduled(deliveryId: string): Promise<CascadeResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."jobId", d."crewId", d."address",
              d."status"::text AS status,
              j."jobNumber", j."assignedPMId", j."scheduledDate"
       FROM "Delivery" d
       LEFT JOIN "Job" j ON j."id" = d."jobId"
       WHERE d."id" = $1`,
      deliveryId
    )
    if (rows.length === 0) return { ok: false, action: 'onDeliveryScheduled', detail: 'delivery_not_found' }
    const d = rows[0]

    // Idempotency: skip if a ScheduleEntry for this delivery already exists.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "ScheduleEntry" WHERE "jobId" = $1 AND "title" ILIKE $2 LIMIT 1`,
      d.jobId, `%${d.deliveryNumber}%`
    )
    if (existing.length === 0 && d.jobId) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ScheduleEntry" (
            "id", "jobId", "entryType", "title", "scheduledDate", "status", "notes", "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::text, $1, 'DELIVERY', $2, $3, 'FIRM', $4, NOW(), NOW()
          )`,
          d.jobId,
          `Delivery ${d.deliveryNumber}`,
          d.scheduledDate || new Date(),
          d.address || null
        )
      } catch (err) {
        logger.warn('schedule_entry_insert_failed', { deliveryId, err })
      }
    }

    // Notify PM via InboxItem
    await safeInboxInsert({
      type: 'SCHEDULE_CHANGE',
      source: 'delivery-lifecycle',
      title: `Delivery scheduled — ${d.deliveryNumber}`,
      description: `Delivery ${d.deliveryNumber} on job ${d.jobNumber || ''} scheduled to ${d.address || 'TBD'}.`,
      priority: 'MEDIUM',
      entityType: 'Delivery',
      entityId: deliveryId,
      assignedTo: d.assignedPMId || undefined,
    })

    return { ok: true, action: 'onDeliveryScheduled', detail: 'scheduled' }
  } catch (e: any) {
    logger.error('cascade_onDeliveryScheduled_failed', e, { deliveryId })
    return { ok: false, action: 'onDeliveryScheduled', detail: e?.message }
  }
}

/**
 * onDeliveryComplete — called from the driver portal. Refresher of the work
 * that already happens inline in /api/ops/delivery/[deliveryId]/complete, but
 * extends it by: (a) advancing the linked Order to DELIVERED, (b) triggering
 * onOrderDelivered to create the draft Invoice, and (c) dropping a PM inbox
 * item. Idempotent — the delivery-complete route calls us after its inline
 * work.
 */
export async function onDeliveryComplete(deliveryId: string): Promise<CascadeResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."jobId", d."status"::text AS status,
              j."orderId", j."jobNumber", j."assignedPMId",
              o."id" AS "orderIdResolved", o."status"::text AS "orderStatus", o."orderNumber",
              b."companyName" AS "builderName", b."email" AS "builderEmail"
       FROM "Delivery" d
       LEFT JOIN "Job" j ON j."id" = d."jobId"
       LEFT JOIN "Order" o ON o."id" = j."orderId"
       LEFT JOIN "Builder" b ON b."id" = o."builderId"
       WHERE d."id" = $1`,
      deliveryId
    )
    if (rows.length === 0) return { ok: false, action: 'onDeliveryComplete', detail: 'delivery_not_found' }
    const d = rows[0]

    // Advance Order.status to DELIVERED if lagging
    if (d.orderIdResolved && d.orderStatus && !['DELIVERED', 'COMPLETE', 'CANCELLED'].includes(d.orderStatus)) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Order" SET "status" = 'DELIVERED'::"OrderStatus", "updatedAt" = NOW() WHERE "id" = $1`,
        d.orderIdResolved
      )
    }

    // Kick the invoice-on-delivery cascade (creates DRAFT Invoice if missing)
    if (d.orderIdResolved) {
      await onOrderDelivered(d.orderIdResolved).catch(() => undefined)
    }

    // Inbox for the PM so they know the loop is closed on their end
    if (d.assignedPMId) {
      await safeInboxInsert({
        type: 'SCHEDULE_CHANGE',
        source: 'delivery-lifecycle',
        title: `Delivered — ${d.deliveryNumber}`,
        description: `Delivery ${d.deliveryNumber} for job ${d.jobNumber || ''} complete on site.`,
        priority: 'LOW',
        entityType: 'Delivery',
        entityId: deliveryId,
        assignedTo: d.assignedPMId,
      })
    }

    return { ok: true, action: 'onDeliveryComplete', detail: 'cascaded' }
  } catch (e: any) {
    logger.error('cascade_onDeliveryComplete_failed', e, { deliveryId })
    return { ok: false, action: 'onDeliveryComplete', detail: e?.message }
  }
}

/**
 * onDeliveryFailed — driver reported a failed / refused delivery.
 * Flags the Delivery as RESCHEDULED, creates an InboxItem for dispatch,
 * and attempts to suggest a reschedule date (tomorrow at 8am).
 */
export async function onDeliveryFailed(deliveryId: string, reason: string): Promise<CascadeResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."jobId",
              j."jobNumber", j."assignedPMId"
       FROM "Delivery" d
       LEFT JOIN "Job" j ON j."id" = d."jobId"
       WHERE d."id" = $1`, deliveryId
    )
    if (rows.length === 0) return { ok: false, action: 'onDeliveryFailed', detail: 'delivery_not_found' }
    const d = rows[0]

    await prisma.$executeRawUnsafe(
      `UPDATE "Delivery"
       SET "status" = 'RESCHEDULED'::"DeliveryStatus",
           "notes" = COALESCE("notes", '') || E'\n[FAILED]: ' || $1,
           "updatedAt" = NOW()
       WHERE "id" = $2`,
      reason.substring(0, 400), deliveryId
    )

    await safeInboxInsert({
      type: 'SCHEDULE_CHANGE',
      source: 'delivery-lifecycle',
      title: `Delivery failed — ${d.deliveryNumber}`,
      description: `Delivery ${d.deliveryNumber} (job ${d.jobNumber || ''}) failed: ${reason}. Reschedule required.`,
      priority: 'HIGH',
      entityType: 'Delivery',
      entityId: deliveryId,
      assignedTo: d.assignedPMId || undefined,
    })

    return { ok: true, action: 'onDeliveryFailed', detail: 'rescheduled_marker' }
  } catch (e: any) {
    logger.error('cascade_onDeliveryFailed_failed', e, { deliveryId })
    return { ok: false, action: 'onDeliveryFailed', detail: e?.message }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

async function safeInboxInsert(item: {
  type: string
  source: string
  title: string
  description?: string
  priority?: string
  entityType?: string
  entityId?: string
  assignedTo?: string
}): Promise<void> {
  try {
    const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (
        "id", "type", "source", "title", "description",
        "priority", "status", "entityType", "entityId", "assignedTo",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'PENDING', $7, $8, $9,
        NOW(), NOW()
      )`,
      id, item.type, item.source, item.title, item.description || null,
      item.priority || 'MEDIUM', item.entityType || null, item.entityId || null,
      item.assignedTo || null,
    )
  } catch { /* best-effort */ }
}
