export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/builder-chat
//
// GET  — List all builder support conversations
//   - Query params: status (open/closed), builderId, search
//   - Includes: last message preview, unread count, participant count
//   - Sorted by lastMessageAt DESC
//
// POST — Staff reply to a builder conversation
//   - Body: { conversationId, staffId, message }
//   - Creates message, updates conversation state
//   - Audits the message creation
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')?.toLowerCase() // open, closed, or null
    const builderId = searchParams.get('builderId')
    const search = searchParams.get('search')
    const requestingStaffId = searchParams.get('staffId')

    // Build WHERE conditions
    const conditions: string[] = ['c."type" = $1']
    const params: any[] = ['BUILDER_SUPPORT']
    let paramIdx = 2

    // Filter by builderId if provided
    if (builderId) {
      conditions.push(`c."builderId" = $${paramIdx}`)
      params.push(builderId)
      paramIdx++
    }

    // Filter by status (open = has unread builder messages, closed = no unread)
    if (status === 'open' && requestingStaffId) {
      // Status = open means there are unread builder messages for this staff
      conditions.push(`
        EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m."senderType" = 'BUILDER'
            AND NOT ($${paramIdx}::text = ANY(m."readBy"))
        )
      `)
      params.push(requestingStaffId)
      paramIdx++
    } else if (status === 'closed' && requestingStaffId) {
      // Status = closed means NO unread builder messages for this staff
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m."senderType" = 'BUILDER'
            AND NOT ($${paramIdx}::text = ANY(m."readBy"))
        )
      `)
      params.push(requestingStaffId)
      paramIdx++
    }

    // Filter by builder company name or conversation subject (search)
    if (search) {
      conditions.push(
        `(b."companyName" ILIKE $${paramIdx} OR c."subject" ILIKE $${paramIdx})`
      )
      params.push(`%${search}%`)
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    // Main query: conversations with builder info and metrics
    const conversations = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        c.id,
        c."builderId",
        c."subject",
        c."type",
        c."lastMessageAt",
        c."lastMessagePreview",
        b."companyName",
        b."contactName",
        COALESCE((SELECT COUNT(*)::int FROM "ConversationParticipant" WHERE "conversationId" = c.id), 0) as "participantCount",
        COALESCE((
          SELECT COUNT(*)::int FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m."senderType" = 'BUILDER'
            AND NOT ($${paramIdx}::text = ANY(m."readBy"))
        ), 0) as "unreadCount"
       FROM "Conversation" c
       LEFT JOIN "Builder" b ON c."builderId" = b.id
       WHERE ${whereClause}
       ORDER BY c."lastMessageAt" DESC`,
      ...params,
      requestingStaffId
    )

    return NextResponse.json({
      conversations,
      count: conversations.length,
    })
  } catch (error: any) {
    console.error('[Ops Builder Chat GET]', error?.message || error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const { conversationId, staffId, message } = body

  // Validate required fields
  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json(
      { error: 'conversationId is required and must be a string' },
      { status: 400 }
    )
  }
  if (!staffId || typeof staffId !== 'string') {
    return NextResponse.json(
      { error: 'staffId is required and must be a string' },
      { status: 400 }
    )
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json(
      { error: 'message is required and must be a non-empty string' },
      { status: 400 }
    )
  }

  try {
    // Verify conversation exists and is BUILDER_SUPPORT type
    const conversation = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "type", "builderId" FROM "Conversation" WHERE id = $1`,
      conversationId
    )

    if (!conversation || conversation.length === 0) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    if (conversation[0].type !== 'BUILDER_SUPPORT') {
      return NextResponse.json(
        { error: 'Conversation is not a BUILDER_SUPPORT type' },
        { status: 400 }
      )
    }

    // Ensure staff member is a participant — add them if not
    const existingParticipant = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "staffId" = $2`,
      conversationId,
      staffId
    )

    if (!existingParticipant || existingParticipant.length === 0) {
      // Add staff as participant
      const participantId = `cp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ConversationParticipant" (id, "conversationId", "staffId", "joinedAt") VALUES ($1, $2, $3, NOW())`,
        participantId,
        conversationId,
        staffId
      )
    }

    // Create message
    const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
    const messageTrimmed = message.trim()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Message" (id, "conversationId", "senderId", "senderType", "body", "readBy", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      messageId,
      conversationId,
      staffId,
      'STAFF',
      messageTrimmed,
      JSON.stringify([staffId]) // Mark as read by sender
    )

    // Update conversation lastMessageAt and lastMessagePreview
    const preview = messageTrimmed.length > 100
      ? messageTrimmed.substring(0, 100) + '...'
      : messageTrimmed

    await prisma.$executeRawUnsafe(
      `UPDATE "Conversation" SET "lastMessageAt" = NOW(), "lastMessagePreview" = $1, "updatedAt" = NOW() WHERE id = $2`,
      preview,
      conversationId
    )

    // Audit the message creation
    await audit(
      request,
      'CREATE',
      'Message',
      messageId,
      { conversationId }
    )

    return NextResponse.json({
      ok: true,
      messageId,
      conversationId,
      createdAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[Ops Builder Chat POST]', error?.message || error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
