export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory/[id]/sales-history
//   OrderItem rows for this product, plus monthly volume series and top builders.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const productId = params.id
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25))
    const offset = (page - 1) * limit

    // ── Recent order items ──
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        oi."id", oi."quantity", oi."unitPrice", oi."lineTotal",
        oi."description",
        o."id" AS "orderId", o."orderNumber", o."status" AS "orderStatus",
        o."orderDate", o."total" AS "orderTotal",
        b."id" AS "builderId", b."companyName"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE oi."productId" = $1
      ORDER BY o."orderDate" DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, productId, limit, offset)

    const countRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt
      FROM "OrderItem" oi
      WHERE oi."productId" = $1
    `, productId)
    const total = Number(countRow[0]?.cnt || 0)

    // ── Monthly volume (last 12 months) ──
    const monthly: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        TO_CHAR(date_trunc('month', o."orderDate"), 'YYYY-MM') AS "month",
        COALESCE(SUM(oi."quantity"), 0) AS "qty",
        COALESCE(SUM(oi."lineTotal"), 0) AS "revenue"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE oi."productId" = $1
        AND o."orderDate" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', o."orderDate")
      ORDER BY date_trunc('month', o."orderDate") ASC
    `, productId)

    // ── Top 5 builders by quantity (lifetime) ──
    const topBuilders: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."id" AS "builderId", b."companyName",
        COALESCE(SUM(oi."quantity"), 0) AS "totalQty",
        COALESCE(SUM(oi."lineTotal"), 0) AS "totalRevenue",
        CAST(COUNT(DISTINCT o."id") AS INTEGER) AS "orderCount"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE oi."productId" = $1
      GROUP BY b."id", b."companyName"
      ORDER BY SUM(oi."quantity") DESC NULLS LAST
      LIMIT 5
    `, productId)

    // ── Lifetime totals ──
    const totalsRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(oi."quantity"), 0) AS "lifetimeQty",
        COALESCE(SUM(oi."lineTotal"), 0) AS "lifetimeRevenue",
        CAST(COUNT(DISTINCT o."id") AS INTEGER) AS "orderCount"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE oi."productId" = $1
    `, productId)

    return safeJson({
      items: items.map(r => ({
        id: r.id,
        quantity: Number(r.quantity || 0),
        unitPrice: r.unitPrice == null ? null : Number(r.unitPrice),
        lineTotal: r.lineTotal == null ? null : Number(r.lineTotal),
        description: r.description,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        orderStatus: r.orderStatus,
        orderDate: r.orderDate,
        orderTotal: r.orderTotal == null ? null : Number(r.orderTotal),
        builderId: r.builderId,
        companyName: r.companyName,
      })),
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      monthly: monthly.map(m => ({
        month: m.month,
        qty: Number(m.qty || 0),
        revenue: Number(m.revenue || 0),
      })),
      topBuilders: topBuilders.map(b => ({
        builderId: b.builderId,
        companyName: b.companyName,
        totalQty: Number(b.totalQty || 0),
        totalRevenue: Number(b.totalRevenue || 0),
        orderCount: Number(b.orderCount || 0),
      })),
      totals: {
        lifetimeQty: Number(totalsRow[0]?.lifetimeQty || 0),
        lifetimeRevenue: Number(totalsRow[0]?.lifetimeRevenue || 0),
        orderCount: Number(totalsRow[0]?.orderCount || 0),
      },
    })
  } catch (error: any) {
    console.error('Inventory sales-history error:', error)
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}
