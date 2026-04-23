export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// GET /api/ops/communities/[id]/floor-plans/[planId]/bom
// Returns the Brookfield Rev2 plan BoM for a given CommunityFloorPlan.
// Read from BrookfieldPlanBom (populated by scripts/ingest-brookfield-rev2.mjs).
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const plan: any[] = await prisma.$queryRawUnsafe(
      `SELECT cfp."id", cfp."name", cfp."planNumber", cfp."sqFootage",
              cfp."basePackagePrice", cfp."interiorDoorCount",
              cfp."exteriorDoorCount",
              c."name" AS "communityName", b."companyName" AS "builderName"
       FROM "CommunityFloorPlan" cfp
       JOIN "Community" c ON c."id" = cfp."communityId"
       JOIN "Builder"   b ON b."id" = c."builderId"
       WHERE cfp."id" = $1 AND cfp."communityId" = $2
       LIMIT 1`,
      params.planId, params.id
    )

    if (plan.length === 0) {
      return safeJson({ error: 'Floor plan not found' }, { status: 404 })
    }

    const lines: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "section", "lineOrder", "itemName", "quantity",
              "unit", "unitPrice", "extended", "wall", "location",
              "revisionTag"
       FROM "BrookfieldPlanBom"
       WHERE "planId" = $1
       ORDER BY "lineOrder" ASC`,
      params.planId
    )

    // Group by section for UI.
    const sections: Record<string, any[]> = {}
    for (const l of lines) {
      const key = l.section || 'Uncategorized'
      if (!sections[key]) sections[key] = []
      sections[key].push({
        ...l,
        quantity:  l.quantity  != null ? Number(l.quantity)  : null,
        unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
        extended:  l.extended  != null ? Number(l.extended)  : null,
      })
    }

    return safeJson({
      plan: plan[0],
      lineCount: lines.length,
      sections,
      revisionTag: lines[0]?.revisionTag || null,
    })
  } catch (error: any) {
    console.error('Plan BoM error:', error)
    return safeJson({ error: 'Internal server error' }, { status: 500 })
  }
}
