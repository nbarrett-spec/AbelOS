export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { runAegisToBrainSync } from '../../../../../scripts/aegis-to-brain-sync'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/aegis-brain-sync
//
// PUSH direction (the counterpart to /api/cron/brain-sync which PULLs).
//
// Pulls last-1-hour activity out of Aegis (Orders, POs, InboxItems,
// CollectionActions) and POSTs to https://brain.abellumber.com/brain/ingest/batch
// as Brain Events. Also stamps InboxItem.brainAcknowledgedAt so repeat runs
// don't re-send the same items.
//
// Auth: Bearer ${CRON_SECRET}
// Protected brain endpoint: Cloudflare Access service token
//   (CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET env vars)
//
// Cron schedule lives in vercel.json (hourly).
// ──────────────────────────────────────────────────────────────────────────

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('aegis-brain-sync', 'schedule')
  const started = Date.now()

  // Hourly run: look back 65 minutes (5-min overlap, safer than losing events
  // at the boundary — InboxItem.brainAcknowledgedAt gives dedup for the
  // highest-volume type, the others dedup in brain via source_id fingerprint).
  const lookbackMs = 65 * 60 * 1000

  try {
    const report = await runAegisToBrainSync(prisma, {
      commit: true,
      lookbackMs,
      limit: null,
    })

    const ok = report.errors.length === 0 && report.sent === report.totalEvents

    await finishCronRun(runId, ok ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: report,
      error: ok ? undefined : `${report.errors.length} errors; sent ${report.sent}/${report.totalEvents}`,
    })

    return NextResponse.json(
      {
        success: ok,
        timestamp: new Date().toISOString(),
        eventCounts: report.eventCounts,
        totalEvents: report.totalEvents,
        sent: report.sent,
        batches: report.batches,
        inboxAckUpdated: report.inboxAckUpdated,
        cfAuth: report.cfAuth,
        errors: report.errors.length > 0 ? report.errors.slice(0, 10) : undefined,
      },
      { status: ok ? 200 : 207 }
    )
  } catch (error: any) {
    console.error('aegis-brain-sync cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

// Allow manual POST trigger (same auth)
export async function POST(request: NextRequest) {
  return GET(request)
}
