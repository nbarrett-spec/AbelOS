/**
 * GET /api/v1/engine/data/aegis/builders[?builderId=...]
 * Returns builder health snapshot. Optional single-builder mode via builderId.
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
  const builderId = url.searchParams.get('builderId') || null
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500)

  try {
    // Last-90-days order summary per builder, joined with credit data.
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string
      companyName: string
      builderType: string
      creditLimit: number | null
      accountBalance: number
      activeOrders: bigint
      revenue90d: number
      lastOrderAt: Date | null
    }>>(
      `
      SELECT b.id,
             b."companyName",
             b."builderType"::text AS "builderType",
             b."creditLimit",
             b."accountBalance",
             COALESCE(SUM(CASE WHEN o.status NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END), 0)::bigint AS "activeOrders",
             COALESCE(SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '90 days' THEN o."total" ELSE 0 END), 0)::float AS "revenue90d",
             MAX(o."createdAt") AS "lastOrderAt"
      FROM "Builder" b
      LEFT JOIN "Order" o ON o."builderId" = b.id
      ${builderId ? `WHERE b.id = $1` : ''}
      GROUP BY b.id
      ORDER BY "revenue90d" DESC
      LIMIT ${builderId ? 1 : limit}
      `,
      ...(builderId ? [builderId] : [])
    )

    const builders = rows.map((r) => {
      const credit = r.creditLimit ?? 0
      const balance = r.accountBalance ?? 0
      const utilization = credit > 0 ? balance / credit : null
      return {
        id: r.id,
        company_name: r.companyName,
        builder_type: r.builderType,
        credit_limit: credit,
        account_balance: balance,
        credit_utilization: utilization,
        active_orders: Number(r.activeOrders),
        revenue_90d: r.revenue90d,
        last_order_at: r.lastOrderAt,
      }
    })

    return NextResponse.json({ connected: true, builders, count: builders.length })
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: String(e?.message || e) })
  }
}
