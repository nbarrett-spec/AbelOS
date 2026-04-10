export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/intelligence/builder/[id]
 * Returns the full intelligence profile for a single builder.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get builder basic info
    const builder: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "companyName", "contactName", "email", "phone",
             "status"::text AS "status", "creditLimit", "currentBalance",
             "createdAt"
      FROM "Builder"
      WHERE "id" = $1
    `, params.id)

    if (!builder || builder.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Get intelligence profile
    const intel: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "BuilderIntelligence" WHERE "builderId" = $1
    `, params.id)

    // If no profile exists yet, return builder with empty intel
    if (!intel || intel.length === 0) {
      return NextResponse.json({
        builder: builder[0],
        intelligence: null,
        message: 'Intelligence profile not yet computed. POST to /api/agent-hub/intelligence/refresh to generate.'
      })
    }

    return NextResponse.json({
      builder: builder[0],
      intelligence: {
        ...intel[0],
        avgOrderValue: Number(intel[0].avgOrderValue),
        totalLifetimeValue: Number(intel[0].totalLifetimeValue),
        currentBalance: Number(intel[0].currentBalance),
        onTimePaymentRate: Number(intel[0].onTimePaymentRate),
        estimatedWalletShare: Number(intel[0].estimatedWalletShare),
        estimatedNextOrderValue: Number(intel[0].estimatedNextOrderValue),
        pipelineValue: Number(intel[0].pipelineValue),
      }
    })
  } catch (error) {
    console.error('GET /api/agent-hub/intelligence/builder/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch builder intelligence' }, { status: 500 })
  }
}
