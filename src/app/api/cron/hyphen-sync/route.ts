export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncScheduleUpdates, syncPayments, syncOrders } from '@/lib/integrations/hyphen'

export async function POST(request: NextRequest) {
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

  try {
    // Execute all three sync operations
    const [scheduleResult, paymentsResult, ordersResult] = await Promise.all([
      syncScheduleUpdates(),
      syncPayments(),
      syncOrders(),
    ])

    const allSuccess = [scheduleResult, paymentsResult, ordersResult].every(r => r.status !== 'FAILED')

    return NextResponse.json(
      {
        success: allSuccess,
        timestamp: new Date().toISOString(),
        results: {
          scheduleUpdates: scheduleResult,
          payments: paymentsResult,
          orders: ordersResult,
        },
      },
      { status: allSuccess ? 200 : 207 }
    )
  } catch (error: any) {
    console.error('Hyphen cron sync error:', error)
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
