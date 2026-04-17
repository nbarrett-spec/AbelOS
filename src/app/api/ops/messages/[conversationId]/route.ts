export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface RouteParams {
  params: {
    conversationId: string
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const staffId = searchParams.get('staffId')
    const skip = parseInt(searchParams.get('skip') || '0', 10)
    const take = parseInt(searchParams.get('take') || '50', 10)

    if (!staffId) {
      return NextResponse.json(
        { error: 'staffId query parameter is required' },
        { status: 400 }
      )
    }

    const { conversationId } = params

    // Verify staff member is a participant with raw SQL
    const participantResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT * FROM "ConversationParticipant"
      WHERE "conversationId" = $1 AND "staffId" = $2
      `,
      conversationId,
      staffId
    )

    if (participantResult.length === 0) {
      return NextResponse.json(
        { error: 'Access denied. Not a participant in this conversation.' },
        { status: 403 }
      )
    }

    // Get messages with pagination
    const messages = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        m.id,
        m.body,
        m."createdAt",
        m."readBy",
        s.id as "senderId",
        s."firstName",
        s."lastName",
        s.role,
        s.department,
        s.avatar
      FROM "Message" m
      JOIN "Staff" s ON m."senderId" = s.id
      WHERE m."conversationId" = $1
      ORDER BY m."createdAt" ASC
      OFFSET $2
      LIMIT $3
      `,
      conversationId,
      skip,
      take
    )

    // Mark messages as read for this staff member
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Message"
      SET "readBy" = (
        CASE
          WHEN "readBy" @> $2::jsonb THEN "readBy"
          ELSE "readBy" || $2::jsonb
        END
      )
      WHERE "conversationId" = $1 AND NOT ("readBy" @> $2::jsonb)
      `,
      conversationId,
      JSON.stringify([staffId])
    )

    // Update lastReadAt for the participant
    await prisma.$executeRawUnsafe(
      `
      UPDATE "ConversationParticipant"
      SET "lastReadAt" = $3
      WHERE "conversationId" = $1 AND "staffId" = $2
      `,
      conversationId,
      staffId,
      new Date()
    )

    // Get total message count
    const countResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT COUNT(*)::int as count FROM "Message"
      WHERE "conversationId" = $1
      `,
      conversationId
    )

    const totalCount = countResult[0]?.count || 0

    // Map messages to response format
    const mappedMessages = messages.map((m: any) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      readBy: m.readBy || [],
      sender: {
        id: m.senderId,
        firstName: m.firstName,
        lastName: m.lastName,
        role: m.role,
        department: m.department,
        avatar: m.avatar,
      },
    }))

    return NextResponse.json({
      messages: mappedMessages,
      pagination: {
        skip,
        take,
        total: totalCount,
      },
    })
  } catch (error) {
    console.error('Failed to fetch messages:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Message', undefined, { method: 'POST' }).catch(() => {})

    const { conversationId } = params
    const body = await request.json()
    const { senderId, body: messageBody } = body

    // Validate required fields
    if (!senderId || !messageBody) {
      return NextResponse.json(
        { error: 'Missing required fields: senderId, body' },
        { status: 400 }
      )
    }

    // Verify sender is a participant with raw SQL
    const participantResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT * FROM "ConversationParticipant"
      WHERE "conversationId" = $1 AND "staffId" = $2
      `,
      conversationId,
      senderId
    )

    if (participantResult.length === 0) {
      return NextResponse.json(
        { error: 'Access denied. Not a participant in this conversation.' },
        { status: 403 }
      )
    }

    // Verify conversation exists
    const conversationResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Conversation"
      WHERE id = $1
      `,
      conversationId
    )

    if (conversationResult.length === 0) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // Get all participants
    const participants = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT "staffId" FROM "ConversationParticipant"
      WHERE "conversationId" = $1
      `,
      conversationId
    )

    // Generate message ID
    const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
    const now = new Date()

    // Create the message with raw SQL
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Message" (id, "conversationId", "senderId", body, "readBy", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      messageId,
      conversationId,
      senderId,
      messageBody,
      JSON.stringify([senderId]),
      now
    )

    // Update conversation lastMessageAt
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Conversation"
      SET "lastMessageAt" = $2
      WHERE id = $1
      `,
      conversationId,
      now
    )

    // Fetch the created message
    const messageResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        m.id,
        m.body,
        m."createdAt",
        m."readBy",
        s.id as "senderId",
        s."firstName",
        s."lastName",
        s.role,
        s.department,
        s.avatar
      FROM "Message" m
      JOIN "Staff" s ON m."senderId" = s.id
      WHERE m.id = $1
      `,
      messageId
    )

    const msgRow = messageResult[0]
    const message = msgRow
      ? {
          id: msgRow.id,
          body: msgRow.body,
          createdAt: msgRow.createdAt,
          readBy: msgRow.readBy || [senderId],
          sender: {
            id: msgRow.senderId,
            firstName: msgRow.firstName,
            lastName: msgRow.lastName,
            role: msgRow.role,
            department: msgRow.department,
            avatar: msgRow.avatar,
          },
        }
      : null

    // Create notifications for other participants
    const otherParticipants = participants
      .map((p: any) => p.staffId)
      .filter((id: string) => id !== senderId)

    if (otherParticipants.length > 0) {
      const senderResult = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT "firstName", "lastName" FROM "Staff"
        WHERE id = $1
        `,
        senderId
      )

      const sender = senderResult[0]
      const senderName = sender
        ? `${sender.firstName} ${sender.lastName}`
        : 'Unknown'

      // Create notification entries
      for (const staffId of otherParticipants) {
        const notificationId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`

        try {
          await prisma.$executeRawUnsafe(
            `
            INSERT INTO "Notification" (id, "staffId", type, title, body, link, "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            notificationId,
            staffId,
            'MESSAGE',
            `New message from ${senderName}`,
            messageBody.substring(0, 100),
            `/messages/${conversationId}`,
            now
          )
        } catch (notifError) {
          console.error('Failed to create notification:', notifError)
        }
      }
    }

    return NextResponse.json(
      {
        message,
        messageCount: 'Message created and notifications sent',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Failed to send message:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
