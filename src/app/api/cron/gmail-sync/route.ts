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
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncAllAccounts } from '@/lib/integrations/gmail'
import { startCronRun, finishCronRun } from '@/lib/cron'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('gmail-sync')
  const started = Date.now()

  try {
    // Pull emails from the last 30 minutes (with overlap for safety)
    const result = await syncAllAccounts(200, 'newer_than:30m')

    await finishCronRun(runId, result.status === 'FAILED' ? 'FAILURE' : 'SUCCESS', Date.now() - started, {
      result: {
        created: result.recordsCreated,
        skipped: result.recordsSkipped,
        failed: result.recordsFailed,
        durationMs: result.durationMs,
      },
    })

    return NextResponse.json({
      success: result.status !== 'FAILED',
      ...result,
    })
  } catch (error: any) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: error.message })

    return NextResponse.json(
      { error: 'Gmail sync cron failed', details: error.message },
      { status: 500 }
    )
  }
}
