/**
 * Cron: Builder Health Score (A-BIZ-10)
 *
 * Runs daily at 3am CT (8am UTC). Computes a 0-100 health composite for every
 * ACTIVE builder using only Aegis-native data — order frequency, payment
 * behavior, AR utilization, activity recency. Writes one BuilderHealthSnapshot
 * row per builder. Trend (improving/declining/stable) is derived against the
 * snapshot from ≥30 days ago.
 *
 * This is the in-Aegis fallback when the NUC engine is offline. Same inputs
 * always produce the same score — no randomness, no LLM, no external calls.
 *
 * Auth: CRON_SECRET bearer (matches every other cron route).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { snapshotBuilderHealth } from '@/lib/builder-health'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('builder-health-score', 'schedule')
  const started = Date.now()

  try {
    // Pull every ACTIVE builder. Approval gate (approvalStatus) is a separate
    // workflow — for health we follow status, which is the authoritative
    // operational state.
    const builders: Array<{
      id: string
      paymentTerm: string
      creditLimit: number | null
      accountBalance: number
    }> = await prisma.$queryRawUnsafe(
      `SELECT "id", "paymentTerm"::text AS "paymentTerm",
              "creditLimit"::float AS "creditLimit",
              COALESCE("accountBalance", 0)::float AS "accountBalance"
         FROM "Builder"
        WHERE "status" = 'ACTIVE'`,
    )

    let processed = 0
    let failed = 0
    const trendCounts = { improving: 0, declining: 0, stable: 0 }
    const now = new Date()

    for (const b of builders) {
      try {
        const snap = await snapshotBuilderHealth({
          builderId: b.id,
          paymentTerm: b.paymentTerm,
          creditLimit: b.creditLimit,
          accountBalance: b.accountBalance,
          now,
        })
        processed++
        if (snap.trend === 'improving') trendCounts.improving++
        else if (snap.trend === 'declining') trendCounts.declining++
        else trendCounts.stable++
      } catch (e) {
        failed++
        console.error('[builder-health-score] builder failed', b.id, e)
      }
    }

    const duration = Date.now() - started
    const payload = {
      success: true,
      buildersTotal: builders.length,
      processed,
      failed,
      trend: trendCounts,
      duration_ms: duration,
      timestamp: now.toISOString(),
    }

    await finishCronRun(runId, 'SUCCESS', duration, { result: payload })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[builder-health-score] error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
