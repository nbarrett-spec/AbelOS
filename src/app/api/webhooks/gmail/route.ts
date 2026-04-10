export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { handlePushNotification } from '@/lib/integrations/gmail'

// POST /api/webhooks/gmail — Handle Gmail Pub/Sub push notifications
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Gmail Pub/Sub sends base64 encoded data
    const message = body.message
    if (!message?.data) {
      return NextResponse.json({ error: 'No message data' }, { status: 400 })
    }

    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString())
    const { emailAddress, historyId } = decoded

    // Verify it's for our domain
    if (!emailAddress?.endsWith('@abellumber.com')) {
      return NextResponse.json({ received: true }) // Ignore non-domain emails
    }

    // Process the notification asynchronously
    handlePushNotification(historyId).catch(err => {
      console.error('Gmail push notification processing error:', err)
    })

    // Must return 200 quickly to acknowledge Pub/Sub
    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Gmail webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
