export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/slow-queries  → recent slow Prisma queries + aggregates
//
// Reads from SlowQueryLog, which is populated by the $extends query hook
// in src/lib/prisma.ts when any operation exceeds PRISMA_SLOW_QUERY_MS.
//
// Query filters:
//   ?since=24    hours back, 1..720 (default 24)
//   ?limit=200   row cap, 1..1000 (default 200)
//   ?model=      filter by model name (or "raw" for raw SQL)
// ──────────────────────────────────────────────────────────────────────────

interface SlowQueryRow {
  id: string
  createdAt: string
  model: string
  operation: string
  durationMs: number
  thresholdMs: number
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
  const model = searchParams.get('model') || undefined

  try {
    const whereClauses: string[] = [
      `"createdAt" > NOW() - INTERVAL '${sinceHours} hours'`,
    ]
    const params: any[] = []
    if (model) {
      params.push(model)
      whereClauses.push(`"model" = $${params.length}`)
    }
    const whereSql = whereClauses.join(' AND ')

    params.push(limit)
    const limitParam = `$${params.length}`

    const rows: SlowQueryRow[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "model", "operation", "durationMs", "thresholdMs"
       FROM "SlowQueryLog"
       WHERE ${whereSql}
       ORDER BY "createdAt" DESC
       LIMIT ${limitParam}`,
      ...params
    )

    // Aggregate by model+operation so the UI can show "top offenders"
    const byKey = new Map<
      string,
      {
        model: string
        operation: string
        count: number
        maxMs: number
        totalMs: number
      }
    >()
    for (const r of rows) {
      const key = `${r.model}.${r.operation}`
      const entry = byKey.get(key) || {
        model: r.model,
        operation: r.operation,
        count: 0,
        maxMs: 0,
        totalMs: 0,
      }
      entry.count += 1
      entry.maxMs = Math.max(entry.maxMs, r.durationMs)
      entry.totalMs += r.durationMs
      byKey.set(key, entry)
    }
    const topOffenders = Array.from(byKey.values())
      .map((e) => ({
        ...e,
        avgMs: Math.round(e.totalMs / e.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    return NextResponse.json({
      rows,
      topOffenders,
      sinceHours,
      thresholdMs: rows[0]?.thresholdMs || 500,
    })
  } catch (err: any) {
    // Table may not exist yet on a fresh DB — return empty payload rather
    // than 500 so the UI can still render.
    if (err?.message?.includes('SlowQueryLog') || err?.code === '42P01') {
      return NextResponse.json({
        rows: [],
        topOffenders: [],
        sinceHours,
        thresholdMs: 500,
        note: 'SlowQueryLog table not yet populated',
      })
    }
    return NextResponse.json(
      { error: err?.message || 'Failed to load slow queries' },
      { status: 500 }
    )
  }
}
