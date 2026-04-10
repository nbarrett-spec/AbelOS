export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// POST /api/quotes/[id]/convert — Convert an approved/sent quote to an order
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const quoteId = params.id

  try {
    const body = await request.json().catch(() => ({}))
    const poNumber = body.poNumber || null
    const deliveryNotes = body.deliveryNotes || null

    // Fetch the quote (Quote links to Project which has builderId)
    const quotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT q.id, q."quoteNumber", q."projectId",
             p."name" as "projectName", p."builderId",
             q.subtotal, q."taxAmount", q.total, q.status::text as status,
             b."paymentTerm"
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p.id
      JOIN "Builder" b ON p."builderId" = b.id
      WHERE q.id = $1 AND p."builderId" = $2
    `, quoteId, session.builderId)

    if (quotes.length === 0) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const quote = quotes[0]

    if (!['SENT', 'APPROVED'].includes(quote.status)) {
      return NextResponse.json({ error: `Cannot convert a ${quote.status} quote. Only SENT or APPROVED quotes can be converted.` }, { status: 400 })
    }

    // Generate order number
    const countRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Order" WHERE "builderId" = $1`,
      session.builderId
    )
    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`

    // Create order + copy items + update quote + audit log atomically
    const orderId = 'order_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    await prisma.$transaction(async (tx) => {
      // Create the order
      await tx.$queryRawUnsafe(`
        INSERT INTO "Order" (id, "orderNumber", "builderId", "quoteId",
                             subtotal, "taxAmount", total,
                             "paymentTerm", "paymentStatus", status,
                             "poNumber", "deliveryNotes",
                             "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4,
                $5, $6, $7,
                $8::"PaymentTerm", 'PENDING'::"PaymentStatus", 'RECEIVED'::"OrderStatus",
                $9, $10,
                NOW(), NOW())
      `,
        orderId, orderNum, session.builderId, quoteId,
        quote.subtotal, quote.taxAmount, quote.total,
        quote.paymentTerm || 'NET_30',
        poNumber, deliveryNotes
      )

      // Copy quote items to order items
      await tx.$queryRawUnsafe(`
        INSERT INTO "OrderItem" (id, "orderId", "productId", description, quantity, "unitPrice", "lineTotal", "createdAt", "updatedAt")
        SELECT 'oi_' || gen_random_uuid()::text, $2, "productId", description, quantity, "unitPrice", "lineTotal", NOW(), NOW()
        FROM "QuoteItem"
        WHERE "quoteId" = $1
      `, quoteId, orderId)

      // Update quote status to APPROVED (closest valid status for converted)
      await tx.$queryRawUnsafe(`
        UPDATE "Quote" SET status = 'APPROVED'::"QuoteStatus", "approvedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1
      `, quoteId)

      // Log to audit trail
      await tx.$queryRawUnsafe(`
        INSERT INTO "AuditLog" (id, action, entity, "entityId", "performedBy", details, "createdAt")
        VALUES ($1, 'QUOTE_CONVERTED', 'Order', $2, $3, $4, NOW())
      `,
        'audit_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        orderId,
        session.builderId,
        JSON.stringify({ quoteId, quoteNumber: quote.quoteNumber, orderNumber: orderNum })
      )
    })

    return NextResponse.json({
      success: true,
      orderId,
      orderNumber: orderNum,
      message: `Quote #${quote.quoteNumber} has been converted to Order #${orderNum}`,
    })
  } catch (error: any) {
    console.error('Quote convert error:', error)
    return NextResponse.json({ error: error.message || 'Failed to convert quote' }, { status: 500 })
  }
}
