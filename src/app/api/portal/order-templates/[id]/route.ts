/**
 * Builder Portal — Order Template detail.
 *
 * A-BIZ-14. Per-template operations for the logged-in builder.
 *
 *   GET    /api/portal/order-templates/[id]  — full template + items + current pricing
 *   DELETE /api/portal/order-templates/[id]  — soft-only-by-cascade delete
 *
 * Auth: builder cookie via `getSession()`. Every query joins on
 * `builderId` so a builder can never read or delete another builder's
 * template.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { withAudit } from '@/lib/audit-route'

interface TemplateItemRow {
  id: string
  productId: string
  productName: string
  sku: string
  quantity: number
  notes: string | null
  currentPrice: number
  inStock: boolean
  active: boolean
}

interface TemplateDetail {
  id: string
  name: string
  description: string | null
  sourceOrderId: string | null
  sourceOrderNumber: string | null
  items: TemplateItemRow[]
  estimatedTotal: number
  createdAt: string
  updatedAt: string
}

// ─── GET ───────────────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session?.builderId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const tplRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT t."id", t."name", t."description", t."sourceOrderId",
              so."orderNumber" AS "sourceOrderNumber",
              t."createdAt", t."updatedAt"
       FROM "OrderTemplate" t
       LEFT JOIN "Order" so ON so."id" = t."sourceOrderId"
       WHERE t."id" = $1 AND t."builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )
    if (tplRows.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    const tpl = tplRows[0]

    const itemRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."id", i."productId", i."quantity", i."notes",
              p."name" AS "productName",
              p."sku",
              p."active",
              p."inStock",
              COALESCE(bp."customPrice", p."basePrice")::float AS "currentPrice"
       FROM "OrderTemplateItem" i
       JOIN "Product" p             ON p."id" = i."productId"
       LEFT JOIN "BuilderPricing" bp ON bp."productId" = p."id"
                                    AND bp."builderId" = $2
       WHERE i."templateId" = $1
       ORDER BY p."name" ASC`,
      params.id,
      session.builderId
    )

    const items: TemplateItemRow[] = itemRows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      sku: r.sku,
      quantity: Number(r.quantity) || 1,
      notes: r.notes,
      currentPrice: Number(r.currentPrice || 0),
      inStock: !!r.inStock,
      active: !!r.active,
    }))

    const estimatedTotal = items.reduce(
      (sum, i) => sum + i.quantity * i.currentPrice,
      0
    )

    const detail: TemplateDetail = {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      sourceOrderId: tpl.sourceOrderId,
      sourceOrderNumber: tpl.sourceOrderNumber,
      items,
      estimatedTotal,
      createdAt: new Date(tpl.createdAt).toISOString(),
      updatedAt: new Date(tpl.updatedAt).toISOString(),
    }

    return NextResponse.json(detail)
  } catch (error: any) {
    console.error('GET /api/portal/order-templates/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 }
    )
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────
export const DELETE = withAudit(async (
  _request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const session = await getSession()
  if (!session?.builderId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const result: any = await prisma.$executeRawUnsafe(
      `DELETE FROM "OrderTemplate" WHERE "id" = $1 AND "builderId" = $2`,
      params.id,
      session.builderId
    )
    // executeRawUnsafe returns the affected row count.
    if (Number(result) === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('DELETE /api/portal/order-templates/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    )
  }
})
