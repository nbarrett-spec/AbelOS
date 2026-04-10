export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/permits/[id]
 * Single permit with full details.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const permits: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "PermitLead" WHERE "id" = $1
    `, params.id)

    if (permits.length === 0) {
      return NextResponse.json({ error: 'Permit not found' }, { status: 404 })
    }

    const permit = permits[0]

    // If matched to a builder, get builder info
    let builder = null
    if (permit.matchedBuilderId) {
      const builders: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id", "companyName", "contactName", "email", "phone", "status"::text AS "status"
        FROM "Builder" WHERE "id" = $1
      `, permit.matchedBuilderId)
      builder = builders[0] || null
    }

    // Get related outreach sequences
    const sequences: any[] = await prisma.$queryRawUnsafe(`
      SELECT os.*,
        (SELECT COUNT(*)::int FROM "OutreachStep" WHERE "sequenceId" = os."id" AND "sentAt" IS NOT NULL) AS "stepsSent",
        (SELECT COUNT(*)::int FROM "OutreachStep" WHERE "sequenceId" = os."id" AND "repliedAt" IS NOT NULL) AS "replies"
      FROM "OutreachSequence" os
      WHERE os."permitLeadId" = $1
      ORDER BY os."createdAt" DESC
    `, params.id)

    return NextResponse.json({
      ...permit,
      estimatedValue: Number(permit.estimatedValue),
      builder,
      sequences,
    })
  } catch (error) {
    console.error('GET /api/agent-hub/permits/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch permit' }, { status: 500 })
  }
}

/**
 * PATCH /api/agent-hub/permits/[id]
 * Update permit status, notes, research data.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { status, notes, researchData, builderName, builderFound, matchedBuilderId, matchedDealId, estimatedValue } = body

    const sets: string[] = ['"updatedAt" = NOW()']
    const values: any[] = []
    let idx = 1

    if (status) { sets.push(`"status" = $${idx}`); values.push(status); idx++ }
    if (notes !== undefined) { sets.push(`"notes" = $${idx}`); values.push(notes); idx++ }
    if (researchData) { sets.push(`"researchData" = $${idx}::jsonb`); values.push(JSON.stringify(researchData)); idx++ }
    if (builderName) { sets.push(`"builderName" = $${idx}`); values.push(builderName); idx++ }
    if (builderFound !== undefined) { sets.push(`"builderFound" = $${idx}`); values.push(builderFound); idx++ }
    if (matchedBuilderId) { sets.push(`"matchedBuilderId" = $${idx}`); values.push(matchedBuilderId); idx++ }
    if (matchedDealId) { sets.push(`"matchedDealId" = $${idx}`); values.push(matchedDealId); idx++ }
    if (estimatedValue !== undefined) { sets.push(`"estimatedValue" = $${idx}`); values.push(estimatedValue); idx++ }

    if (status === 'OUTREACH_SENT') sets.push(`"outreachSentAt" = NOW()`)
    if (status === 'CONVERTED') sets.push(`"convertedAt" = NOW()`)

    values.push(params.id)

    await prisma.$executeRawUnsafe(`
      UPDATE "PermitLead" SET ${sets.join(', ')} WHERE "id" = $${idx}
    `, ...values)

    const updated: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "PermitLead" WHERE "id" = $1
    `, params.id)

    return NextResponse.json(updated[0])
  } catch (error) {
    console.error('PATCH /api/agent-hub/permits/[id] error:', error)
    return NextResponse.json({ error: 'Failed to update permit' }, { status: 500 })
  }
}
