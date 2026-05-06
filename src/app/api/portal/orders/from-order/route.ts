/**
 * Builder Portal — Create Order from a previous order ("Reorder").
 *
 * A-BIZ-14. POST { sourceOrderId, qtyOverrides?: { [productId]: qty }, notes? }
 *
 * Pulls the line items off `sourceOrderId` (must belong to session.builderId),
 * applies the optional `qtyOverrides` map (omit a productId in the map to keep
 * its original qty; set qty to 0 to drop the line), then funnels through the
 * shared `createOrderFromLines` helper so the new Order goes through the same
 * credit-hold + inventory-reservation pipeline as POST /api/orders / POST
 * /api/dashboard/reorder.
 *
 * Auth: builder cookie via `getSession()`. Source order is filtered by
 * builderId so a builder can never reorder another builder's history.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { withAudit } from '@/lib/audit-route'
import { createOrderFromLines, type SourceLine } from '@/lib/portal-orders'

export const POST = withAudit(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.builderId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const sourceOrderId: string | undefined = body?.sourceOrderId
    const qtyOverrides: Record<string, number> = body?.qtyOverrides || {}
    const notes: string | null = body?.notes
      ? String(body.notes).slice(0, 1000)
      : null

    if (!sourceOrderId) {
      return NextResponse.json(
        { error: 'sourceOrderId is required' },
        { status: 400 }
      )
    }

    // Verify the source order belongs to this builder.
    const orderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "orderNumber" FROM "Order"
       WHERE "id" = $1 AND "builderId" = $2 LIMIT 1`,
      sourceOrderId,
      session.builderId
    )
    if (orderRows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Pull line items.
    const itemRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT oi."productId", oi."quantity", oi."description"
       FROM "OrderItem" oi
       WHERE oi."orderId" = $1 AND oi."productId" IS NOT NULL`,
      sourceOrderId
    )

    // Apply qtyOverrides: a productId entry in the map replaces the source
    // qty; an entry of 0 drops the line.
    const lines: SourceLine[] = itemRows
      .map((it) => {
        const override = qtyOverrides[it.productId]
        const qty =
          override !== undefined && override !== null
            ? Math.max(0, Math.floor(Number(override) || 0))
            : Number(it.quantity) || 0
        return {
          productId: it.productId,
          quantity: qty,
          description: it.description,
        }
      })
      .filter((l) => l.quantity > 0)

    if (lines.length === 0) {
      return NextResponse.json(
        { error: 'No items selected for reorder' },
        { status: 400 }
      )
    }

    const result = await createOrderFromLines({
      builderId: session.builderId,
      lines,
      request,
      notes:
        notes ||
        `Reorder of ${orderRows[0].orderNumber}`,
      source: 'POST /api/portal/orders/from-order',
      orderNumberPrefix: 'RO',
    })

    if ('errorResponse' in result) return result.errorResponse

    return NextResponse.json({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      itemCount: result.itemCount,
      total: result.total,
      status: result.status,
      backordered: result.reserveResult?.backordered.length || 0,
    })
  } catch (error: any) {
    console.error('POST /api/portal/orders/from-order error:', error)
    return NextResponse.json(
      { error: 'Failed to create reorder' },
      { status: 500 }
    )
  }
})
