export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/error-counts?since=24
//
// Lightweight counts-only endpoint for /admin/health. Returns totals plus
// the top N grouping keys for both ClientError (by scope) and ServerError
// (by errName). No row data — that lives on /admin/errors for drill-down.
//
// Why a new endpoint instead of reusing /api/admin/errors?
//   - That endpoint returns up to 200 rows per call plus stats plus top
//     digests. For a dashboard tile that just needs "how many errors today"
//     it would fetch 400 rows + 4 aggregates per /admin/health refresh.
//   - Keeping this route narrow means the aggregates can grow independently
//     without adding cost to the /admin/errors page path.
// ──────────────────────────────────────────────────────────────────────────

interface TopKey {
  key: string | null
  count: number
}

interface TimeBucket {
  bucketStart: string
  count: number
}

interface ErrorCounts {
  total: number
  top: TopKey[]
  buckets: TimeBucket[]
}

/**
 * Pick a bucket width that gives ~24-48 buckets across the window so the
 * sparkline shows meaningful shape without being either pixelated or
 * squashed. Returns an integer number of minutes that divides cleanly
 * into hour boundaries where possible.
 */
function pickBucketMinutes(sinceHours: number): number {
  if (sinceHours <= 1) return 5 // 12 buckets over 1h
  if (sinceHours <= 6) return 15 // 24 buckets over 6h
  if (sinceHours <= 24) return 60 // 24 buckets over 24h
  if (sinceHours <= 72) return 180 // 24 buckets over 3d
  if (sinceHours <= 168) return 360 // 28 buckets over 7d
  return 1440 // daily buckets beyond 7d
}

async function countFor(
  table: string,
  groupCol: string,
  sinceHours: number,
  bucketMinutes: number
): Promise<ErrorCounts> {
  try {
    const totalRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'`
    )
    const total = totalRows[0]?.count || 0

    // Skip the per-group and per-bucket queries entirely when the total is
    // zero — saves two round-trips on every /admin/health refresh in the
    // happy case.
    if (total === 0) {
      return { total: 0, top: [], buckets: [] }
    }

    const topRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "${groupCol}" AS "key", COUNT(*)::int AS count
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       GROUP BY "${groupCol}"
       ORDER BY count DESC
       LIMIT 5`
    )

    // Bucket by floor(epoch / bucketSeconds) so bucket edges align to
    // wall-clock multiples of the bucket size (e.g. 15-minute buckets
    // land on :00, :15, :30, :45). Using to_timestamp(...) gives us an
    // ISO string that the UI can format directly.
    const bucketSeconds = bucketMinutes * 60
    const bucketRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT to_timestamp(
                FLOOR(EXTRACT(EPOCH FROM "createdAt") / ${bucketSeconds}) * ${bucketSeconds}
              ) AS "bucketStart",
              COUNT(*)::int AS count
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       GROUP BY "bucketStart"
       ORDER BY "bucketStart" ASC`
    )

    return {
      total,
      top: topRows.map((r) => ({ key: r.key, count: r.count })),
      buckets: bucketRows.map((r) => ({
        bucketStart:
          r.bucketStart instanceof Date
            ? r.bucketStart.toISOString()
            : String(r.bucketStart),
        count: r.count,
      })),
    }
  } catch (e: any) {
    // Missing table (fresh DB) → return empty counts rather than 500ing
    // the whole health page.
    const msg = e?.message || ''
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return { total: 0, top: [], buckets: [] }
    }
    throw e
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const sinceHours = Math.min(
    Math.max(parseInt(searchParams.get('since') || '24', 10), 1),
    24 * 30
  )
  const bucketMinutes = pickBucketMinutes(sinceHours)

  try {
    const [client, server] = await Promise.all([
      countFor('ClientError', 'scope', sinceHours, bucketMinutes),
      countFor('ServerError', 'errName', sinceHours, bucketMinutes),
    ])

    return NextResponse.json({
      sinceHours,
      bucketMinutes,
      client,
      server,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Failed to load error counts' },
      { status: 500 }
    )
  }
}
