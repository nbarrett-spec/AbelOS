export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/seo/review-request
 * Send review request to satisfied builders after successful deliveries.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, jobId } = body

    // Get builder info
    let builderInfo: any = null
    if (builderId) {
      const builders: any[] = await prisma.$queryRawUnsafe(`
        SELECT b."id", b."companyName", b."contactName", b."email",
               bi."healthScore"
        FROM "Builder" b
        LEFT JOIN "BuilderIntelligence" bi ON bi."builderId" = b."id"
        WHERE b."id" = $1
      `, builderId)
      builderInfo = builders[0] || null
    }

    // Only request reviews from builders with good health scores
    if (builderInfo && Number(builderInfo.healthScore) < 60) {
      return NextResponse.json({
        sent: false,
        reason: 'Builder health score below threshold for review requests',
        healthScore: Number(builderInfo.healthScore),
      })
    }

    // Generate review request
    const reviewRequest = {
      to: builderInfo?.email || null,
      subject: `How was your recent experience with Abel Lumber?`,
      body: `Hi ${builderInfo?.contactName || 'there'},\n\nThank you for choosing Abel Lumber${jobId ? ' for your recent delivery' : ''}! We hope everything met your expectations.\n\nIf you had a positive experience, we'd really appreciate a quick Google review. It helps other builders find us and lets us know we're doing things right.\n\n[Leave a Review →] (Google Business link)\n\nIf there's anything we could have done better, please reply to this email — we'd love to hear from you directly.\n\nThank you for your partnership!\n\nAbel Lumber Team`,
      channel: 'EMAIL',
    }

    // Create an approval task (don't auto-send review requests)
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(`
      INSERT INTO "AgentTask" (
        "id", "agentRole", "taskType", "title", "description",
        "priority", "status", "payload", "requiresApproval",
        "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'MARKETING', 'SEND_NOTIFICATION', $2, $3,
        'LOW', 'PENDING', $4::jsonb, true,
        'agent:MARKETING', NOW(), NOW()
      )
    `,
      taskId,
      `Review Request: ${builderInfo?.companyName || 'Builder'}`,
      `Send review request to ${builderInfo?.companyName || 'builder'} (${builderInfo?.email || 'no email'})`,
      JSON.stringify({ builderId, jobId, reviewRequest })
    )

    return NextResponse.json({
      sent: false,
      awaitingApproval: true,
      taskId,
      reviewRequest,
      builder: builderInfo ? { companyName: builderInfo.companyName, email: builderInfo.email } : null,
    })
  } catch (error) {
    console.error('POST /api/agent-hub/seo/review-request error:', error)
    return NextResponse.json({ error: 'Failed to create review request' }, { status: 500 })
  }
}
