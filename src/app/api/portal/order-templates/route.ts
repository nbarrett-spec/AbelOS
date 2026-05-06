/**
 * Builder Portal — Order Templates
 *
 * A-BIZ-14. Saved line-item templates a builder can re-launch as a new order
 * with one click. Powered by `OrderTemplate` + `OrderTemplateItem`.
 *
 * Endpoints:
 *   GET  /api/portal/order-templates  — list templates owned by session.builderId
 *   POST /api/portal/order-templates  — create a template, either from a
 *                                        source orderId (Save-as-Template) or
 *                                        from a free-form items array.
 *
 * Auth: builder cookie via `getSession()`. Every query is scoped to
 * `session.builderId` so a builder can never see/touch another builder's
 * templates.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { withAudit } from '@/lib/audit-route'

interface TemplateRow {
  id: string
  name: string
  description: string | null
  sourceOrderId: string | null
  sourceOrderNumber: string | null
  itemCount: number
  estimatedTotal: number
  createdAt: string
  updatedAt: string
}

// ─── GET ───────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest) {
  const session = await getSession()
  if (!session?.builderId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        t."id",
        t."name",
        t."description",
        t."sourceOrderId",
        so."orderNumber"            AS "sourceOrderNumber",
        t."createdAt",
        t."updatedAt",
        COALESCE(COUNT(i."id"), 0)::int                                  AS "itemCount",
        COALESCE(SUM(i."quantity" * COALESCE(p."basePrice", 0)), 0)::float AS "estimatedTotal"
      FROM "OrderTemplate" t
      LEFT JOIN "OrderTemplateItem" i ON i."templateId" = t."id"
      LEFT JOIN "Product" p           ON p."id"        = i."productId"
      LEFT JOIN "Order" so            ON so."id"       = t."sourceOrderId"
      WHERE t."builderId" = $1
      GROUP BY t."id", t."name", t."description", t."sourceOrderId",
               so."orderNumber", t."createdAt", t."updatedAt"
      ORDER BY t."updatedAt" DESC
      `,
      session.builderId
    )

    const templates: TemplateRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      sourceOrderId: r.sourceOrderId,
      sourceOrderNumber: r.sourceOrderNumber,
      itemCount: r.itemCount,
      estimatedTotal: Number(r.estimatedTotal || 0),
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }))

    return NextResponse.json({ templates })
  } catch (error: any) {
    console.error('GET /api/portal/order-templates error:', error)
    return NextResponse.json(
      { error: 'Failed to load templates' },
      { status: 500 }
    )
  }
}

// ─── POST ──────────────────────────────────────────────────────────────
//
// Body shape (one of):
//   { name, description?, sourceOrderId }                ← Save-as-Template
//   { name, description?, items: [{ productId, quantity, notes? }] }
//
export const POST = withAudit(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.builderId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const name: string | undefined = body?.name?.toString().trim()
    const description: string | null = body?.description?.toString().trim() || null
    const sourceOrderId: string | null = body?.sourceOrderId || null
    const rawItems: any[] = Array.isArray(body?.items) ? body.items : []

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    // Resolve the items from the source order or the explicit list.
    let items: Array<{ productId: string; quantity: number; notes: string | null }> = []

    if (sourceOrderId) {
      const orderCheck: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Order" WHERE "id" = $1 AND "builderId" = $2 LIMIT 1`,
        sourceOrderId,
        session.builderId
      )
      if (orderCheck.length === 0) {
        return NextResponse.json(
          { error: 'Source order not found' },
          { status: 404 }
        )
      }

      const orderItems: any[] = await prisma.$queryRawUnsafe(
        `SELECT "productId", "quantity"
         FROM "OrderItem"
         WHERE "orderId" = $1 AND "productId" IS NOT NULL`,
        sourceOrderId
      )
      items = orderItems
        .filter((it) => it.productId)
        .map((it) => ({
          productId: it.productId,
          quantity: Math.max(1, Number(it.quantity) || 1),
          notes: null,
        }))
    } else if (rawItems.length > 0) {
      items = rawItems
        .filter(
          (it) =>
            it &&
            typeof it.productId === 'string' &&
            Number(it.quantity) > 0
        )
        .map((it) => ({
          productId: it.productId as string,
          quantity: Math.max(1, Math.floor(Number(it.quantity))),
          notes: it.notes ? String(it.notes).slice(0, 500) : null,
        }))
    }

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Template must have at least one line item' },
        { status: 400 }
      )
    }

    // Validate products exist (and aren't garbage product IDs)
    const productIds = Array.from(new Set(items.map((i) => i.productId)))
    const products: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Product" WHERE "id" = ANY($1)`,
      productIds
    )
    const validIds = new Set(products.map((p) => p.id))
    const filtered = items.filter((i) => validIds.has(i.productId))
    if (filtered.length === 0) {
      return NextResponse.json(
        { error: 'No valid products on template' },
        { status: 400 }
      )
    }

    const templateId = `tpl_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "OrderTemplate" (
          "id", "builderId", "name", "description", "sourceOrderId",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        templateId,
        session.builderId,
        name.slice(0, 200),
        description ? description.slice(0, 1000) : null,
        sourceOrderId
      )

      for (const it of filtered) {
        const itemId = `tpli_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`
        await tx.$executeRawUnsafe(
          `INSERT INTO "OrderTemplateItem" (
            "id", "templateId", "productId", "quantity", "notes", "createdAt"
          ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          itemId,
          templateId,
          it.productId,
          it.quantity,
          it.notes
        )
      }
    })

    return NextResponse.json({
      templateId,
      name,
      itemCount: filtered.length,
    })
  } catch (error: any) {
    console.error('POST /api/portal/order-templates error:', error)
    return NextResponse.json(
      { error: 'Failed to save template' },
      { status: 500 }
    )
  }
})
