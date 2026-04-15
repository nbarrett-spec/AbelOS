export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/security-events  → recent security events + aggregates
//
// Reads from SecurityEvent, populated fire-and-forget by the rate limiter
// and (eventually) CSRF rejection path.
//
// Query filters:
//   ?since=24  hours back, 1..720 (default 24)
//   ?limit=200 row cap, 1..1000 (default 200)
//   ?kind=     filter to RATE_LIMIT | CSRF | AUTH_FAIL | SUSPICIOUS
// ──────────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string
  createdAt: string
  kind: string
  path: string | null
  method: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
  details: unknown
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const sinceHours = Math.min(
    Math.max(parseInt(searchParams.get('since') || '24'), 1),
    720
  )
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '200'), 1),
    1000
  )
  const kind = searchParams.get('kind') || undefined

  try {
    const whereClauses: string[] = [
      `"createdAt" > NOW() - INTERVAL '${sinceHours} hours'`,
    ]
    const params: any[] = []
    if (kind) {
      params.push(kind)
      whereClauses.push(`"kind" = $${params.length}`)
    }
    const whereSql = whereClauses.join(' AND ')

    params.push(limit)
    const limitParam = `$${params.length}`

    const rows: EventRow[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "kind", "path", "method", "ip", "userAgent", "requestId", "details"
       FROM "SecurityEvent"
       WHERE ${whereSql}
       ORDER BY "createdAt" DESC
       LIMIT ${limitParam}`,
      ...params
    )

    // Aggregate by kind
    const byKind = new Map<string, number>()
    // Aggregate by IP — highlight top offenders
    const byIp = new Map<string, { ip: string; count: number; lastSeen: string }>()
    // Aggregate by path
    const byPath = new Map<string, number>()

    for (const r of rows) {
      byKind.set(r.kind, (byKind.get(r.kind) || 0) + 1)
      if (r.ip) {
        const entry = byIp.get(r.ip) || { ip: r.ip, count: 0, lastSeen: r.createdAt }
        entry.count += 1
        if (new Date(r.createdAt) > new Date(entry.lastSeen)) {
          entry.lastSeen = r.createdAt
        }
        byIp.set(r.ip, entry)
      }
      if (r.path) {
        byPath.set(r.path, (byPath.get(r.path) || 0) + 1)
      }
    }

    const topIps = Array.from(byIp.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topPaths = Array.from(byPath.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const kindCounts = Array.from(byKind.entries()).map(([kind, count]) => ({
      kind,
      count,
    }))

    return NextResponse.json({
      rows,
      kindCounts,
      topIps,
      topPaths,
      total: rows.length,
      sinceHours,
    })
  } catch (err: any) {
    if (err?.message?.includes('SecurityEvent') || err?.code === '42P01') {
      return NextResponse.json({
        rows: [],
        kindCounts: [],
        topIps: [],
        topPaths: [],
        total: 0,
        sinceHours,
        note: 'SecurityEvent table not yet populated',
      })
    }
    return NextResponse.json(
      { error: err?.message || 'Failed to load security events' },
      { status: 500 }
    )
  }
}
