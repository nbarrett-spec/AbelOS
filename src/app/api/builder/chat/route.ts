export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'
import { auditBuilder } from '@/lib/audit'

/**
 * Pick an on-call staff id used to satisfy NOT NULL `senderId` on Message and
 * `createdById` on Conversation for builder-originated threads (drift
 * reconciled 2026-04-22). Prefers active SALES/EXECUTIVE/OPERATIONS; falls
 * back to any active staff.
 */
async function pickOnCallStaffId(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT "id" FROM "Staff"
    WHERE "active" = true
      AND "department"::text IN ('SALES', 'EXECUTIVE', 'OPERATIONS')
    ORDER BY "createdAt" ASC
    LIMIT 1
  `)
  if (rows.length > 0) return rows[0].id
  const fb = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT "id" FROM "Staff" WHERE "active" = true ORDER BY "createdAt" ASC LIMIT 1
  `)
  return fb[0]?.id ?? null
}

// GET /api/builder/chat — List builder's conversations
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderId = session.builderId
    const { searchParams } = new URL(request.url)
    const skip = parseInt(searchParams.get('skip') || '0')
    const take = parseInt(searchParams.get('take') || '20')

    // Query conversations for this builder with BUILDER_SUPPORT type
    const conversations: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        c."id",
        c."type"::text AS "type",
        c."subject",
        c."lastMessageAt",
        c."lastMessagePreview",
        c."createdAt",
        COUNT(CASE WHEN m."readByBuilder" = false THEN 1 END)::int AS "unreadCount"
      FROM "Conversation" c
      LEFT JOIN "Message" m ON m."conversationId" = c."id"
      WHERE c."builderId" = $1 AND c."type"::text = 'BUILDER_SUPPORT'
      GROUP BY c."id", c."type", c."subject", c."lastMessageAt", c."lastMessagePreview", c."createdAt"
      ORDER BY c."lastMessageAt" DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, builderId, take, skip)

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "Conversation"
      WHERE "builderId" = $1 AND "type"::text = 'BUILDER_SUPPORT'
    `, builderId)

    const total = countResult[0]?.count || 0

    return NextResponse.json({
      conversations: conversations.map(c => ({
        id: c.id,
        type: c.type,
        subject: c.subject,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        createdAt: c.createdAt,
        unreadCount: c.unreadCount || 0,
      })),
      total,
      skip,
      take,
    })
  } catch (error: any) {
    console.error('Error listing conversations:', error)
    return NextResponse.json({ error: 'Failed to list conversations' }, { status: 500 })
  }
}

// POST /api/builder/chat — Create new conversation or send message
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderId = session.builderId
    auditBuilder(builderId, session.companyName || 'Unknown', 'CREATE', 'ChatConversation').catch(() => {});
    const body = await request.json()
    const { conversationId, message, subject, category } = body

    // Case 1: Send message to existing conversation
    if (conversationId && message) {
      // Verify conversation belongs to this builder
      const convCheck: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id", "builderId" FROM "Conversation"
        WHERE "id" = $1 AND "builderId" = $2
      `, conversationId, builderId)

      if (convCheck.length === 0) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }

      const onCallStaffId = await pickOnCallStaffId()
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
        const convSubject: any[] = await prisma.$queryRawUnsafe(`
          SELECT "subject" FROM "Conversation" WHERE "id" = $1
        `, conversationId)
        const subject = convSubject[0]?.subject || 'New message'

        await createNotification({
          staffId: participant.staffId,
          type: 'MESSAGE',
          title: 'New builder message',
          message: `${session.companyName}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
          link: `/staff/chat/${conversationId}`,
        })
      }

      return NextResponse.json({
        success: true,
        messageId,
        conversationId,
      })
    }

    // Case 2: Create new conversation + first message
    if (subject && message) {
      const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const now = new Date()

      const onCallStaffId = await pickOnCallStaffId()
      if (!onCallStaffId) {
        return NextResponse.json({ error: 'No on-call staff available' }, { status: 503 })
      }

      // Create conversation (createdById is NOT NULL → stamp on-call staff)
      const preview = message.length > 100 ? message.substring(0, 100) + '...' : message
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Conversation" (
          "id", "type", "subject", "builderId", "createdById", "lastMessageAt", "lastMessagePreview", "createdAt", "updatedAt"
        ) VALUES ($1, $2::"ConversationType", $3, $4, $5, $6, $7, $8, $9)
      `, conversationId, 'BUILDER_SUPPORT', subject, builderId, onCallStaffId, now, preview, now, now)

      // Create first message (senderId is NOT NULL → stamp on-call staff)
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Message" (
          "id", "conversationId", "senderId", "builderSenderId", "senderType", "body", "readBy", "readByBuilder", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], true, $8)
      `, messageId, conversationId, onCallStaffId, builderId, 'BUILDER', message, [], now)

      // Auto-assign staff participants from SALES, EXECUTIVE, OPERATIONS
      const staffToAdd: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id"
        FROM "Staff"
        WHERE "department"::text IN ('SALES', 'EXECUTIVE', 'OPERATIONS') AND "active" = true
        LIMIT 20
      `)

      for (const staff of staffToAdd) {
        const participantId = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(`
          INSERT INTO "ConversationParticipant" (
            "id", "conversationId", "staffId", "joinedAt"
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT ("conversationId", "staffId") DO NOTHING
        `, participantId, conversationId, staff.id, now)

        // Notify staff
        await createNotification({
          staffId: staff.id,
          type: 'MESSAGE',
          title: 'New builder support request',
          message: `${session.companyName}: ${subject}`,
          link: `/staff/chat/${conversationId}`,
        })
      }

      return NextResponse.json({
        success: true,
        conversationId,
        messageId,
      })
    }

    return NextResponse.json(
      { error: 'Invalid request parameters' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('Error creating conversation/message:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}
