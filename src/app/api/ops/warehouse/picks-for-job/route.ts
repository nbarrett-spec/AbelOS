export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId query parameter is required' },
        { status: 400 }
      )
    }

    const query = `
      SELECT
        mp.id,
        mp.sku,
        mp.description,
        mp.quantity,
        mp."pickedQty",
        mp.status,
        mp.zone,
        mp."createdAt",
        ii."warehouseZone",
        ii."binLocation",
        p.id as "product_id",
        p.name as "product_name",
        p.sku as "product_sku",
        j.id as "job_id",
        j."jobNumber",
        j."builderName",
        j."deliveryDate"
      FROM "MaterialPick" mp
      LEFT JOIN "InventoryItem" ii ON ii."productId" = mp."productId"
      LEFT JOIN "Product" p ON p.id = mp."productId"
      LEFT JOIN "Job" j ON j.id = mp."jobId"
      WHERE mp."jobId" = $1
      ORDER BY mp."createdAt" ASC
    `

    const picks: any = await prisma.$queryRawUnsafe(query, jobId)

    const formattedPicks = picks.map((pick: any) => ({
      id: pick.id,
      sku: pick.sku,
      description: pick.description,
      quantity: pick.quantity,
      pickedQty: pick.pickedQty,
      status: pick.status,
      zone: pick.zone,
      createdAt: pick.createdAt,
      binLocation: pick.binLocation,
      warehouseZone: pick.warehouseZone,
      product: pick.product_id
        ? {
            id: pick.product_id,
            name: pick.product_name,
            sku: pick.product_sku,
          }
        : null,
      job: pick.job_id
        ? {
            id: pick.job_id,
            jobNumber: pick.jobNumber,
            builderName: pick.builderName,
            deliveryDate: pick.deliveryDate,
          }
        : null,
    }))

    return NextResponse.json({
      picks: formattedPicks,
      total: formattedPicks.length,
    })
  } catch (error) {
    console.error('Picks for job error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picks' },
      { status: 500 }
    )
  }
}
