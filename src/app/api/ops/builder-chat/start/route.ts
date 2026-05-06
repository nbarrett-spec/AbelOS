export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit, getStaffFromHeaders } from '@/lib/audit'

/**
 * POST /api/ops/builder-chat/start
 *
 * Staff-initiated BUILDER_SUPPORT thread. Creates a Conversation, the first
 * Message (sent by the staff member), and adds the staff as a participant.
 *
 * Body: { builderId: string, subject: string, message: string }
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staff = getStaffFromHeaders(request.headers)
  if (!staff.staffId || staff.staffId === 'unknown') {
    return NextResponse.json({ error: 'Staff session required' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { builderId, subject, message } = body
  if (!builderId || typeof builderId !== 'string') {
    return NextResponse.json({ error: 'builderId is required' }, { status: 400 })
  }
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 })
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  try {
    // Verify builder exists
    const builderCheck = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Builder" WHERE id = $1`,
      builderId
    )
    if (builderCheck.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
    const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
    const participantId = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()
    const trimmedMessage = message.trim()
    const preview = trimmedMessage.length > 100 ? trimmedMessage.slice(0, 100) + '...' : trimmedMessage

    // Create conversation
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Conversation"
        ("id", "type", "subject", "builderId", "createdById", "lastMessageAt", "lastMessagePreview", "createdAt", "updatedAt")
       VALUES ($1, $2::"ConversationType", $3, $4, $5, $6, $7, $6, $6)`,
      conversationId,
      'BUILDER_SUPPORT',
      subject.trim(),
      builderId,
      staff.staffId,
      now,
      preview
    )

    // First message — staff is the sender
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Message"
        ("id", "conversationId", "senderId", "senderType", "body", "readBy", "createdAt")
       VALUES ($1, $2, $3, 'STAFF', $4, $5::jsonb, $6)`,
      messageId,
      conversationId,
      staff.staffId,
      trimmedMessage,
      JSON.stringify([staff.staffId]),
      now
    )

    // Add staff as participant
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ConversationParticipant" ("id", "conversationId", "staffId", "joinedAt")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("conversationId", "staffId") DO NOTHING`,
      participantId,
      conversationId,
      staff.staffId,
      now
    )

    await audit(request, 'CREATE', 'Conversation', conversationId, {
      type: 'BUILDER_SUPPORT',
      builderId,
      subject: subject.trim(),
    })

    return NextResponse.json({
      ok: true,
      conversationId,
      messageId,
    }, { status: 201 })
  } catch (error: any) {
    console.error('[Ops Builder Chat START]', error?.message || error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
