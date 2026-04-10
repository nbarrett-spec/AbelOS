export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const VALID_MESSAGE_TYPES = ['INFO', 'REQUEST', 'ALERT', 'HANDOFF', 'REPORT', 'DIRECTIVE']
const VALID_ROLES = ['SALES', 'MARKETING', 'OPS', 'CUSTOMER_SUCCESS', 'INTEL', 'COORDINATOR', 'ADMIN']

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const toAgent = searchParams.get('toAgent')
    const fromAgent = searchParams.get('fromAgent')
    const unreadOnly = searchParams.get('unreadOnly') === 'true'
    const messageType = searchParams.get('messageType')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (toAgent) {
      conditions.push(`"toAgent" = $${idx}`)
      params.push(toAgent)
      idx++
    }
    if (fromAgent) {
      conditions.push(`"fromAgent" = $${idx}`)
      params.push(fromAgent)
      idx++
    }
    if (unreadOnly) {
      conditions.push(`"readAt" IS NULL`)
    }
    if (messageType) {
      conditions.push(`"messageType" = $${idx}`)
      params.push(messageType)
      idx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "AgentMessage" ${whereClause}`,
      ...params
    )
    const total = countResult[0]?.count || 0

    const messages: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "fromAgent", "toAgent", "messageType", "subject", "body",
             "priority", "relatedTaskId", "readAt", "respondedAt", "createdAt"
      FROM "AgentMessage"
      ${whereClause}
      ORDER BY
        CASE "priority"
          WHEN 'URGENT' THEN 0
          WHEN 'HIGH' THEN 1
          WHEN 'NORMAL' THEN 2
          WHEN 'LOW' THEN 3
        END ASC,
        "createdAt" DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, ...params, limit, offset)

    return NextResponse.json({
      data: messages,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    console.error('GET /api/agent-hub/messages error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { fromAgent, toAgent, messageType, subject, messageBody, priority, relatedTaskId } = body

    if (!fromAgent || !toAgent || !subject) {
      return NextResponse.json(
        { error: 'Missing required fields: fromAgent, toAgent, subject' },
        { status: 400 }
      )
    }
    if (!VALID_ROLES.includes(fromAgent) || !VALID_ROLES.includes(toAgent)) {
      return NextResponse.json({ error: `Invalid agent role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }
    if (messageType && !VALID_MESSAGE_TYPES.includes(messageType)) {
      return NextResponse.json({ error: `Invalid messageType. Must be one of: ${VALID_MESSAGE_TYPES.join(', ')}` }, { status: 400 })
    }

    const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "AgentMessage" (
        "id", "fromAgent", "toAgent", "messageType", "subject", "body",
        "priority", "relatedTaskId", "createdAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW()
      )
    `,
      msgId, fromAgent, toAgent, messageType || 'INFO', subject,
      messageBody ? JSON.stringify(messageBody) : null,
      priority || 'NORMAL', relatedTaskId || null
    )

    await audit(request, 'CREATE', 'AgentMessage', msgId, { fromAgent, toAgent, messageType, subject })

    const created: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentMessage" WHERE "id" = $1`, msgId
    )

    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/messages error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

// PATCH — mark message as read or responded
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { messageId, action } = body

    if (!messageId || !action) {
      return NextResponse.json({ error: 'Missing required fields: messageId, action' }, { status: 400 })
    }

    if (action === 'read') {
      await prisma.$executeRawUnsafe(`
        UPDATE "AgentMessage" SET "readAt" = NOW() WHERE "id" = $1 AND "readAt" IS NULL
      `, messageId)
    } else if (action === 'respond') {
      await prisma.$executeRawUnsafe(`
        UPDATE "AgentMessage" SET "respondedAt" = NOW(), "readAt" = COALESCE("readAt", NOW()) WHERE "id" = $1
      `, messageId)
    } else {
      return NextResponse.json({ error: 'Invalid action. Must be: read, respond' }, { status: 400 })
    }

    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentMessage" WHERE "id" = $1`, messageId
    )

    return NextResponse.json(updated[0])
  } catch (error) {
    console.error('PATCH /api/agent-hub/messages error:', error)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
