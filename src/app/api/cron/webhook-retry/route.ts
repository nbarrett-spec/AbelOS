export const maxDuration = 300
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  listRetryableWebhooks,
  incrementWebhookRetry,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'
import { replayWebhookPayload } from '@/lib/webhooks/dispatcher'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// Webhook retry worker.
//
// Runs every 5 minutes on Vercel Cron. Picks FAILED WebhookEvent rows whose
// nextRetryAt has passed and replays them through the provider-specific
// dispatcher. Success → PROCESSED; failure → schedule next backoff slot;
// retry exhaustion → DEAD_LETTER, operator must resurrect from /admin/webhooks.
//
// We cap the per-run batch size so a backlog of bad payloads can't blow the
// Vercel function budget.
// ──────────────────────────────────────────────────────────────────────────

const BATCH_LIMIT = 25

async function handle(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('webhook-retry', 'schedule')
  const started = Date.now()

  const attempted: Array<{ id: string; provider: string; outcome: string; error?: string }> = []

  try {
    const due = await listRetryableWebhooks({ limit: BATCH_LIMIT })

    for (const evt of due) {
      if (!evt.payload) {
        // No payload stored (pre-DLQ event) — mark as DEAD_LETTER so it
        // stops cycling. Operator can resurrect from admin UI if desired.
        await markWebhookFailed(evt.id, 'No stored payload — cannot replay')
        attempted.push({ id: evt.id, provider: evt.provider, outcome: 'skipped_no_payload' })
        continue
      }

      // Burn a retry slot BEFORE the attempt so a crash mid-replay still
      // counts. Without this, a repeatedly crashing payload would loop
      // forever.
      await incrementWebhookRetry(evt.id)

      try {
        await replayWebhookPayload(evt.provider, evt.payload)
        await markWebhookProcessed(evt.id)
        attempted.push({ id: evt.id, provider: evt.provider, outcome: 'success' })
      } catch (err: any) {
        await markWebhookFailed(evt.id, err?.message || String(err))
        attempted.push({
          id: evt.id,
          provider: evt.provider,
          outcome: 'failed',
          error: err?.message || String(err),
        })
      }
    }

    const successCount = attempted.filter(a => a.outcome === 'success').length
    const failureCount = attempted.filter(a => a.outcome !== 'success').length
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      attempted: attempted.length,
      succeeded: successCount,
      failed: failureCount,
      details: attempted,
    }
    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Webhook retry cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) { return handle(request) }
export async function POST(request: NextRequest) { return handle(request) }
