export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/uptime  → uptime % + probe history
//
// Reads from UptimeProbe, populated every 5 minutes by /api/cron/uptime-probe.
//
// Query filters:
//   ?since=24   hours back, 1..720 (default 24)
//   ?limit=500  row cap, 1..2000 (default 500)
//
// Returns:
//   - summary { total, ready, notReady, uptimePct, avgDbMs, p95DbMs, latestStatus }
//   - rows (most recent first, clamped to limit)
//   - buckets (hourly/daily buckets for sparkline rendering)
// ──────────────────────────────────────────────────────────────────────────

interface UptimeRow {
  id: string
  createdAt: string
  status: string
  totalMs: number
  dbMs: number | null
  dbOk: boolean
  envOk: boolean
  error: string | null
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((sorted.length - 1) * p)
  return sorted[idx]
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
    Math.max(parseInt(searchParams.get('limit') || '500'), 1),
    2000
  )

  try {
    const rows: UptimeRow[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "status", "totalMs", "dbMs", "dbOk", "envOk", "error"
       FROM "UptimeProbe"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      limit
    )

    const total = rows.length
    const ready = rows.filter((r) => r.status === 'ready').length
    const notReady = total - ready
    const uptimePct = total > 0 ? (ready / total) * 100 : 0

    const dbMsValues = rows
      .map((r) => r.dbMs)
      .filter((v): v is number => typeof v === 'number')
    const sortedDbMs = [...dbMsValues].sort((a, b) => a - b)
    const avgDbMs =
      dbMsValues.length > 0
        ? Math.round(dbMsValues.reduce((s, v) => s + v, 0) / dbMsValues.length)
        : null
    const p95DbMs = sortedDbMs.length > 0 ? percentile(sortedDbMs, 0.95) : null

    // Bucketize for sparkline — bucket size auto-scales with window.
    // <=24h → 1h buckets; else → 6h buckets so we keep ≤ ~50 points.
    const bucketHours = sinceHours <= 24 ? 1 : sinceHours <= 168 ? 6 : 24
    const bucketMs = bucketHours * 60 * 60 * 1000
    const buckets = new Map<
      number,
      { bucketStart: number; total: number; ready: number; avgDbMs: number | null }
    >()
    for (const r of rows) {
      const ts = new Date(r.createdAt).getTime()
      const bucketKey = Math.floor(ts / bucketMs) * bucketMs
      const entry = buckets.get(bucketKey) || {
        bucketStart: bucketKey,
        total: 0,
        ready: 0,
        avgDbMs: null,
      }
      entry.total += 1
      if (r.status === 'ready') entry.ready += 1
      buckets.set(bucketKey, entry)
    }
    // Compute avgDbMs per bucket in a second pass (avoids running sum tracking)
    for (const [key, entry] of buckets.entries()) {
      const bucketRows = rows.filter(
        (r) => Math.floor(new Date(r.createdAt).getTime() / bucketMs) * bucketMs === key
      )
      const msVals = bucketRows
        .map((r) => r.dbMs)
        .filter((v): v is number => typeof v === 'number')
      entry.avgDbMs =
        msVals.length > 0
          ? Math.round(msVals.reduce((s, v) => s + v, 0) / msVals.length)
          : null
    }

    const sortedBuckets = Array.from(buckets.values()).sort(
      (a, b) => a.bucketStart - b.bucketStart
    )

    return NextResponse.json({
      summary: {
        total,
        ready,
        notReady,
        uptimePct: Math.round(uptimePct * 100) / 100,
        avgDbMs,
        p95DbMs,
        latestStatus: rows[0]?.status ?? null,
      },
      rows: rows.slice(0, 100),
      buckets: sortedBuckets,
      sinceHours,
      bucketHours,
    })
  } catch (err: any) {
    if (err?.message?.includes('UptimeProbe') || err?.code === '42P01') {
      return NextResponse.json({
        summary: {
          total: 0,
          ready: 0,
          notReady: 0,
          uptimePct: 0,
          avgDbMs: null,
          p95DbMs: null,
          latestStatus: null,
        },
        rows: [],
        buckets: [],
        sinceHours,
        bucketHours: 1,
        note: 'UptimeProbe table not yet populated — cron has not run',
      })
    }
    return NextResponse.json(
      { error: err?.message || 'Failed to load uptime data' },
      { status: 500 }
    )
  }
}
