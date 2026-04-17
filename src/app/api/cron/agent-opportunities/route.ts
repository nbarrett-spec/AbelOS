/**
 * Agent Cron: Auto-Detect Opportunities
 *
 * Runs daily (Mon-Fri 9am CT / 2pm UTC)
 * - Find stale quotes (> 5 days, status SENT, not expired)
 * - Find builders with no orders in 30+ days
 * - Find blueprints uploaded but not analyzed
 * - For each, create and queue the appropriate workflow
 *
 * Requires CRON_SECRET for auth
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { detectAndQueueOpportunities } from '@/lib/agent-orchestrator'
import { startCronRun, finishCronRun } from '@/lib/cron'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('agent-opportunities', 'schedule')
  const startTime = Date.now()

  try {
    // console.log('[Agent Cron] Starting opportunity detection...')

    // Run opportunity detection
    await detectAndQueueOpportunities()

    const duration = Date.now() - startTime

    // console.log(`[Agent Cron] Completed in ${duration}ms`)

    const payload = {
      success: true,
      message: 'Opportunity detection completed',
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    }
    await finishCronRun(runId, 'SUCCESS', duration, { result: payload })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[Agent Cron] Error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - startTime, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
