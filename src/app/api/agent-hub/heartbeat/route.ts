export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { agentRole, status, metadata } = body

    if (!agentRole) {
      return NextResponse.json({ error: 'Missing required field: agentRole' }, { status: 400 })
    }

    const validStatuses = ['ONLINE', 'BUSY', 'IDLE', 'OFFLINE']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
    }

    // Upsert — update heartbeat or set status
    await prisma.$executeRawUnsafe(`
      UPDATE "AgentSession"
      SET "lastHeartbeat" = NOW(),
          "status" = COALESCE($2, "status"),
          "metadata" = COALESCE($3::jsonb, "metadata"),
          "updatedAt" = NOW()
      WHERE "agentRole" = $1
    `, agentRole, status || null, metadata ? JSON.stringify(metadata) : null)

    // Fetch current session
    const session: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentSession" WHERE "agentRole" = $1`, agentRole
    )

    if (!session || session.length === 0) {
      return NextResponse.json({ error: 'Agent session not found' }, { status: 404 })
    }

    // Check for pending tasks assigned to this agent
    const pendingTasks: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "taskType", "priority", "title", "dueBy"
      FROM "AgentTask"
      WHERE "assignedTo" = $1 AND "status" = 'PENDING'
      ORDER BY
        CASE "priority"
          WHEN 'URGENT' THEN 0
          WHEN 'HIGH' THEN 1
          WHEN 'NORMAL' THEN 2
          WHEN 'LOW' THEN 3
        END ASC,
        "createdAt" ASC
      LIMIT 10
    `, agentRole)

    // Check for unread messages
    const unreadMessages: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "AgentMessage"
      WHERE "toAgent" = $1 AND "readAt" IS NULL
    `, agentRole)

    return NextResponse.json({
      session: session[0],
      pendingTasks,
      unreadMessageCount: unreadMessages[0]?.count || 0,
      serverTime: new Date().toISOString()
    })
  } catch (error) {
    console.error('PATCH /api/agent-hub/heartbeat error:', error)
    return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 })
  }
}
