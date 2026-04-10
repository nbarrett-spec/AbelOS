export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get all agent sessions
    const sessions: any[] = await prisma.$queryRawUnsafe(`
      SELECT s."id", s."agentRole", s."status", s."currentTaskId",
             s."lastHeartbeat", s."tasksCompletedToday", s."tasksFailedToday",
             s."errorsToday", s."startedAt", s."metadata",
             t."title" AS "currentTaskTitle", t."taskType" AS "currentTaskType"
      FROM "AgentSession" s
      LEFT JOIN "AgentTask" t ON t."id" = s."currentTaskId"
      ORDER BY s."agentRole" ASC
    `)

    // Mark agents as OFFLINE if no heartbeat in 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    await prisma.$executeRawUnsafe(`
      UPDATE "AgentSession"
      SET "status" = 'OFFLINE', "updatedAt" = NOW()
      WHERE "lastHeartbeat" < $1 AND "status" != 'OFFLINE'
    `, fiveMinutesAgo)

    // Task queue summary
    const taskSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT "status", COUNT(*)::int AS count
      FROM "AgentTask"
      WHERE "createdAt" >= CURRENT_DATE
      GROUP BY "status"
    `)

    // Tasks by priority (pending only)
    const pendingByPriority: any[] = await prisma.$queryRawUnsafe(`
      SELECT "priority", COUNT(*)::int AS count
      FROM "AgentTask"
      WHERE "status" = 'PENDING'
      GROUP BY "priority"
    `)

    // Tasks requiring approval
    const awaitingApproval: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "agentRole", "taskType", "title", "priority", "createdBy", "createdAt"
      FROM "AgentTask"
      WHERE "requiresApproval" = true AND "approvedAt" IS NULL AND "status" = 'PENDING'
      ORDER BY
        CASE "priority"
          WHEN 'URGENT' THEN 0
          WHEN 'HIGH' THEN 1
          WHEN 'NORMAL' THEN 2
          WHEN 'LOW' THEN 3
        END ASC,
        "createdAt" ASC
    `)

    // Recent completed tasks (last 20)
    const recentCompleted: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "agentRole", "taskType", "title", "completedAt", "result"
      FROM "AgentTask"
      WHERE "status" = 'COMPLETED'
      ORDER BY "completedAt" DESC
      LIMIT 20
    `)

    // Recent failures
    const recentFailures: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "agentRole", "taskType", "title", "failedAt", "failReason"
      FROM "AgentTask"
      WHERE "status" = 'FAILED' AND "failedAt" >= CURRENT_DATE
      ORDER BY "failedAt" DESC
      LIMIT 10
    `)

    // Unread message counts per agent
    const unreadCounts: any[] = await prisma.$queryRawUnsafe(`
      SELECT "toAgent", COUNT(*)::int AS count
      FROM "AgentMessage"
      WHERE "readAt" IS NULL
      GROUP BY "toAgent"
    `)
    const unreadMap: Record<string, number> = {}
    for (const u of unreadCounts) {
      unreadMap[u.toAgent] = u.count
    }

    // Total tasks completed today across all agents
    const totalCompletedToday: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "AgentTask"
      WHERE "status" = 'COMPLETED' AND "completedAt" >= CURRENT_DATE
    `)

    return NextResponse.json({
      agents: sessions.map(s => ({
        ...s,
        unreadMessages: unreadMap[s.agentRole] || 0,
        isStale: s.lastHeartbeat && new Date(s.lastHeartbeat) < fiveMinutesAgo
      })),
      taskQueue: {
        summary: taskSummary,
        pendingByPriority,
        awaitingApproval,
        awaitingApprovalCount: awaitingApproval.length,
        totalCompletedToday: totalCompletedToday[0]?.count || 0
      },
      recentActivity: {
        completed: recentCompleted,
        failures: recentFailures
      },
      serverTime: new Date().toISOString()
    })
  } catch (error) {
    console.error('GET /api/agent-hub/status error:', error)
    return NextResponse.json({ error: 'Failed to fetch agent status' }, { status: 500 })
  }
}
