export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleWebhook } from '@/lib/integrations/hyphen'

// POST /api/webhooks/hyphen — Handle Hyphen BuildPro/SupplyPro events
export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const config = await (prisma as any).integrationConfig.findUnique({
      where: { provider: 'HYPHEN' },
    })

    const webhookSecret = request.headers.get('x-webhook-secret') || request.headers.get('x-hyphen-signature')
    if (config?.webhookSecret && webhookSecret !== config.webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const eventType = body.eventType || body.event || request.headers.get('x-event-type')

    if (!eventType) {
      return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
    }

    await handleWebhook(eventType, body.data || body)

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Hyphen webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
