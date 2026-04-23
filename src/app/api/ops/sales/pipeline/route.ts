export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, audit } from '@/lib/audit'
import { checkStaffAuth } from '@/lib/api-auth'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

const PIPELINE_STAGES = [
  'PROSPECT',
  'DISCOVERY',
  'WALKTHROUGH',
  'BID_SUBMITTED',
  'BID_REVIEW',
  'NEGOTIATION',
  'WON',
  'LOST',
  'ONBOARDED',
]

// GET /api/ops/sales/pipeline — Get deals grouped by stage with aggregate stats
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Fetch all deals with owner info
    const deals: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName", s."email" AS "ownerEmail"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."stage" != 'ARCHIVED'
       ORDER BY d."createdAt" DESC`
    )

    // Enrich with owner info
    for (const deal of deals) {
      deal.owner = {
        id: deal.ownerId,
        firstName: deal.firstName,
        lastName: deal.lastName,
        email: deal.ownerEmail,
      }
      // Generate initials from name
      const first = deal.firstName ? deal.firstName.charAt(0).toUpperCase() : 'U'
      const last = deal.lastName ? deal.lastName.charAt(0).toUpperCase() : ''
      deal.owner.initials = (first + last).substring(0, 2)
    }

    // Group by stage and calculate aggregates
    const pipeline: Record<string, any> = {}

    for (const stage of PIPELINE_STAGES) {
      const stageDealsList = deals.filter((d) => d.stage === stage)
      const totalValue = stageDealsList.reduce((sum, deal) => sum + (deal.dealValue || 0), 0)

      pipeline[stage] = {
        stage,
        deals: stageDealsList.map((d) => ({
          id: d.id,
          dealNumber: d.dealNumber,
          companyName: d.companyName,
          contactName: d.contactName,
          dealValue: d.dealValue || 0,
          probability: d.probability || 0,
          expectedCloseDate: d.expectedCloseDate,
          ownerId: d.ownerId,
          owner: d.owner,
          updatedAt: d.updatedAt,
        })),
        stats: {
          count: stageDealsList.length,
          totalValue,
        },
      }
    }

    return NextResponse.json({ pipeline })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/sales/pipeline — Move deal to new stage
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { dealId, newStage } = body

    if (!dealId || !newStage) {
      return NextResponse.json({ error: 'dealId and newStage are required' }, { status: 400 })
    }

    if (!PIPELINE_STAGES.includes(newStage)) {
      return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
    }

    audit(request, 'UPDATE', 'Deal', dealId, { method: 'PATCH', newStage }).catch(() => {})

    // Get current deal
    const currentDeal: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "stage", "companyName" FROM "Deal" WHERE "id" = $1`,
      dealId
    )

    if (!currentDeal.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const deal = currentDeal[0]
    const previousStage = deal.stage

    // Guard: enforce DealStage state machine before writing the stage change.
    try {
      requireValidTransition('deal', previousStage, newStage)
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // Update deal stage
    const updated: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "Deal" SET "stage" = $1::"DealStage", "updatedAt" = NOW() WHERE "id" = $2 RETURNING *`,
      newStage,
      dealId
    )

    // Create activity log for stage change
    const activityId = 'act' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$queryRawUnsafe(
      `INSERT INTO "DealActivity" ("id", "dealId", "staffId", "type", "subject", "notes", "createdAt")
       VALUES ($1, $2, $3, 'STAGE_CHANGE'::"DealActivityType", $4, $5, NOW())`,
      activityId,
      dealId,
      staffId,
      `Moved to ${newStage}`,
      `Previous stage: ${previousStage}`
    )

    // Audit log
    logAudit({
      staffId,
      action: 'STAGE_CHANGE',
      entity: 'Deal',
      entityId: dealId,
      details: { previousStage, newStage, dealNumber: deal.dealNumber },
    }).catch(() => {})

    // Fetch updated deal with owner info
    const enrichedDeal: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName", s."email" AS "ownerEmail"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."id" = $1`,
      dealId
    )

    const enriched = enrichedDeal[0]
    enriched.owner = {
      id: enriched.ownerId,
      firstName: enriched.firstName,
      lastName: enriched.lastName,
      email: enriched.ownerEmail,
    }

    return NextResponse.json(enriched, { status: 200 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
