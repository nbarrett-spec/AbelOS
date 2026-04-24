export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/invoices/from-order — Auto-generate an invoice from an order
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Invoice', undefined, { method: 'POST' }).catch(() => {})

    const staffId = request.headers.get('x-staff-id') || 'unknown'
    const body = await request.json()
    const { orderId } = body

    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    // Fetch order with builder info
    const orderRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id", o."orderNumber", o."builderId", o."subtotal", o."taxAmount", o."total",
             o."paymentTerm"::text AS "paymentTerm", o."deliveryDate", o."status"::text AS "status",
             b."companyName" AS "builderName", b."contactName" AS "builderContact",
             b."email" AS "builderEmail", b."paymentTerm"::text AS "builderPaymentTerm"
      FROM "Order" o
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE o."id" = $1
    `, orderId)

    if (orderRows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = orderRows[0]

    // Check if invoice already exists
    const existingRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceNumber" FROM "Invoice" WHERE "orderId" = $1 LIMIT 1
    `, orderId)

    if (existingRows.length > 0) {
      return NextResponse.json({
        error: 'Invoice already exists for this order',
        invoiceNumber: existingRows[0].invoiceNumber,
        invoiceId: existingRows[0].id,
      }, { status: 409 })
    }

    // Get order items
    const orderItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT "description", "quantity", "unitPrice", "lineTotal"
      FROM "OrderItem" WHERE "orderId" = $1
    `, orderId)

    // Generate invoice number
    const year = new Date().getFullYear()
    const maxRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
      FROM "Invoice" WHERE "invoiceNumber" LIKE $1
    `, `INV-${year}-%`)
    const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
    const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`

    // Calculate due date
    const paymentTerm = order.paymentTerm || order.builderPaymentTerm || 'NET_30'
    const now = new Date()
    const dueDate = new Date(now)
    switch (paymentTerm) {
      case 'PAY_AT_ORDER': break
      case 'PAY_ON_DELIVERY':
        if (order.deliveryDate) dueDate.setTime(new Date(order.deliveryDate).getTime())
        break
      case 'NET_15': dueDate.setDate(dueDate.getDate() + 15); break
      case 'NET_30': default: dueDate.setDate(dueDate.getDate() + 30); break
    }

    // Find the job linked to this order (if any)
    const jobRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id" FROM "Job" WHERE "orderId" = $1 LIMIT 1
    `, orderId)
    const jobId = jobRows[0]?.id || null

    // Create invoice + invoice items atomically
    const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$transaction(async (tx) => {
      // DRAFT invoices have NULL issuedAt by policy (consistent with
      // src/lib/cascades/order-lifecycle.ts onOrderDelivered). issuedAt
      // gets stamped at promotion (PATCH status='ISSUED' or first payment).
      await tx.$executeRawUnsafe(`
        INSERT INTO "Invoice" (
          "id", "invoiceNumber", "builderId", "orderId", "jobId", "createdById",
          "subtotal", "taxAmount", "total", "amountPaid", "balanceDue",
          "status", "paymentTerm", "issuedAt", "dueDate", "notes",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, 0, $9,
          'DRAFT'::"InvoiceStatus", '${paymentTerm}'::"PaymentTerm",
          NULL, '${dueDate.toISOString()}'::timestamptz,
          $10, NOW(), NOW()
        )
      `,
        invId, invoiceNumber, order.builderId, orderId, jobId, staffId,
        Number(order.subtotal) || 0, Number(order.taxAmount) || 0,
        Number(order.total) || 0,
        `Auto-generated from ${order.orderNumber}`
      )

      // Create invoice items
      for (const item of orderItems) {
        const itemId = `invitem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await tx.$executeRawUnsafe(`
          INSERT INTO "InvoiceItem" ("id", "invoiceId", "description", "quantity", "unitPrice", "lineTotal")
          VALUES ($1, $2, $3, $4, $5, $6)
        `, itemId, invId, item.description, item.quantity,
          Number(item.unitPrice) || 0, Number(item.lineTotal) || 0)
      }
    })

    // Fetch created invoice
    const createdRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.*, i."status"::text AS "status", i."paymentTerm"::text AS "paymentTerm"
      FROM "Invoice" i WHERE i."id" = $1
    `, invId)

    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "InvoiceItem" WHERE "invoiceId" = $1
    `, invId)

    return NextResponse.json({
      ...createdRows[0],
      builderName: order.builderName || 'Unknown Builder',
      orderNumber: order.orderNumber,
      items,
      payments: [],
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/invoices/from-order error:', error)
    return NextResponse.json({ error: 'Failed to generate invoice from order' }, { status: 500 })
  }
}
