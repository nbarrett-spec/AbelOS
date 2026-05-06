/**
 * GET /api/ops/builders/[id]/health
 *
 * Returns the latest BuilderHealthSnapshot for a builder, or 404 if no
 * snapshot has been computed yet (cron hasn't run, or builder is brand new).
 *
 * A-BIZ-10. Pure read — no recompute on demand. The cron is the writer; this
 * endpoint is the reader.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { scoreToGrade, scoreToTrafficLight } from '@/lib/builder-health'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    const rows: Array<{
      id: string
      builderId: string
      score: number
      trend: string | null
      factors: any
      computedAt: Date
    }> = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId", "score"::int AS score, "trend",
              "factors", "computedAt"
         FROM "BuilderHealthSnapshot"
        WHERE "builderId" = $1
        ORDER BY "computedAt" DESC
        LIMIT 1`,
      id,
    )

    if (rows.length === 0) {
      return NextResponse.json(
        {
          builderId: id,
          snapshot: null,
          message:
            'No health snapshot yet — daily cron at 3am CT writes the first one.',
        },
        { status: 200 },
      )
    }

    const snap = rows[0]
    return NextResponse.json({
      builderId: id,
      snapshot: {
        id: snap.id,
        score: snap.score,
        trend: snap.trend ?? 'stable',
        grade: scoreToGrade(snap.score),
        trafficLight: scoreToTrafficLight(snap.score),
        factors: snap.factors,
        computedAt: snap.computedAt,
      },
    })
  } catch (error) {
    console.error('[GET /api/ops/builders/:id/health] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
