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

interface ErrorCounts {
  total: number
  top: TopKey[]
}

async function countFor(
  table: string,
  groupCol: string,
  sinceHours: number
): Promise<ErrorCounts> {
  try {
    const totalRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'`
    )
    const total = totalRows[0]?.count || 0

    // Skip the per-group query entirely when the total is zero — saves one
    // round-trip on every /admin/health refresh in the happy case.
    if (total === 0) {
      return { total: 0, top: [] }
    }

    const topRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "${groupCol}" AS "key", COUNT(*)::int AS count
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       GROUP BY "${groupCol}"
       ORDER BY count DESC
       LIMIT 5`
    )
    return {
      total,
      top: topRows.map((r) => ({ key: r.key, count: r.count })),
    }
  } catch (e: any) {
    // Missing table (fresh DB) → return empty counts rather than 500ing
    // the whole health page.
    const msg = e?.message || ''
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return { total: 0, top: [] }
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

  try {
    const [client, server] = await Promise.all([
      countFor('ClientError', 'scope', sinceHours),
      countFor('ServerError', 'errName', sinceHours),
    ])

    return NextResponse.json({
      sinceHours,
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
