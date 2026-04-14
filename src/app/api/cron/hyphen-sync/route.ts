export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncScheduleUpdates, syncPayments, syncOrders } from '@/lib/integrations/hyphen'
import { startCronRun, finishCronRun } from '@/lib/cron'

// Note: vercel.json schedules this as GET, older code used POST. Both work.
async function handle(request: NextRequest) {
  // Verify CRON_SECRET bearer auth
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('hyphen-sync', 'schedule')
  const started = Date.now()

  try {
    // Execute all three sync operations
    const [scheduleResult, paymentsResult, ordersResult] = await Promise.all([
      syncScheduleUpdates(),
      syncPayments(),
      syncOrders(),
    ])

    const allSuccess = [scheduleResult, paymentsResult, ordersResult].every(r => r.status !== 'FAILED')

    const payload = {
      success: allSuccess,
      timestamp: new Date().toISOString(),
      results: {
        scheduleUpdates: scheduleResult,
        payments: paymentsResult,
        orders: ordersResult,
      },
    }
    await finishCronRun(runId, allSuccess ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: payload,
      error: allSuccess ? undefined : 'One or more sync operations FAILED',
    })
    return NextResponse.json(payload, { status: allSuccess ? 200 : 207 })
  } catch (error: any) {
    console.error('Hyphen cron sync error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: error?.message || String(error) })
    return NextResponse.json(
      {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) { return handle(request) }
export async function POST(request: NextRequest) { return handle(request) }
