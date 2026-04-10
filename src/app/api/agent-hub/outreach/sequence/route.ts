export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/outreach/sequence
 * Create a multi-touch outreach sequence.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, targetType, targetId, builderId, dealId, permitLeadId, steps } = body

    if (!targetId || !steps || steps.length === 0) {
      return NextResponse.json({ error: 'Missing targetId and steps' }, { status: 400 })
    }

    const seqId = `seq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "OutreachSequence" (
        "id", "name", "targetType", "targetId", "builderId", "dealId", "permitLeadId",
        "status", "currentStep", "totalSteps", "startedAt", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 0, $8, NOW(), NOW(), NOW())
    `,
      seqId,
      name || `Outreach — ${targetType} — ${targetId}`,
      targetType || 'DEAL',
      targetId,
      builderId || null,
      dealId || null,
      permitLeadId || null,
      steps.length
    )

    // Create each step
    const createdSteps: any[] = []
    const now = new Date()

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const stepId = `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${i}`
      const scheduledFor = new Date(now)
      scheduledFor.setDate(scheduledFor.getDate() + (step.delayDays || 0))

      await prisma.$executeRawUnsafe(`
        INSERT INTO "OutreachStep" (
          "id", "sequenceId", "stepNumber", "channel", "subject", "body",
          "templateUsed", "delayDays", "scheduledFor", "status", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      `,
        stepId,
        seqId,
        i + 1,
        step.channel || 'EMAIL',
        step.subject || null,
        step.body || null,
        step.templateUsed || step.name || null,
        step.delayDays || 0,
        scheduledFor,
        i === 0 ? 'READY' : 'PENDING'
      )

      createdSteps.push({ id: stepId, stepNumber: i + 1, scheduledFor, status: i === 0 ? 'READY' : 'PENDING' })
    }

    // Create an approval task for the first step
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AgentTask" (
          "id", "agentRole", "taskType", "title", "description",
          "priority", "status", "payload", "requiresApproval",
          "createdBy", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'SALES', 'SEND_OUTREACH', $2, $3,
          'NORMAL', 'PENDING', $4::jsonb, true,
          'agent:SALES', NOW(), NOW()
        )
      `,
        taskId,
        `Approve Outreach: ${name || targetId}`,
        `${steps.length}-step outreach sequence ready for approval. First touch scheduled now.`,
        JSON.stringify({ sequenceId: seqId, targetType, targetId, steps: createdSteps })
      )
    } catch (e) {
      console.error('Failed to create outreach approval task:', e)
    }

    return NextResponse.json({
      id: seqId,
      name: name || `Outreach — ${targetType} — ${targetId}`,
      totalSteps: steps.length,
      steps: createdSteps,
      status: 'ACTIVE',
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/outreach/sequence error:', error)
    return NextResponse.json({ error: 'Failed to create outreach sequence' }, { status: 500 })
  }
}

/**
 * GET /api/agent-hub/outreach/sequence
 * List outreach sequences with stats.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get('status')

    let where = ''
    const params: any[] = []
    if (status) { where = `WHERE os."status"::text = $1`; params.push(status) }

    const sequences: any[] = await prisma.$queryRawUnsafe(`
      SELECT os.*,
        (SELECT COUNT(*)::int FROM "OutreachStep" WHERE "sequenceId" = os."id") AS "totalSteps",
        (SELECT COUNT(*)::int FROM "OutreachStep" WHERE "sequenceId" = os."id" AND "sentAt" IS NOT NULL) AS "stepsSent",
        (SELECT COUNT(*)::int FROM "OutreachStep" WHERE "sequenceId" = os."id" AND "openedAt" IS NOT NULL) AS "opens",
        (SELECT COUNT(*)::int FROM "OutreachStep" WHERE "sequenceId" = os."id" AND "repliedAt" IS NOT NULL) AS "replies"
      FROM "OutreachSequence" os
      ${where}
      ORDER BY os."createdAt" DESC
      LIMIT 50
    `, ...params)

    return NextResponse.json({ data: sequences, total: sequences.length })
  } catch (error) {
    console.error('GET /api/agent-hub/outreach/sequence error:', error)
    return NextResponse.json({ error: 'Failed to fetch sequences' }, { status: 500 })
  }
}
