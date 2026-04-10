export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET single task details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const task: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentTask" WHERE "id" = $1`, params.id
    )

    if (!task || task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Also get subtasks
    const subtasks: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "taskType", "status", "title", "priority", "assignedTo", "createdAt"
       FROM "AgentTask" WHERE "parentTaskId" = $1
       ORDER BY "createdAt" ASC`, params.id
    )

    // Get related messages
    const messages: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentMessage" WHERE "relatedTaskId" = $1
       ORDER BY "createdAt" ASC`, params.id
    )

    return NextResponse.json({
      ...task[0],
      subtasks,
      messages
    })
  } catch (error) {
    console.error('GET /api/agent-hub/tasks/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 })
  }
}

// PATCH — claim, complete, fail, approve, cancel a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action, result, failReason, approvedBy, agentRole } = body

    // Verify task exists
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentTask" WHERE "id" = $1`, params.id
    )
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const task = existing[0]

    switch (action) {
      case 'claim': {
        if (task.status !== 'PENDING') {
          return NextResponse.json({ error: 'Task is not in PENDING status' }, { status: 400 })
        }
        if (task.requiresApproval && !task.approvedAt) {
          return NextResponse.json({ error: 'Task requires approval before claiming' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentTask"
          SET "status" = 'CLAIMED', "claimedAt" = NOW(), "assignedTo" = $2, "updatedAt" = NOW()
          WHERE "id" = $1
        `, params.id, agentRole || task.assignedTo)

        // Update agent session
        if (agentRole) {
          await prisma.$executeRawUnsafe(`
            UPDATE "AgentSession"
            SET "status" = 'BUSY', "currentTaskId" = $2, "updatedAt" = NOW()
            WHERE "agentRole" = $1
          `, agentRole, params.id)
        }
        break
      }

      case 'start': {
        if (task.status !== 'CLAIMED') {
          return NextResponse.json({ error: 'Task must be CLAIMED before starting' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentTask"
          SET "status" = 'IN_PROGRESS', "updatedAt" = NOW()
          WHERE "id" = $1
        `, params.id)
        break
      }

      case 'complete': {
        if (!['CLAIMED', 'IN_PROGRESS'].includes(task.status)) {
          return NextResponse.json({ error: 'Task must be CLAIMED or IN_PROGRESS to complete' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentTask"
          SET "status" = 'COMPLETED', "completedAt" = NOW(), "result" = $2::jsonb, "updatedAt" = NOW()
          WHERE "id" = $1
        `, params.id, result ? JSON.stringify(result) : null)

        // Update agent session
        const assignedRole = task.assignedTo
        if (assignedRole) {
          await prisma.$executeRawUnsafe(`
            UPDATE "AgentSession"
            SET "status" = 'IDLE', "currentTaskId" = NULL,
                "tasksCompletedToday" = "tasksCompletedToday" + 1, "updatedAt" = NOW()
            WHERE "agentRole" = $1
          `, assignedRole)
        }
        break
      }

      case 'fail': {
        if (!['CLAIMED', 'IN_PROGRESS'].includes(task.status)) {
          return NextResponse.json({ error: 'Task must be CLAIMED or IN_PROGRESS to fail' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentTask"
          SET "status" = 'FAILED', "failedAt" = NOW(), "failReason" = $2, "updatedAt" = NOW()
          WHERE "id" = $1
        `, params.id, failReason || 'No reason provided')

        // Update agent session
        const failedRole = task.assignedTo
        if (failedRole) {
          await prisma.$executeRawUnsafe(`
            UPDATE "AgentSession"
            SET "status" = 'IDLE', "currentTaskId" = NULL,
                "tasksFailedToday" = "tasksFailedToday" + 1,
                "errorsToday" = "errorsToday" + 1, "updatedAt" = NOW()
            WHERE "agentRole" = $1
          `, failedRole)
        }
        break
      }

      case 'approve': {
        if (!task.requiresApproval) {
          return NextResponse.json({ error: 'Task does not require approval' }, { status: 400 })
        }
        if (task.approvedAt) {
          return NextResponse.json({ error: 'Task already approved' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentTask"
          SET "approvedBy" = $2, "approvedAt" = NOW(), "updatedAt" = NOW()
          WHERE "id" = $1
        `, params.id, approvedBy || 'ADMIN')
        break
      }

      case 'cancel': {
        if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
          return NextResponse.json({ error: 'Cannot cancel a completed or already cancelled task' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentTask"
          SET "status" = 'CANCELLED', "updatedAt" = NOW()
          WHERE "id" = $1
        `, params.id)

        // Free up agent if it was working on this
        if (task.assignedTo && ['CLAIMED', 'IN_PROGRESS'].includes(task.status)) {
          await prisma.$executeRawUnsafe(`
            UPDATE "AgentSession"
            SET "status" = 'IDLE', "currentTaskId" = NULL, "updatedAt" = NOW()
            WHERE "agentRole" = $1 AND "currentTaskId" = $2
          `, task.assignedTo, params.id)
        }
        break
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be one of: claim, start, complete, fail, approve, cancel' },
          { status: 400 }
        )
    }

    await audit(request, 'UPDATE', 'AgentTask', params.id, { action, agentRole })

    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentTask" WHERE "id" = $1`, params.id
    )

    return NextResponse.json(updated[0])
  } catch (error) {
    console.error('PATCH /api/agent-hub/tasks/[id] error:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}
