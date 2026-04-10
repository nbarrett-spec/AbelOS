export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// Ops-side messages — staff auth via cookie (no builder session needed)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get query parameters
    const { searchParams } = new URL(request.url)
    const staffId = searchParams.get('staffId')

    if (!staffId) {
      return NextResponse.json(
        { error: 'staffId query parameter is required' },
        { status: 400 }
      )
    }

    // Get conversations for the staff member with raw SQL
    const conversations = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT DISTINCT
        c.id,
        c.type,
        c.name,
        c."departmentScope",
        c."createdAt",
        c."updatedAt",
        c."lastMessageAt"
      FROM "Conversation" c
      INNER JOIN "ConversationParticipant" cp ON c.id = cp."conversationId"
      WHERE cp."staffId" = $1
      ORDER BY c."lastMessageAt" DESC NULLS LAST
      `,
      staffId
    )

    // For each conversation, fetch participants, last message, and unread count
    const conversationsWithMetadata = await Promise.all(
      conversations.map(async (conversation: any) => {
        // Get participants
        const participants = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT cp."staffId", s.id, s."firstName", s."lastName"
          FROM "ConversationParticipant" cp
          JOIN "Staff" s ON cp."staffId" = s.id
          WHERE cp."conversationId" = $1
          `,
          conversation.id
        )

        // Get last message
        const lastMessageResult = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT m.id, m.body, m."createdAt", s.id as "senderId", s."firstName", s."lastName"
          FROM "Message" m
          JOIN "Staff" s ON m."senderId" = s.id
          WHERE m."conversationId" = $1
          ORDER BY m."createdAt" DESC
          LIMIT 1
          `,
          conversation.id
        )

        const lastMessage = lastMessageResult[0]
          ? {
              id: lastMessageResult[0].id,
              body: lastMessageResult[0].body,
              createdAt: lastMessageResult[0].createdAt,
              sender: {
                id: lastMessageResult[0].senderId,
                firstName: lastMessageResult[0].firstName,
                lastName: lastMessageResult[0].lastName,
              },
            }
          : null

        // Count unread messages for this staff member
        const unreadCountResult = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT COUNT(*)::int as count
          FROM "Message"
          WHERE "conversationId" = $1
          AND NOT ("readBy" @> $2)
          `,
          conversation.id,
          JSON.stringify([staffId])
        )

        const unreadCount = unreadCountResult[0]?.count || 0

        // Get participant names
        const participantNames = participants
          .filter((p: any) => p.staffId !== staffId)
          .map((p: any) => `${p.firstName} ${p.lastName}`)
          .join(', ')

        return {
          id: conversation.id,
          type: conversation.type,
          name: conversation.name || participantNames,
          departmentScope: conversation.departmentScope,
          lastMessageAt: conversation.lastMessageAt,
          unreadCount,
          lastMessage,
          participantCount: participants.length,
        }
      })
    )

    return NextResponse.json({
      conversations: conversationsWithMetadata,
    })
  } catch (error) {
    console.error('Failed to fetch conversations:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      type,
      name,
      participantIds,
      departmentScope,
      createdById,
    } = body

    // Validate required fields
    if (!type || !participantIds || !createdById) {
      return NextResponse.json(
        {
          error: 'Missing required fields: type, participantIds, createdById',
        },
        { status: 400 }
      )
    }

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return NextResponse.json(
        { error: 'participantIds must be a non-empty array' },
        { status: 400 }
      )
    }

    const validTypes = ['DIRECT', 'GROUP', 'CHANNEL', 'DEPARTMENT']
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        {
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Ensure createdById is in participantIds
    const allParticipantIds = Array.from(new Set([...participantIds, createdById]))

    // Verify all participants exist with raw SQL
    const existingParticipants = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Staff"
      WHERE id = ANY($1)
      `,
      allParticipantIds
    )

    if (existingParticipants.length !== allParticipantIds.length) {
      return NextResponse.json(
        { error: 'One or more participant IDs do not exist' },
        { status: 400 }
      )
    }

    // Generate conversation ID
    const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
    const now = new Date()

    // Create the conversation with raw SQL
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Conversation" (id, type, name, "departmentScope", "createdById", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      conversationId,
      type,
      name || null,
      departmentScope || null,
      createdById,
      now,
      now
    )

    // Create participant entries
    for (const participantId of allParticipantIds) {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "ConversationParticipant" ("conversationId", "staffId", "createdAt")
        VALUES ($1, $2, $3)
        `,
        conversationId,
        participantId,
        now
      )
    }

    // Fetch the created conversation with participants
    const convResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, type, name, "departmentScope", "createdAt"
      FROM "Conversation"
      WHERE id = $1
      `,
      conversationId
    )

    const conversation = convResult[0]

    // Fetch participants
    const participants = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT cp."staffId", s."firstName", s."lastName"
      FROM "ConversationParticipant" cp
      JOIN "Staff" s ON cp."staffId" = s.id
      WHERE cp."conversationId" = $1
      `,
      conversationId
    )

    return NextResponse.json(
      {
        conversation: {
          id: conversation.id,
          type: conversation.type,
          name: conversation.name,
          departmentScope: conversation.departmentScope,
          createdAt: conversation.createdAt,
          participants: participants.map((p: any) => ({
            staffId: p.staffId,
            staff: {
              firstName: p.firstName,
              lastName: p.lastName,
            },
          })),
        },
        message: 'Conversation created successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Failed to create conversation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
