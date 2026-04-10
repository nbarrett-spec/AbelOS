export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleInflowWebhook } from '@/lib/integrations/inflow'

// POST /api/webhooks/inflow — Handle InFlow webhook events
export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const config = await (prisma as any).integrationConfig.findUnique({
      where: { provider: 'INFLOW' },
    })

    const webhookSecret = request.headers.get('x-webhook-secret')
    if (config?.webhookSecret && webhookSecret !== config.webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const eventType = body.eventType || body.event || request.headers.get('x-event-type')

    if (!eventType) {
      return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
    }

    await handleInflowWebhook(eventType, body.data || body)

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('InFlow webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
