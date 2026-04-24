export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/warehouse/cycle-count/history
 *
 * Returns the last 12 batches (roughly one quarter) with completion stats and
 * a rollup of total variance $$ (absolute |countedQty - expectedQty| × unitCost)
 * per batch. Feeds the "discrepancy trend" panel in the UI.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        b.id,
        b."weekStart",
        b.status,
        b."totalSkus",
        b."completedSkus",
        b."discrepanciesFound",
        b."createdAt",
        b."closedAt",
        COALESCE(NULLIF(TRIM(s."firstName" || ' ' || s."lastName"), ''), NULL) AS "assignedToName",
        COALESCE(SUM(
          CASE
            WHEN l.variance IS NOT NULL
              THEN ABS(l.variance) * COALESCE(ii."unitCost", 0)
            ELSE 0
          END
        ), 0)::float AS "varianceDollars"
      FROM "CycleCountBatch" b
      LEFT JOIN "Staff"              s  ON s.id  = b."assignedToId"
      LEFT JOIN "CycleCountLine"     l  ON l."batchId"   = b.id
      LEFT JOIN "InventoryItem"      ii ON ii."productId" = l."productId"
      GROUP BY b.id, s."firstName", s."lastName"
      ORDER BY b."weekStart" DESC, b."createdAt" DESC
      LIMIT 12
    `).catch(() => [])

    return NextResponse.json({
      batches: rows.map((r: any) => ({
        id: r.id,
        weekStart: r.weekStart,
        status: r.status,
        totalSkus: Number(r.totalSkus || 0),
        completedSkus: Number(r.completedSkus || 0),
        discrepanciesFound: Number(r.discrepanciesFound || 0),
        completionRate:
          Number(r.totalSkus || 0) > 0
            ? Number(r.completedSkus || 0) / Number(r.totalSkus)
            : 0,
        varianceDollars: Number(r.varianceDollars || 0),
        assignedToName: r.assignedToName,
        createdAt: r.createdAt,
        closedAt: r.closedAt,
      })),
    })
  } catch (error: any) {
    console.error('[cycle-count/history] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cycle-count history' },
      { status: 500 }
    )
  }
}
