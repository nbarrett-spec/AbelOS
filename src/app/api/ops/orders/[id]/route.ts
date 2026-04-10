export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { notifyOrderConfirmed, notifyOrderShipped, notifyOrderDelivered } from '@/lib/notifications'

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

      // Send email notification for key status transitions
      const bEmail = orderRows[0].builderEmail
      const bId = orderRows[0].builderId
      const oNum = orderRows[0].orderNumber
      const bName = orderRows[0].builderName || 'Builder'
      if (bEmail) {
        if (statusLabel === 'CONFIRMED') {
          notifyOrderConfirmed(bId, bEmail, oNum, '', Number(orderRows[0].total || 0), 0).catch(() => {})
        } else if (statusLabel === 'SHIPPED') {
          notifyOrderShipped(bId, bEmail, oNum, '').catch(() => {})
        } else if (statusLabel === 'DELIVERED') {
          notifyOrderDelivered(bId, bEmail, oNum, '').catch(() => {})
        }
      }
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
