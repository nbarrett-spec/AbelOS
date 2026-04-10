export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processMessage } from '@/lib/agent'

// POST: Inbound SMS webhook (Twilio-compatible)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { From, Body, MessageSid } = body

    if (!From || !Body) {
      return NextResponse.json({ error: 'From and Body required' }, { status: 400 })
    }

    // Normalize phone number
    const phone = From.replace(/[^\d+]/g, '')

    // Look up builder by phone
    const builders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "contactName", "companyName" FROM "Builder" WHERE phone = $1 AND status = 'ACTIVE' LIMIT 1`,
      phone
    )

    if (builders.length === 0) {
      // Log the unknown SMS
      await prisma.$queryRawUnsafe(`
        INSERT INTO "AgentSmsLog" (id, "phoneNumber", direction, body, "externalId", status)
        VALUES (gen_random_uuid()::text, $1, 'INBOUND', $2, $3, 'UNKNOWN_SENDER')
      `, phone, Body, MessageSid || null)

      return NextResponse.json({
        reply: 'This number is not associated with an Abel Lumber account. Please contact us at (817) 555-ABEL or register at our builder portal.',
      })
    }

    const builder = builders[0]
    const builderId = builder.id

    // Find existing active SMS conversation or let processMessage create one
    const convRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM "AgentConversation"
      WHERE "builderId" = $1 AND channel = 'SMS' AND status = 'ACTIVE'
      ORDER BY "lastMessageAt" DESC LIMIT 1
    `, builderId)

    const existingConvId = convRows.length > 0 ? convRows[0].id : null

    // Log inbound SMS
    await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentSmsLog" (id, "conversationId", "builderId", "phoneNumber", direction, body, "externalId", status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, 'INBOUND', $4, $5, 'RECEIVED')
    `, existingConvId, builderId, phone, Body, MessageSid || null)

    // Process through shared agent pipeline (channel=SMS gives plain text output)
    const result = await processMessage({
      message: Body.trim(),
      builderId,
      conversationId: existingConvId,
      channel: 'SMS',
    })

    // Log outbound SMS
    await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentSmsLog" (id, "conversationId", "builderId", "phoneNumber", direction, body, status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, 'OUTBOUND', $4, 'SENT')
    `, result.conversationId, builderId, phone, result.response.text)

    return NextResponse.json({ reply: result.response.text })
  } catch (error: any) {
    console.error('SMS webhook error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
