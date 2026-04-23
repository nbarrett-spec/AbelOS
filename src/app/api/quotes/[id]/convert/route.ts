export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

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
    audit(request, 'CREATE', 'QuoteConversion', quoteId).catch(() => {});

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

    // Guard: the convert flow always leaves Quote in APPROVED. SENT → APPROVED
    // is valid; APPROVED → APPROVED is a silent no-op in the guard.
    try {
      requireValidTransition('quote', quote.status, 'APPROVED')
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // ── Credit hold enforcement ──────────────────────────────────
    const builderInfo: any[] = await prisma.$queryRawUnsafe(
      `SELECT status, "accountStatus", "creditLimit" FROM "Builder" WHERE "id" = $1`,
      session.builderId
    )
    const bldr = builderInfo[0]
    if (bldr) {
      const bStatus = bldr.status || bldr.accountStatus
      if (bStatus === 'SUSPENDED' || bStatus === 'ON_HOLD') {
        return NextResponse.json(
          { error: `Order blocked: account is ${bStatus.replace('_', ' ').toLowerCase()}. Contact your rep.` },
          { status: 403 }
        )
      }
      if (bldr.creditLimit && Number(bldr.creditLimit) > 0) {
        const arRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM("total"), 0) as balance FROM "Order" WHERE "builderId" = $1 AND "paymentStatus" != 'PAID'`,
          session.builderId
        )
        const currentAR = Number(arRows[0]?.balance || 0)
        if (currentAR + Number(quote.total) > Number(bldr.creditLimit)) {
          return NextResponse.json(
            { error: `Order blocked: would exceed credit limit. Contact your rep.` },
            { status: 403 }
          )
        }
      }
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
    return NextResponse.json({ error: 'Failed to convert quote' }, { status: 500 })
  }
}
