export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/churn/intervene
 * Generate and queue a reactivation intervention for an at-risk builder.
 * Creates an outreach sequence + approval task.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, interventionType } = body

    if (!builderId) {
      return NextResponse.json({ error: 'Missing builderId' }, { status: 400 })
    }

    // Get builder + intelligence
    const builders: any[] = await prisma.$queryRawUnsafe(`
      SELECT b."id", b."companyName", b."contactName", b."email",
             bi."healthScore", bi."orderTrend", bi."totalLifetimeValue",
             bi."avgOrderValue", bi."daysSinceLastOrder", bi."topProductCategories",
             bi."crossSellScore"
      FROM "Builder" b
      LEFT JOIN "BuilderIntelligence" bi ON bi."builderId" = b."id"
      WHERE b."id" = $1
    `, builderId)

    if (builders.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const builder = builders[0]
    const ltv = Number(builder.totalLifetimeValue) || 0
    const avgOrder = Number(builder.avgOrderValue) || 0
    const type = interventionType || (ltv > 50000 ? 'VIP_WINBACK' : ltv > 10000 ? 'LOYALTY_OFFER' : 'CHECK_IN')

    // Generate templates based on intervention type
    let steps: any[] = []

    if (type === 'VIP_WINBACK') {
      steps = [
        {
          channel: 'EMAIL', delayDays: 0, name: 'VIP Win-Back',
          subject: `${builder.contactName || builder.companyName} — a personal note from Abel Lumber`,
          body: `Hi ${builder.contactName || 'there'},\n\nI wanted to reach out personally. ${builder.companyName} has been one of our most valued partners — over $${Math.round(ltv).toLocaleString()} in business together — and I noticed it's been a while since your last order.\n\nI'd love to hear how things are going and whether there's anything we could be doing better. As a thank you for your loyalty, I'd like to offer 10% off your next order.\n\nWould you have time for a quick call this week?\n\nBest regards,\nNate Barrett\nAbel Lumber`,
        },
        {
          channel: 'EMAIL', delayDays: 4, name: 'VIP Follow-Up',
          subject: `Following up — your Abel Lumber partnership`,
          body: `Hi ${builder.contactName || 'there'},\n\nJust following up on my note. We've also recently added some new products${builder.topProductCategories ? ' in categories you work with' : ''} that I think could save you time and money.\n\nLet me know if you'd like me to put together a quote for your next project. The 10% loyalty discount is still on the table.\n\nBest,\nAbel Lumber Team`,
        },
      ]
    } else if (type === 'LOYALTY_OFFER') {
      steps = [
        {
          channel: 'EMAIL', delayDays: 0, name: 'Loyalty Re-engagement',
          subject: `We have something for ${builder.companyName}`,
          body: `Hi ${builder.contactName || 'there'},\n\nWe miss working with ${builder.companyName}! As a valued builder partner, we'd like to offer you preferred pricing on your next order.\n\nWhether you have an upcoming project or just need to restock, we're ready to help. Your typical order runs around $${Math.round(avgOrder).toLocaleString()} — and with our loyalty pricing, you'll save even more.\n\nAny projects on the horizon?\n\nBest,\nAbel Lumber Team`,
        },
        {
          channel: 'EMAIL', delayDays: 5, name: 'Loyalty Follow-Up',
          subject: `Quick check-in from Abel Lumber`,
          body: `Hi ${builder.contactName || 'there'},\n\nJust a friendly follow-up. We're here when you need us — and the loyalty offer stands.\n\nBest,\nAbel Lumber Team`,
        },
      ]
    } else {
      steps = [
        {
          channel: 'EMAIL', delayDays: 0, name: 'Friendly Check-In',
          subject: `Checking in from Abel Lumber`,
          body: `Hi ${builder.contactName || 'there'},\n\nIt's been a while and I wanted to check in. How are things going with ${builder.companyName}?\n\nIf you have any upcoming projects where you'll need doors, trim, or hardware, we'd love to help. Just reply to this email or give us a call.\n\nBest,\nAbel Lumber Team`,
        },
      ]
    }

    // Create the outreach sequence
    const seqId = `seq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(`
      INSERT INTO "OutreachSequence" (
        "id", "name", "targetType", "targetId", "builderId",
        "status", "currentStep", "totalSteps", "startedAt",
        "metadata", "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'BUILDER', $3, $3, 'ACTIVE', 0, $4, NOW(), $5::jsonb, NOW(), NOW())
    `,
      seqId,
      `Reactivation: ${builder.companyName} (${type})`,
      builderId,
      steps.length,
      JSON.stringify({ interventionType: type, healthScore: Number(builder.healthScore), ltv })
    )

    // Create steps
    const now = new Date()
    for (let i = 0; i < steps.length; i++) {
      const stepId = `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${i}`
      const scheduledFor = new Date(now)
      scheduledFor.setDate(scheduledFor.getDate() + (steps[i].delayDays || 0))

      await prisma.$executeRawUnsafe(`
        INSERT INTO "OutreachStep" (
          "id", "sequenceId", "stepNumber", "channel", "subject", "body",
          "templateUsed", "delayDays", "scheduledFor", "status", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      `,
        stepId, seqId, i + 1, steps[i].channel,
        steps[i].subject, steps[i].body, steps[i].name,
        steps[i].delayDays, scheduledFor,
        i === 0 ? 'READY' : 'PENDING'
      )
    }

    // Create approval task
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(`
      INSERT INTO "AgentTask" (
        "id", "agentRole", "taskType", "title", "description",
        "priority", "status", "payload", "requiresApproval",
        "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'SALES', 'SEND_OUTREACH', $2, $3,
        $4, 'PENDING', $5::jsonb, true,
        'agent:SALES', NOW(), NOW()
      )
    `,
      taskId,
      `Reactivation: ${builder.companyName}`,
      `${type} intervention for ${builder.companyName}. Health score: ${Number(builder.healthScore) || 'N/A'}/100, LTV: $${Math.round(ltv).toLocaleString()}, ${Number(builder.daysSinceLastOrder) || '?'} days since last order.`,
      ltv > 50000 ? 'HIGH' : 'NORMAL',
      JSON.stringify({ sequenceId: seqId, builderId, interventionType: type, ltv })
    )

    return NextResponse.json({
      sequenceId: seqId,
      interventionType: type,
      builder: { id: builderId, companyName: builder.companyName, contactName: builder.contactName },
      steps: steps.length,
      status: 'AWAITING_APPROVAL',
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/churn/intervene error:', error)
    return NextResponse.json({ error: 'Failed to create intervention' }, { status: 500 })
  }
}
