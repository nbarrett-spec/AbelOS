export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const VALID_ROLES = ['SALES', 'MARKETING', 'OPS', 'CUSTOMER_SUCCESS', 'INTEL', 'COORDINATOR']
const VALID_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW']
const VALID_STATUSES = ['PENDING', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED']
const VALID_TASK_TYPES = [
  'PROSPECT_RESEARCH', 'SEND_OUTREACH', 'FOLLOW_UP', 'DEAL_UPDATE',
  'GENERATE_CONTENT', 'SEO_AUDIT', 'CAMPAIGN_LAUNCH', 'SOCIAL_POST',
  'SCHEDULE_DELIVERY', 'SEND_REMINDER', 'COLLECTION_ACTION', 'INVENTORY_CHECK', 'AUTO_PO',
  'BUILDER_CHECKIN', 'SEND_NOTIFICATION', 'HANDLE_COMPLAINT', 'NPS_SURVEY',
  'ANALYZE_DATA', 'REFRESH_INTELLIGENCE', 'GENERATE_REPORT', 'PERMIT_RESEARCH',
  'DAILY_BRIEF', 'APPROVE_ACTION', 'REASSIGN_TASK', 'SYSTEM_MAINTENANCE',
  'CUSTOM'
]

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const role = searchParams.get('role')
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const taskType = searchParams.get('taskType')
    const assignedTo = searchParams.get('assignedTo')
    const createdBy = searchParams.get('createdBy')
    const requiresApproval = searchParams.get('requiresApproval')
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (role) {
      conditions.push(`"agentRole" = $${idx}`)
      params.push(role)
      idx++
    }
    if (status) {
      conditions.push(`"status" = $${idx}`)
      params.push(status)
      idx++
    }
    if (priority) {
      conditions.push(`"priority" = $${idx}`)
      params.push(priority)
      idx++
    }
    if (taskType) {
      conditions.push(`"taskType" = $${idx}`)
      params.push(taskType)
      idx++
    }
    if (assignedTo) {
      conditions.push(`"assignedTo" = $${idx}`)
      params.push(assignedTo)
      idx++
    }
    if (createdBy) {
      conditions.push(`"createdBy" = $${idx}`)
      params.push(createdBy)
      idx++
    }
    if (requiresApproval === 'true') {
      conditions.push(`"requiresApproval" = true AND "status" = 'PENDING'`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "AgentTask" ${whereClause}`,
      ...params
    )
    const total = countResult[0]?.count || 0

    // Get tasks with ordering: URGENT first, then by creation time
    const tasks: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "agentRole", "taskType", "priority", "status", "title", "description",
             "payload", "result", "createdBy", "assignedTo", "parentTaskId",
             "requiresApproval", "approvedBy", "approvedAt",
             "claimedAt", "completedAt", "failedAt", "failReason", "dueBy",
             "createdAt", "updatedAt"
      FROM "AgentTask"
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
      data: tasks,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    console.error('GET /api/agent-hub/tasks error:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      agentRole, taskType, priority, title, description,
      payload, createdBy, assignedTo, parentTaskId,
      requiresApproval, dueBy
    } = body

    // Validate required fields
    if (!agentRole || !taskType || !title || !createdBy) {
      return NextResponse.json(
        { error: 'Missing required fields: agentRole, taskType, title, createdBy' },
        { status: 400 }
      )
    }
    if (!VALID_ROLES.includes(agentRole)) {
      return NextResponse.json({ error: `Invalid agentRole. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }
    if (!VALID_TASK_TYPES.includes(taskType)) {
      return NextResponse.json({ error: `Invalid taskType. Must be one of: ${VALID_TASK_TYPES.join(', ')}` }, { status: 400 })
    }

    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const taskPriority = priority && VALID_PRIORITIES.includes(priority) ? priority : 'NORMAL'

    await prisma.$executeRawUnsafe(`
      INSERT INTO "AgentTask" (
        "id", "agentRole", "taskType", "priority", "status", "title", "description",
        "payload", "createdBy", "assignedTo", "parentTaskId",
        "requiresApproval", "dueBy", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, 'PENDING', $5, $6,
        $7::jsonb, $8, $9, $10,
        $11, $12, NOW(), NOW()
      )
    `,
      taskId, agentRole, taskType, taskPriority, title, description || null,
      payload ? JSON.stringify(payload) : null, createdBy, assignedTo || agentRole, parentTaskId || null,
      requiresApproval || false, dueBy ? new Date(dueBy) : null
    )

    await audit(request, 'CREATE', 'AgentTask', taskId, {
      agentRole, taskType, priority: taskPriority, title, createdBy, assignedTo
    })

    const created: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AgentTask" WHERE "id" = $1`, taskId
    )

    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/tasks error:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
