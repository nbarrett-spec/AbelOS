/**
 * Cron: Gmail Sync — All Accounts
 *
 * Runs every 15 minutes during business hours.
 * Uses service account with domain-wide delegation to pull
 * emails from all abellumber.com mailboxes into CommunicationLog.
 *
 * Requires:
 *   - CRON_SECRET (for cron auth)
 *   - GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_PATH
 *
 * 2026-04-23 hardening — after a 2-day outage (key missing in Vercel prod)
 * the cron was accumulating RUNNING rows because a ~2-day backlog across
 * 15 mailboxes blew past Vercel's 300s maxDuration before finishCronRun()
 * could write. Changes:
 *   - Default batch 50/account (was 200) → ~750 msg/run ceiling.
 *   - Hard time budget 240s with graceful partial-result shutdown, so
 *     finishCronRun() always lands.
 *   - Skip if a prior RUNNING row is <20 min old (prevents overlap).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncAllAccounts, processIncomingMessages } from '@/lib/integrations/gmail'
import { startCronRun, finishCronRun } from '@/lib/cron'

// Leave ~60s of headroom below Vercel's 300s maxDuration so finishCronRun
// has a chance to write even if a per-account loop is slow.
const SOFT_BUDGET_MS = 240_000

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if Gmail service account is configured
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    return NextResponse.json({
      success: true,
      skipped: true,
      message: 'Gmail not configured — skipping sync. Set GOOGLE_SERVICE_ACCOUNT_KEY env var to enable.',
    })
  }

  // Avoid stacking runs on top of a still-in-flight predecessor. If a RUNNING
  // row exists younger than 20 min, bail — Vercel sometimes kicks off a new
  // invocation before the prior process has recorded finishCronRun.
  try {
    const inFlight = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "startedAt" FROM "CronRun"
       WHERE "name" = 'gmail-sync' AND "status" = 'RUNNING'
         AND "startedAt" > NOW() - INTERVAL '20 minutes'
       LIMIT 1`
    )
    if (inFlight.length > 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Prior gmail-sync run still RUNNING (startedAt=${inFlight[0].startedAt}); skipping to avoid overlap.`,
      })
    }
  } catch {
    // If the check itself fails, fall through — worst case we overlap once.
  }

  const runId = await startCronRun('gmail-sync')
  const started = Date.now()

  try {
    // Bounded batch that fits within the 240s soft budget even with 15 mailboxes.
    // Window 'newer_than:1h' gives one cadence of overlap (cron fires every 15m)
    // without re-scanning days of history on cold start.
    const syncPromise = syncAllAccounts(50, 'newer_than:1h')

    // Enforce a hard time budget: if sync doesn't resolve in 240s, return
    // a PARTIAL-style FAILURE with a clear message so the CronRun row lands.
    const budgetPromise = new Promise<{ timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), SOFT_BUDGET_MS)
    )

    const raced = await Promise.race([
      syncPromise.then((r) => ({ timedOut: false as const, result: r })),
      budgetPromise,
    ])

    if ('timedOut' in raced && raced.timedOut) {
      await finishCronRun(runId, 'FAILURE', Date.now() - started, {
        result: { note: 'exceeded 240s soft budget' },
        error: `gmail-sync exceeded ${SOFT_BUDGET_MS}ms soft budget — sync still running in background. If this recurs, reduce per-account batch or narrow the query window.`,
      })
      return NextResponse.json(
        { success: false, error: 'Gmail sync exceeded time budget' },
        { status: 504 }
      )
    }

    const { result } = raced as { timedOut: false; result: Awaited<typeof syncPromise> }

    // A-INT-4: post-ingest pass — raise InboxItems for unfiltered inbound
    // messages from known builders, attach replies to open thread items,
    // and stamp processedAt so we don't reprocess on the next run. Bounded
    // by what's left of the soft budget so finishCronRun still lands.
    let processed: Awaited<ReturnType<typeof processIncomingMessages>> | null = null
    try {
      const processingDeadline = started + SOFT_BUDGET_MS - 10_000 // leave 10s for finishCronRun
      processed = await processIncomingMessages({
        limit: 500,
        deadlineAt: processingDeadline,
      })
    } catch (procErr: any) {
      // Non-fatal — sync itself succeeded; surface as a soft warning.
      processed = {
        considered: 0,
        inboxRaised: 0,
        threadsAttached: 0,
        suppressed: 0,
        failed: 0,
      }
      console.warn('[gmail-sync] processIncomingMessages threw:', procErr?.message)
    }

    await finishCronRun(runId, result.status === 'FAILED' ? 'FAILURE' : 'SUCCESS', Date.now() - started, {
      result: {
        created: result.recordsCreated,
        skipped: result.recordsSkipped,
        failed: result.recordsFailed,
        durationMs: result.durationMs,
        processed,
      },
      // Surface errorMessage from syncAllAccounts so CronRun.error is populated
      // (previously null for FAILED runs — hid the real root cause)
      error: result.errorMessage || undefined,
    })

    return NextResponse.json({
      success: result.status !== 'FAILED',
      ...result,
      processed,
    })
  } catch (error: any) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: error.message })

    return NextResponse.json(
      { error: 'Gmail sync cron failed', details: error.message },
      { status: 500 }
    )
  }
}
