export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/admin/webhooks/stats
//
// Aggregates WebhookEvent rows into a dashboard-ready shape:
//
//   {
//     providers: [
//       {
//         provider: 'stripe',
//         total24h, total7d,
//         success24h, success7d,
//         failed24h, failed7d,
//         deadLetter, inFlight,
//         successRate24h, successRate7d,    // 0–100, null when no data
//         medianLatencyMs                   // received → processed, null if no data
//       }, ...
//     ],
//     totals: { total24h, total7d, success24h, success7d, failed24h, failed7d, deadLetter, inFlight, successRate24h, successRate7d },
//     recentFailures: [ { id, provider, eventType, status, error, retryCount, maxRetries, receivedAt, lastAttemptAt }, ... up to 20 ]
//   }
//
// Buckets:
//   "success"   = status='PROCESSED'
//   "failed"    = status='FAILED' (still retrying)
//   "deadLetter"= status='DEAD_LETTER' (gave up)
//   "inFlight"  = status='RECEIVED' (not yet processed)
//
// Reads only — no writes. Returns 500 on unexpected DB errors but degrades
// gracefully to empty arrays if the WebhookEvent table is missing.
// ──────────────────────────────────────────────────────────────────────────

interface ProviderRow {
  provider: string
  status: string
  bucket: '24h' | '7d'
  count: number
}

interface LatencyRow {
  provider: string
  median_ms: number | null
}

interface FailureRow {
  id: string
  provider: string
  eventType: string | null
  status: string
  error: string | null
  retryCount: number
  maxRetries: number
  receivedAt: Date
  lastAttemptAt: Date | null
}

export async function GET(request: NextRequest) {
  try {
    const authError = await checkStaffAuthWithFallback(request)
    if (authError) return authError

    // Per-provider counts split by 24h / 7d windows. Wraps any DB error so an
    // unprovisioned table returns "no data" rather than 500.
    let countRows: ProviderRow[] = []
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT
           "provider",
           "status",
           CASE
             WHEN "receivedAt" > NOW() - INTERVAL '24 hours' THEN '24h'
             ELSE '7d'
           END AS "bucket",
           COUNT(*)::int AS "count"
         FROM "WebhookEvent"
         WHERE "receivedAt" > NOW() - INTERVAL '7 days'
         GROUP BY "provider", "status", "bucket"`
      )
      countRows = rows as ProviderRow[]
    } catch {
      countRows = []
    }

    // Open buckets (DEAD_LETTER + RECEIVED) regardless of age — DLQ rows live
    // until an operator clears them.
    let openRows: { provider: string; status: string; count: number }[] = []
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "provider", "status", COUNT(*)::int AS "count"
         FROM "WebhookEvent"
         WHERE "status" IN ('DEAD_LETTER', 'RECEIVED')
         GROUP BY "provider", "status"`
      )
      openRows = rows
    } catch {
      openRows = []
    }

    // Median latency (received → processed) per provider, processed events
    // only, last 7 days. PERCENTILE_CONT returns float ms.
    let latencyRows: LatencyRow[] = []
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT
           "provider",
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM ("processedAt" - "receivedAt")) * 1000
           ) AS "median_ms"
         FROM "WebhookEvent"
         WHERE "status" = 'PROCESSED'
           AND "processedAt" IS NOT NULL
           AND "receivedAt" > NOW() - INTERVAL '7 days'
         GROUP BY "provider"`
      )
      latencyRows = rows.map((r: any) => ({
        provider: r.provider,
        median_ms: r.median_ms != null ? Number(r.median_ms) : null,
      }))
    } catch {
      latencyRows = []
    }

    // Recent failures (FAILED + DEAD_LETTER), 20 most recent.
    let failures: FailureRow[] = []
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "provider", "eventType", "status", "error",
                "retryCount", "maxRetries", "receivedAt", "lastAttemptAt"
         FROM "WebhookEvent"
         WHERE "status" IN ('FAILED', 'DEAD_LETTER')
         ORDER BY COALESCE("lastAttemptAt", "receivedAt") DESC
         LIMIT 20`
      )
      failures = rows as FailureRow[]
    } catch {
      failures = []
    }

    // ── Stitch into per-provider records ────────────────────────────────
    const providers = new Map<
      string,
      {
        provider: string
        total24h: number
        total7d: number
        success24h: number
        success7d: number
        failed24h: number
        failed7d: number
        deadLetter: number
        inFlight: number
        successRate24h: number | null
        successRate7d: number | null
        medianLatencyMs: number | null
      }
    >()

    const ensure = (p: string) => {
      if (!providers.has(p)) {
        providers.set(p, {
          provider: p,
          total24h: 0,
          total7d: 0,
          success24h: 0,
          success7d: 0,
          failed24h: 0,
          failed7d: 0,
          deadLetter: 0,
          inFlight: 0,
          successRate24h: null,
          successRate7d: null,
          medianLatencyMs: null,
        })
      }
      return providers.get(p)!
    }

    // bucket='24h' means the row is in the trailing 24-hour window;
    // bucket='7d' means it's older than 24h but within 7 days. We always
    // fold 24h into 7d so the 7d totals are inclusive (matches how an
    // operator reads "last 7 days" — they expect today's events to count).
    for (const row of countRows) {
      const rec = ensure(row.provider)
      const isSuccess = row.status === 'PROCESSED'
      const isFailed = row.status === 'FAILED' || row.status === 'DEAD_LETTER'
      if (row.bucket === '24h') {
        rec.total24h += row.count
        if (isSuccess) rec.success24h += row.count
        if (isFailed) rec.failed24h += row.count
      }
      // 7d is inclusive of 24h
      rec.total7d += row.count
      if (isSuccess) rec.success7d += row.count
      if (isFailed) rec.failed7d += row.count
    }

    for (const row of openRows) {
      const rec = ensure(row.provider)
      if (row.status === 'DEAD_LETTER') rec.deadLetter = row.count
      if (row.status === 'RECEIVED') rec.inFlight = row.count
    }

    for (const row of latencyRows) {
      const rec = ensure(row.provider)
      rec.medianLatencyMs = row.median_ms != null ? Math.round(row.median_ms) : null
    }

    // Compute success rates (avoid divide-by-zero).
    for (const rec of providers.values()) {
      const denom24 = rec.success24h + rec.failed24h
      rec.successRate24h = denom24 > 0
        ? Math.round((rec.success24h / denom24) * 1000) / 10
        : null
      const denom7 = rec.success7d + rec.failed7d
      rec.successRate7d = denom7 > 0
        ? Math.round((rec.success7d / denom7) * 1000) / 10
        : null
    }

    const providerList = Array.from(providers.values()).sort((a, b) =>
      a.provider.localeCompare(b.provider)
    )

    // Roll up totals across providers.
    const totals = providerList.reduce(
      (acc, p) => ({
        total24h: acc.total24h + p.total24h,
        total7d: acc.total7d + p.total7d,
        success24h: acc.success24h + p.success24h,
        success7d: acc.success7d + p.success7d,
        failed24h: acc.failed24h + p.failed24h,
        failed7d: acc.failed7d + p.failed7d,
        deadLetter: acc.deadLetter + p.deadLetter,
        inFlight: acc.inFlight + p.inFlight,
      }),
      {
        total24h: 0,
        total7d: 0,
        success24h: 0,
        success7d: 0,
        failed24h: 0,
        failed7d: 0,
        deadLetter: 0,
        inFlight: 0,
      }
    )
    const tDenom24 = totals.success24h + totals.failed24h
    const tDenom7 = totals.success7d + totals.failed7d
    const finalTotals = {
      ...totals,
      successRate24h:
        tDenom24 > 0
          ? Math.round((totals.success24h / tDenom24) * 1000) / 10
          : null,
      successRate7d:
        tDenom7 > 0
          ? Math.round((totals.success7d / tDenom7) * 1000) / 10
          : null,
    }

    return NextResponse.json({
      providers: providerList,
      totals: finalTotals,
      recentFailures: failures,
      computedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('GET /api/ops/admin/webhooks/stats error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
