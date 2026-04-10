export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/actions/log
 * Log an action taken by an agent for audit trail and human oversight.
 * This is separate from the task system — it logs discrete actions agents take
 * (sending an email, updating a record, generating content, etc.)
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { agentRole, actionType, entityType, entityId, description, details, taskId } = body

    if (!agentRole || !actionType || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: agentRole, actionType, description' },
        { status: 400 }
      )
    }

    // Use the existing AuditLog table structure
    const logId = `alog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "AuditLog" (
        "id", "action", "entityType", "entityId", "userId", "details", "createdAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, NOW()
      )
    `,
      logId,
      `AGENT_${actionType}`,
      entityType || 'AgentAction',
      entityId || logId,
      `agent:${agentRole}`,
      JSON.stringify({
        agentRole,
        actionType,
        description,
        taskId: taskId || null,
        ...(details || {})
      })
    )

    return NextResponse.json({
      id: logId,
      logged: true,
      agentRole,
      actionType,
      timestamp: new Date().toISOString()
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/actions/log error:', error)
    return NextResponse.json({ error: 'Failed to log action' }, { status: 500 })
  }
}

/**
 * GET /api/agent-hub/actions/log
 * Retrieve agent action logs for oversight.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const agentRole = searchParams.get('agentRole')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const offset = (page - 1) * limit

    const conditions: string[] = [`"action" LIKE 'AGENT_%'`]
    const params: any[] = []
    let idx = 1

    if (agentRole) {
      conditions.push(`"userId" = $${idx}`)
      params.push(`agent:${agentRole}`)
      idx++
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "AuditLog" ${whereClause}`,
      ...params
    )
    const total = countResult[0]?.count || 0

    const logs: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "action", "entityType", "entityId", "userId", "details", "createdAt"
      FROM "AuditLog"
      ${whereClause}
      ORDER BY "createdAt" DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, ...params, limit, offset)

    return NextResponse.json({
      data: logs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    console.error('GET /api/agent-hub/actions/log error:', error)
    return NextResponse.json({ error: 'Failed to fetch action logs' }, { status: 500 })
  }
}
