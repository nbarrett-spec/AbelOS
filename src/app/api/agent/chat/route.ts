export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { processMessage } from '@/lib/agent'

// ── POST: Process a chat message ─────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // Authenticate builder
    const sessionCookie = request.cookies.get('abel_session')
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const session = await verifyToken(sessionCookie.value)
    if (!session?.builderId) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { message, conversationId } = await request.json()
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }

    // Process through shared agent pipeline
    const result = await processMessage({
      message: message.trim(),
      builderId: session.builderId,
      conversationId: conversationId || null,
      channel: 'PORTAL',
    })

    return NextResponse.json({
      conversationId: result.conversationId,
      message: result.response.text,
      intent: result.intent,
      dataRefs: result.response.dataRefs,
    })
  } catch (error: any) {
    console.error('Agent chat error:', error)
    Sentry.captureException(error, { tags: { route: '/api/agent/chat', method: 'POST' } })
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 })
  }
}

// ── GET: Fetch conversation history ──────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('abel_session')
    if (!sessionCookie) return NextResponse.json({ error: 'Auth required' }, { status: 401 })
    const session = await verifyToken(sessionCookie.value)
    if (!session?.builderId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const convId = searchParams.get('conversationId')

    if (convId) {
      // Get specific conversation messages
      const messages: any[] = await prisma.$queryRawUnsafe(`
        SELECT m.id, m.role, m.content, m.intent, m."dataRefs", m."createdAt"
        FROM "AgentMessage" m
        WHERE m."conversationId" = $1
        ORDER BY m."createdAt" ASC
      `, convId)
      return NextResponse.json({ messages })
    }

    // List recent conversations
    const conversations: any[] = await prisma.$queryRawUnsafe(`
      SELECT c.id, c.channel, c.status, c.subject, c."lastMessageAt", c."createdAt",
             (SELECT COUNT(*)::int FROM "AgentMessage" WHERE "conversationId" = c.id) as "messageCount"
      FROM "AgentConversation" c
      WHERE c."builderId" = $1
      ORDER BY c."lastMessageAt" DESC
      LIMIT 20
    `, session.builderId)

    return NextResponse.json({ conversations })
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 })
  }
}
