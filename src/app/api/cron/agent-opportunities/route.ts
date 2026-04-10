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

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[Agent Cron] Starting opportunity detection...')

    const startTime = Date.now()

    // Run opportunity detection
    await detectAndQueueOpportunities()

    const duration = Date.now() - startTime

    console.log(`[Agent Cron] Completed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      message: 'Opportunity detection completed',
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Agent Cron] Error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
