/**
 * GET /api/v1/engine/data/aegis/deliveries?daysBack=14
 * Deliveries snapshot for the NUC engine.
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
  const daysBack = Math.max(1, Math.min(Number(url.searchParams.get('daysBack') ?? 14), 180))
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500)

  try {
    const [byStatus, recent] = await Promise.all([
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT "status", COUNT(*)::bigint AS count
        FROM "Delivery"
        WHERE "createdAt" >= ${since}
        GROUP BY "status"
      `,
      prisma.delivery.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          deliveryNumber: true,
          status: true,
          address: true,
          departedAt: true,
          arrivedAt: true,
          completedAt: true,
          damageNotes: true,
          signedBy: true,
        },
      }),
    ])

    return NextResponse.json({
      connected: true,
      days_back: daysBack,
      by_status: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
      deliveries: recent,
    })
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: String(e?.message || e) })
  }
}
