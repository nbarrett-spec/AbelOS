export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'
import { auditBuilder } from '@/lib/audit'

// GET /api/builder/chat/[conversationId] — Get messages for a specific conversation
export async function GET(
  request: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderId = session.builderId
    const conversationId = params.conversationId
    const { searchParams } = new URL(request.url)
    const skip = parseInt(searchParams.get('skip') || '0')
    const take = parseInt(searchParams.get('take') || '50')

    // Verify conversation belongs to this builder
    const convCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "subject" FROM "Conversation"
      WHERE "id" = $1 AND "builderId" = $2
    `, conversationId, builderId)

    if (convCheck.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const conversation = convCheck[0]

    // Get messages with sender info
    const messages: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        m."id",
        m."conversationId",
        m."senderId",
        m."builderSenderId",
        m."senderType"::text AS "senderType",
        m."body",
        m."readBy",
        m."readByBuilder",
        m."createdAt",
        s."firstName",
        s."lastName",
        s."title",
        s."avatar"
      FROM "Message" m
      LEFT JOIN "Staff" s ON m."senderId" = s."id"
      WHERE m."conversationId" = $1
      ORDER BY m."createdAt" ASC
      LIMIT $2 OFFSET $3
    `, conversationId, take, skip)

    // Mark all messages as read by builder
    await prisma.$executeRawUnsafe(`
      UPDATE "Message"
      SET "readByBuilder" = true
      WHERE "conversationId" = $1 AND "readByBuilder" = false
    `, conversationId)

    // Get total message count
    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count FROM "Message"
      WHERE "conversationId" = $1
    `, conversationId)

    const total = countResult[0]?.count || 0

    // Format messages for response
    const formattedMessages = messages.map(m => {
      const msg: any = {
        id: m.id,
        conversationId: m.conversationId,
        senderType: m.senderType,
        body: m.body,
        readBy: m.readBy || [],
        readByBuilder: m.readByBuilder,
        createdAt: m.createdAt,
      }

      if (m.senderType === 'STAFF') {
        msg.sender = {
          staffId: m.senderId,
          firstName: m.firstName,
          lastName: m.lastName,
          title: m.title,
          avatar: m.avatar,
        }
      } else if (m.senderType === 'BUILDER') {
        msg.sender = {
          builderId: m.builderSenderId,
          companyName: session.companyName,
        }
      }

      return msg
    })

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
      },
      messages: formattedMessages,
      total,
      skip,
      take,
    })
  } catch (error: any) {
    console.error('Error fetching messages:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

// POST /api/builder/chat/[conversationId] — Send a message in this conversation
export async function POST(
  request: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderId = session.builderId
    auditBuilder(builderId, session.companyName || 'Unknown', 'CREATE', 'ChatMessage').catch(() => {});
    const conversationId = params.conversationId
    const body = await request.json()
    const { message } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message body is required' },
        { status: 400 }
      )
    }

    // Verify conversation belongs to this builder
    const convCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "subject" FROM "Conversation"
      WHERE "id" = $1 AND "builderId" = $2
    `, conversationId, builderId)

    if (convCheck.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const conversation = convCheck[0]

    // senderId is NOT NULL FK → Staff. For builder-originated messages, stamp
    // the on-call staff (drift reconciled 2026-04-22). If the conversation
    // already has a creator, reuse that; otherwise fall back to any active
    // SALES/EXECUTIVE/OPERATIONS staff.
    const creatorLookup: any[] = await prisma.$queryRawUnsafe(`
      SELECT "createdById" FROM "Conversation" WHERE "id" = $1
    `, conversationId)
    let onCallStaffId: string | null = creatorLookup[0]?.createdById ?? null
    if (!onCallStaffId) {
      const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id" FROM "Staff"
        WHERE "active" = true
          AND "department"::text IN ('SALES', 'EXECUTIVE', 'OPERATIONS')
        ORDER BY "createdAt" ASC
        LIMIT 1
      `)
      onCallStaffId = rows[0]?.id ?? null
    }
    if (!onCallStaffId) {
      return NextResponse.json({ error: 'No on-call staff available' }, { status: 503 })
    }

    // Create message
    const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date()

    await prisma.$executeRawUnsafe(`
      INSERT INTO "Message" (
        "id", "conversationId", "senderId", "builderSenderId", "senderType", "body", "readBy", "readByBuilder", "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], true, $8)
    `, messageId, conversationId, onCallStaffId, builderId, 'BUILDER', message, [], now)

    // Update conversation with last message info
    const preview = message.length > 100 ? message.substring(0, 100) + '...' : message
    await prisma.$executeRawUnsafe(`
      UPDATE "Conversation"
      SET "lastMessageAt" = $1, "lastMessagePreview" = $2
      WHERE "id" = $3
    `, now, preview, conversationId)

    // Notify all staff participants
    const participants: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT cp."staffId"
      FROM "ConversationParticipant" cp
      WHERE cp."conversationId" = $1
    `, conversationId)

    for (const participant of participants) {
      await createNotification({
        staffId: participant.staffId,
        type: 'MESSAGE',
        title: 'New builder message',
        message: `${session.companyName} replied: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
        link: `/staff/chat/${conversationId}`,
      })
    }

    return NextResponse.json({
      success: true,
      messageId,
      conversationId,
    })
  } catch (error: any) {
    console.error('Error sending message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
