export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { notifyOrderConfirmed, notifyOrderShipped, notifyOrderDelivered } from '@/lib/notifications'
import { onDeliveryScheduled } from '@/lib/cascades/delivery-lifecycle'
import { runOrderStatusCascades } from '@/lib/cascades/order-lifecycle'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { isSystemAutomationEnabled } from '@/lib/system-automations'

// GET /api/ops/orders/[id] — Get single order with all relations
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Get order with builder
    const orderRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT o.*,
             o."status"::text AS "status",
             o."paymentStatus"::text AS "paymentStatus",
             o."paymentTerm"::text AS "paymentTerm",
             b."id" AS "builder_id", b."companyName" AS "builder_companyName",
             b."contactName" AS "builder_contactName", b."email" AS "builder_email",
             b."phone" AS "builder_phone", b."address" AS "builder_address",
             b."city" AS "builder_city", b."state" AS "builder_state", b."zip" AS "builder_zip",
             b."paymentTerm"::text AS "builder_paymentTerm", b."creditLimit" AS "builder_creditLimit",
             b."status"::text AS "builder_status"
      FROM "Order" o
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE o."id" = $1
    `, id)

    if (orderRows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const o = orderRows[0]

    // Get order items with product info
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT oi.*, p."name" AS "product_name", p."sku" AS "product_sku",
             p."category" AS "product_category", p."basePrice" AS "product_basePrice"
      FROM "OrderItem" oi
      LEFT JOIN "Product" p ON p."id" = oi."productId"
      WHERE oi."orderId" = $1
    `, id)

    // Get jobs linked to this order
    const jobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "jobNumber", "status"::text AS "status", "assignedPMId",
             "builderName", "jobAddress", "scheduledDate", "completedAt"
      FROM "Job" WHERE "orderId" = $1
    `, id)

    // Structure response
    const result = {
      ...o,
      builder: o.builder_id ? {
        id: o.builder_id,
        companyName: o.builder_companyName,
        contactName: o.builder_contactName,
        email: o.builder_email,
        phone: o.builder_phone,
        address: o.builder_address,
        city: o.builder_city,
        state: o.builder_state,
        zip: o.builder_zip,
        paymentTerm: o.builder_paymentTerm,
        creditLimit: o.builder_creditLimit,
        status: o.builder_status,
      } : null,
      items: items.map(item => ({
        ...item,
        product: item.product_name ? {
          name: item.product_name,
          sku: item.product_sku,
          category: item.product_category,
          basePrice: item.product_basePrice,
        } : null,
      })),
      jobs,
    }

    // Clean up duplicate builder_ fields from flat result
    const builderKeys = Object.keys(result).filter(k => k.startsWith('builder_'))
    for (const key of builderKeys) delete (result as any)[key]

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('GET /api/ops/orders/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/orders/[id] — Update order status, delivery, payment fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()
    const { status, paymentStatus, deliveryDate, deliveryNotes, poNumber, confirmDelivery } = body

    // ── Status guard: enforce OrderStatus state machine before any write. ──
    // When a `status` (or `confirmDelivery` → DELIVERED) is coming in, load the
    // current status from the DB and validate against state-machines.ts. This
    // is the canonical pattern — see docs/STATUS_GUARD_WIRING.md.
    //
    // `currentStatus` is hoisted to the outer scope so the automation-event
    // payload (fired AFTER the cascade) can include `from`/`to`.
    let currentStatus: string | null = null
    if (status || confirmDelivery) {
      const currentRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "status"::text AS "status" FROM "Order" WHERE "id" = $1`,
        id
      )
      if (currentRows.length === 0) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      currentStatus = currentRows[0].status as string
      const targetStatus: string = status || 'DELIVERED'
      try {
        requireValidTransition('order', currentStatus, targetStatus)
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }
    }

    const setClauses: string[] = ['"updatedAt" = NOW()']

    if (status) {
      setClauses.push(`"status" = '${status}'::"OrderStatus"`)
    }
    if (paymentStatus) {
      setClauses.push(`"paymentStatus" = '${paymentStatus}'::"PaymentStatus"`)
    }
    if (deliveryDate !== undefined) {
      setClauses.push(deliveryDate ? `"deliveryDate" = '${deliveryDate}'::timestamptz` : `"deliveryDate" = NULL`)
    }
    if (deliveryNotes !== undefined) {
      setClauses.push(`"deliveryNotes" = '${(deliveryNotes || '').replace(/'/g, "''")}'`)
    }
    if (poNumber !== undefined) {
      setClauses.push(`"poNumber" = '${(poNumber || '').replace(/'/g, "''")}'`)
    }
    if (confirmDelivery) {
      setClauses.push(`"deliveryConfirmedAt" = NOW()`)
      if (!status) setClauses.push(`"status" = 'DELIVERED'::"OrderStatus"`)
    }
    if (status === 'SHIPPED') {
      setClauses.push(`"shippedAt" = NOW()`)
    }

    await prisma.$executeRawUnsafe(`
      UPDATE "Order" SET ${setClauses.join(', ')} WHERE "id" = $1
    `, id)

    // Audit: order updated
    await audit(request, 'UPDATE', 'Order', id, {
      ...(status && { status }),
      ...(paymentStatus && { paymentStatus }),
      ...(confirmDelivery && { confirmDelivery: true }),
    })

    // Get builder info for notification
    const orderRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id", o."orderNumber", o."builderId",
             o."status"::text AS "status", o."paymentStatus"::text AS "paymentStatus",
             b."companyName" AS "builderName", b."email" AS "builderEmail"
      FROM "Order" o
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE o."id" = $1
    `, id)

    // Create builder notification on status change
    if ((status || confirmDelivery) && orderRows[0]?.builderId) {
      const statusLabel = status || 'DELIVERED'
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
          VALUES (
            gen_random_uuid()::text, $1, 'ORDER_UPDATE',
            $2, $3, $4, false, NOW()
          )
        `,
          orderRows[0].builderId,
          `Order ${orderRows[0].orderNumber} — ${statusLabel}`,
          `Your order status has been updated to ${statusLabel}`,
          `/dashboard/orders/${id}`
        )
      } catch (e: any) {
        // BuilderNotification table might not exist — don't block
        console.warn('Notification insert skipped:', e.message?.substring(0, 100))
      }

      // Send email notification for key status transitions.
      // Each branch is gated by its system-automation toggle. Note that
      // sendBuilderNotification() also enforces BUILDER_INVOICE_EMAILS_ENABLED
      // at the env-var level — defense in depth: both gates must be green
      // for an email to go out.
      const bEmail = orderRows[0].builderEmail
      const bId = orderRows[0].builderId
      const oNum = orderRows[0].orderNumber
      const bName = orderRows[0].builderName || 'Builder'
      if (bEmail) {
        if (statusLabel === 'CONFIRMED' && await isSystemAutomationEnabled('order.confirmed.email_builder')) {
          notifyOrderConfirmed(bId, bEmail, oNum, '', Number(orderRows[0].total || 0), 0).catch(() => {})
        } else if (statusLabel === 'SHIPPED' && await isSystemAutomationEnabled('order.shipped.email_builder')) {
          notifyOrderShipped(bId, bEmail, oNum, '').catch(() => {})
        } else if (statusLabel === 'DELIVERED' && await isSystemAutomationEnabled('order.delivered.email_builder')) {
          notifyOrderDelivered(bId, bEmail, oNum, '').catch(() => {})
        }
      }
    }

    // ── Cross-entity cascades (Job on CONFIRMED, Invoice DRAFT on DELIVERED,
    // Job close on COMPLETE). Fire-and-forget so cascade failures never roll
    // back the PATCH. The `confirmDelivery` shortcut implies DELIVERED.
    const cascadeStatus = status || (confirmDelivery ? 'DELIVERED' : null)
    if (cascadeStatus) {
      runOrderStatusCascades(id, cascadeStatus).catch((err: any) => {
        console.error('[orders PATCH] cascade failure', id, cascadeStatus, err?.message || err)
      })

      // Fire user-defined automation rules (AutomationRule table). Fire-and-
      // forget — automation failures must never block an order PATCH.
      fireAutomationEvent('ORDER_STATUS_CHANGED', id, {
        orderId: id,
        orderNumber: orderRows[0]?.orderNumber,
        builderId: orderRows[0]?.builderId,
        from: currentStatus,
        to: cascadeStatus,
        updatedBy: request.headers.get('x-staff-id') || 'system',
      }).catch(() => {})
    }

    // ── Delivery lifecycle: create a SCHEDULED Delivery when Order → READY_TO_SHIP ──
    // The bug this fixes: Deliveries were only ever written at COMPLETE (so 100%
    // of rows showed status=COMPLETE on insert), which broke the driver portal
    // (no SCHEDULED stops ever appeared) and the executive on-time metric.
    //
    // Now, when an order flips to READY_TO_SHIP, we ensure its Job has a paired
    // Delivery row in SCHEDULED state with a proper deliveryNumber and address.
    // No crew is assigned yet — Dispatch picks it up from there.
    if (status === 'READY_TO_SHIP' && await isSystemAutomationEnabled('order.ready.create_delivery')) {
      createScheduledDeliveryForOrder(id).catch((err: any) => {
        console.error('[orders PATCH] delivery creation failure', id, err?.message || err)
      })
    }

    // Return updated order (re-fetch)
    const updatedRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT o.*, o."status"::text AS "status",
             o."paymentStatus"::text AS "paymentStatus",
             o."paymentTerm"::text AS "paymentTerm",
             b."companyName" AS "builderName"
      FROM "Order" o
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE o."id" = $1
    `, id)

    return NextResponse.json(updatedRows[0] || {})
  } catch (error: any) {
    console.error('PATCH /api/ops/orders/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── Delivery lifecycle helper ────────────────────────────────────────────
//
// Creates a SCHEDULED Delivery row for an Order that just moved to READY_TO_SHIP.
// Idempotent: if the Order's Job already has a non-cancelled Delivery, skip.
// If the Order has no Job yet, skip; once a Job is created the next PATCH to
// READY_TO_SHIP will find it and create the Delivery.
async function createScheduledDeliveryForOrder(orderId: string): Promise<void> {
  try {
    // Resolve the Job for this order and best available address.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."id" AS "jobId", j."jobAddress",
              b."address" AS "builderAddress", b."city" AS "builderCity",
              b."state" AS "builderState", b."zip" AS "builderZip"
       FROM "Order" o
       LEFT JOIN "Job" j ON j."orderId" = o."id"
       LEFT JOIN "Builder" b ON b."id" = o."builderId"
       WHERE o."id" = $1
       ORDER BY j."createdAt" DESC NULLS LAST
       LIMIT 1`,
      orderId
    )
    if (rows.length === 0 || !rows[0].jobId) {
      // No Job yet — an earlier cascade usually creates one on CONFIRMED.
      // Don't create an orphan Delivery without a Job.
      return
    }
    const r = rows[0]
    const jobId: string = r.jobId

    // Idempotency — skip if a Delivery already exists for this Job in any
    // live lifecycle state.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Delivery"
       WHERE "jobId" = $1
         AND "status"::text NOT IN ('REFUSED', 'RESCHEDULED')
       LIMIT 1`,
      jobId
    )
    if (existing.length > 0) return

    // Build address: prefer Job.jobAddress, fall back to Builder address.
    const address =
      r.jobAddress ||
      [r.builderAddress, r.builderCity, r.builderState, r.builderZip]
        .filter(Boolean)
        .join(', ') ||
      'TBD'

    // Generate a DEL-YYYY-NNNN number from the current max.
    const year = new Date().getFullYear()
    const maxRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(CAST(SUBSTRING("deliveryNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
       FROM "Delivery" WHERE "deliveryNumber" LIKE $1`,
      `DEL-${year}-%`
    )
    const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
    const deliveryNumber = `DEL-${year}-${String(nextNumber).padStart(4, '0')}`
    const deliveryId = `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Delivery" (
        "id", "jobId", "deliveryNumber", "routeOrder",
        "address", "status", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 0, $4, 'SCHEDULED'::"DeliveryStatus", NOW(), NOW()
      )`,
      deliveryId, jobId, deliveryNumber, address,
    )

    // Kick the schedule-side cascade (ScheduleEntry + PM inbox item).
    onDeliveryScheduled(deliveryId).catch(() => undefined)
  } catch (err: any) {
    console.error('[createScheduledDeliveryForOrder] failed', orderId, err?.message || err)
  }
}
