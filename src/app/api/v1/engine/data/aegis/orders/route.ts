/**
 * GET /api/v1/engine/data/aegis/orders?daysBack=30
 * Aggregated order snapshot for the NUC engine.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const daysBack = Math.max(1, Math.min(Number(url.searchParams.get('daysBack') ?? 30), 365))
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)

  try {
    const [totals, byStatus, byBuilder] = await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { total: true, subtotal: true, taxAmount: true },
      }),
      prisma.$queryRaw<Array<{ status: string; count: bigint; revenue: number }>>`
        SELECT "status", COUNT(*)::bigint AS count, COALESCE(SUM("total"), 0)::float AS revenue
        FROM "Order"
        WHERE "createdAt" >= ${since}
        GROUP BY "status"
        ORDER BY count DESC
      `,
      prisma.$queryRaw<Array<{
        builderId: string
        companyName: string
        orderCount: bigint
        revenue: number
      }>>`
        SELECT o."builderId", b."companyName",
               COUNT(o.id)::bigint AS "orderCount",
               COALESCE(SUM(o."total"), 0)::float AS revenue
        FROM "Order" o
        JOIN "Builder" b ON b.id = o."builderId"
        WHERE o."createdAt" >= ${since}
        GROUP BY o."builderId", b."companyName"
        ORDER BY revenue DESC
        LIMIT 25
      `,
    ])

    return NextResponse.json({
      connected: true,
      days_back: daysBack,
      total_orders: totals._count._all,
      total_revenue: totals._sum.total ?? 0,
      total_subtotal: totals._sum.subtotal ?? 0,
      by_status: byStatus.map((r) => ({ status: r.status, count: Number(r.count), revenue: r.revenue })),
      by_builder: byBuilder.map((r) => ({
        builder_id: r.builderId,
        company: r.companyName,
        order_count: Number(r.orderCount),
        revenue: r.revenue,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: String(e?.message || e) })
  }
}
