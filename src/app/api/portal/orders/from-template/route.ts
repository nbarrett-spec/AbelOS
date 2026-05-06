/**
 * Builder Portal — Create Order from a saved OrderTemplate.
 *
 * A-BIZ-14. POST { templateId, qtyOverrides?: { [productId]: qty }, notes? }
 *
 * Same shape and pipeline as `/api/portal/orders/from-order`, but the source
 * line items come from `OrderTemplateItem` instead of `OrderItem`. Goes
 * through the shared `createOrderFromLines` helper so credit-hold +
 * inventory reservation behave identically to a direct order.
 *
 * Auth: builder cookie via `getSession()`. Template is filtered by
 * builderId so a builder can never instantiate another builder's template.
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
    const templateId: string | undefined = body?.templateId
    const qtyOverrides: Record<string, number> = body?.qtyOverrides || {}
    const notes: string | null = body?.notes
      ? String(body.notes).slice(0, 1000)
      : null

    if (!templateId) {
      return NextResponse.json(
        { error: 'templateId is required' },
        { status: 400 }
      )
    }

    // Verify the template belongs to this builder.
    const tplRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "name" FROM "OrderTemplate"
       WHERE "id" = $1 AND "builderId" = $2 LIMIT 1`,
      templateId,
      session.builderId
    )
    if (tplRows.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    const tpl = tplRows[0]

    // Pull template items.
    const itemRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."productId", i."quantity", i."notes",
              p."name" AS "productName"
       FROM "OrderTemplateItem" i
       JOIN "Product" p ON p."id" = i."productId"
       WHERE i."templateId" = $1`,
      templateId
    )

    if (itemRows.length === 0) {
      return NextResponse.json(
        { error: 'Template has no items' },
        { status: 400 }
      )
    }

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
          description: it.notes || it.productName,
        }
      })
      .filter((l) => l.quantity > 0)

    if (lines.length === 0) {
      return NextResponse.json(
        { error: 'No items selected from template' },
        { status: 400 }
      )
    }

    const result = await createOrderFromLines({
      builderId: session.builderId,
      lines,
      request,
      notes: notes || `From template: ${tpl.name}`,
      source: 'POST /api/portal/orders/from-template',
      orderNumberPrefix: 'OT',
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
    console.error('POST /api/portal/orders/from-template error:', error)
    return NextResponse.json(
      { error: 'Failed to create order from template' },
      { status: 500 }
    )
  }
})
