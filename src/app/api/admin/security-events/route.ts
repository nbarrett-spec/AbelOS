export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
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
  const authError = await checkStaffAuthWithFallback(request)
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

    // ──────────────────────────────────────────────────────────────
    // Time-series buckets for sparkline rendering on /admin/health.
    // Bucket size auto-scales with the query window so a 1h view has
    // 5-minute resolution and a 7-day view has hourly resolution.
    // ──────────────────────────────────────────────────────────────
    let bucketMinutes = 60
    if (sinceHours <= 1) bucketMinutes = 5
    else if (sinceHours <= 6) bucketMinutes = 15
    else if (sinceHours <= 24) bucketMinutes = 60
    else if (sinceHours <= 72) bucketMinutes = 180
    else bucketMinutes = 360

    const bucketMs = bucketMinutes * 60 * 1000
    const now = Date.now()
    const windowStart = now - sinceHours * 60 * 60 * 1000
    const firstBucket = Math.floor(windowStart / bucketMs) * bucketMs
    const bucketCount = Math.ceil((now - firstBucket) / bucketMs)

    const bucketMap = new Map<
      number,
      {
        bucketStart: string
        RATE_LIMIT: number
        CSRF: number
        AUTH_FAIL: number
        SUSPICIOUS: number
        total: number
      }
    >()
    for (let i = 0; i < bucketCount; i++) {
      const t = firstBucket + i * bucketMs
      bucketMap.set(t, {
        bucketStart: new Date(t).toISOString(),
        RATE_LIMIT: 0,
        CSRF: 0,
        AUTH_FAIL: 0,
        SUSPICIOUS: 0,
        total: 0,
      })
    }
    for (const r of rows) {
      const t = Math.floor(new Date(r.createdAt).getTime() / bucketMs) * bucketMs
      const entry = bucketMap.get(t)
      if (!entry) continue
      entry.total += 1
      if (r.kind === 'RATE_LIMIT') entry.RATE_LIMIT += 1
      else if (r.kind === 'CSRF') entry.CSRF += 1
      else if (r.kind === 'AUTH_FAIL') entry.AUTH_FAIL += 1
      else if (r.kind === 'SUSPICIOUS') entry.SUSPICIOUS += 1
    }
    const buckets = Array.from(bucketMap.values()).sort((a, b) =>
      a.bucketStart.localeCompare(b.bucketStart)
    )

    return NextResponse.json({
      rows,
      kindCounts,
      topIps,
      topPaths,
      total: rows.length,
      sinceHours,
      bucketMinutes,
      buckets,
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
        bucketMinutes: 60,
        buckets: [],
        note: 'SecurityEvent table not yet populated',
      })
    }
    return NextResponse.json(
      { error: err?.message || 'Failed to load security events' },
      { status: 500 }
    )
  }
}
