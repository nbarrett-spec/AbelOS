export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const jobId = searchParams.get('jobId')

    // Build dynamic WHERE clause
    const whereConditions = []
    const params: any[] = []

    if (status) {
      whereConditions.push(`mp.status::text = $${params.length + 1}`)
      params.push(status)
    }
    if (jobId) {
      whereConditions.push(`mp."jobId" = $${params.length + 1}`)
      params.push(jobId)
    }

    const whereClause =
      whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''

    // Fetch picks with job details and inventory info
    const picksQuery = `
      SELECT
        mp.id,
        mp.sku,
        mp.description,
        mp.quantity,
        mp."pickedQty",
        mp.status::text as status,
        mp.zone,
        mp."productId",
        mp."parentProductId",
        mp."bomEntryId",
        mp."orderItemId",
        mp."pickedAt",
        mp."verifiedAt",
        mp."createdAt",
        j.id as "job_id",
        j."jobNumber" as "job_jobNumber",
        j."builderName" as "job_builderName",
        j.status::text as "job_status",
        ii."onHand" as "inv_onHand",
        ii."available" as "inv_available",
        ii."warehouseZone" as "inv_zone",
        ii."binLocation" as "inv_bin"
      FROM "MaterialPick" mp
      LEFT JOIN "Job" j ON mp."jobId" = j.id
      LEFT JOIN "InventoryItem" ii ON ii."productId" = mp."productId"
      ${whereClause}
      ORDER BY mp."createdAt" DESC
    `

    const picks: any = await prisma.$queryRawUnsafe(picksQuery, ...params)

    // Transform flat result into nested structure
    const formattedPicks = picks.map((pick: any) => ({
      id: pick.id,
      sku: pick.sku,
      description: pick.description,
      quantity: pick.quantity,
      pickedQty: pick.pickedQty,
      status: pick.status,
      zone: pick.zone || pick.inv_zone || null,
      productId: pick.productId,
      parentProductId: pick.parentProductId,
      pickedAt: pick.pickedAt,
      verifiedAt: pick.verifiedAt,
      createdAt: pick.createdAt,
      inventory: {
        onHand: pick.inv_onHand || 0,
        available: pick.inv_available || 0,
        zone: pick.inv_zone,
        bin: pick.inv_bin,
      },
      job: pick.job_id
        ? {
            id: pick.job_id,
            jobNumber: pick.job_jobNumber,
            builderName: pick.job_builderName,
            status: pick.job_status,
          }
        : null,
    }))

    // Count by status
    const countQuery = `
      SELECT status::text as status, COUNT(*)::int as count
      FROM "MaterialPick"
      GROUP BY status
    `

    const countResults: any = await prisma.$queryRawUnsafe(countQuery)

    const counts: Record<string, number> = {}
    countResults.forEach((item: any) => {
      counts[item.status] = item.count
    })

    return NextResponse.json({
      picks: formattedPicks,
      total: formattedPicks.length,
      statusCounts: counts,
    })
  } catch (error) {
    console.error('Picks error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picks' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/manufacturing/picks — Batch update pick statuses
// Body: { pickIds: string[], status: string, staffId?: string }
// Used by warehouse workers to mark picks as PICKING, PICKED, VERIFIED
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { pickIds, status: newStatus } = body
    const staffId = request.headers.get('x-staff-id') || 'system'

    if (!pickIds || !Array.isArray(pickIds) || pickIds.length === 0) {
      return NextResponse.json({ error: 'pickIds array required' }, { status: 400 })
    }

    const validStatuses = ['PENDING', 'PICKING', 'PICKED', 'VERIFIED', 'SHORT', 'SUBSTITUTED']
    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
    }

    let updated = 0
    for (const pickId of pickIds) {
      const params: any[] = [newStatus, pickId]
      let paramIndex = 3
      const setClauses = [`status = $1::"PickStatus"`]

      if (newStatus === 'PICKING' || newStatus === 'PICKED') {
        params.push(staffId)
        setClauses.push(`"pickedById" = $${paramIndex}`)
        paramIndex++
      }
      if (newStatus === 'PICKED') {
        setClauses.push(`"pickedAt" = NOW()`)
        // Auto-set pickedQty to quantity if not already set
        setClauses.push(`"pickedQty" = CASE WHEN "pickedQty" = 0 THEN quantity ELSE "pickedQty" END`)
      }
      if (newStatus === 'VERIFIED') {
        setClauses.push(`"verifiedAt" = NOW()`)
        params.push(staffId)
        setClauses.push(`"verifiedById" = $${paramIndex}`)
        paramIndex++
      }

      await prisma.$executeRawUnsafe(`
        UPDATE "MaterialPick" SET ${setClauses.join(', ')} WHERE id = $2
      `, ...params)
      updated++
    }

    return NextResponse.json({
      success: true,
      updated,
      newStatus,
    })
  } catch (error: any) {
    console.error('[Picks batch update] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update picks', details: error.message },
      { status: 500 }
    )
  }
}

