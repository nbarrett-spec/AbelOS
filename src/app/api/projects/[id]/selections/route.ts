export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET: Return all homeowner selections for a project
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id

    // Verify builder owns this project
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId" FROM "Project" WHERE "id" = $1 LIMIT 1`,
      projectId
    )

    if (!projects[0] || projects[0].builderId !== session.builderId) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    // Get all selections across all homeowner accesses for this project with full details
    const selections: any[] = await prisma.$queryRawUnsafe(
      `SELECT hs."id", hs."location", hs."baseProductId", hs."selectedProductId",
              hs."adderCost", hs."status", hs."confirmedAt", hs."createdAt", hs."updatedAt",
              ha."id" AS "homeownerId", ha."name" AS "homeownerName",
              ha."email" AS "homeownerEmail", ha."phone" AS "homeownerPhone",
              ha."lastVisitAt" AS "homeownerLastVisit",
              bp."id" AS "base_id", bp."name" AS "base_name", bp."description" AS "base_description",
              bp."basePrice" AS "base_basePrice", bp."sku" AS "base_sku",
              bp."imageUrl" AS "base_imageUrl", bp."thumbnailUrl" AS "base_thumbnailUrl",
              sp."id" AS "sel_id", sp."name" AS "sel_name", sp."description" AS "sel_description",
              sp."basePrice" AS "sel_basePrice", sp."sku" AS "sel_sku",
              sp."imageUrl" AS "sel_imageUrl", sp."thumbnailUrl" AS "sel_thumbnailUrl"
       FROM "HomeownerSelection" hs
       JOIN "HomeownerAccess" ha ON ha."id" = hs."homeownerAccessId"
       LEFT JOIN "Product" bp ON bp."id" = hs."baseProductId"
       LEFT JOIN "Product" sp ON sp."id" = hs."selectedProductId"
       WHERE ha."projectId" = $1`,
      projectId
    )

    // Count distinct homeowners
    const homeownerCountResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT ha."id")::int AS "count"
       FROM "HomeownerAccess" ha
       WHERE ha."projectId" = $1`,
      projectId
    )

    const selectionsWithDetails = selections.map((s) => ({
      id: s.id,
      homeownerId: s.homeownerId,
      homeownerName: s.homeownerName,
      homeownerEmail: s.homeownerEmail,
      homeownerPhone: s.homeownerPhone,
      homeownerLastVisit: s.homeownerLastVisit,
      location: s.location,
      baseProductId: s.baseProductId,
      selectedProductId: s.selectedProductId,
      adderCost: s.adderCost,
      status: s.status,
      confirmedAt: s.confirmedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      baseProduct: s.base_id ? {
        id: s.base_id, name: s.base_name, description: s.base_description,
        basePrice: s.base_basePrice, sku: s.base_sku,
        imageUrl: s.base_imageUrl, thumbnailUrl: s.base_thumbnailUrl,
      } : null,
      selectedProduct: s.sel_id ? {
        id: s.sel_id, name: s.sel_name, description: s.sel_description,
        basePrice: s.sel_basePrice, sku: s.sel_sku,
        imageUrl: s.sel_imageUrl, thumbnailUrl: s.sel_thumbnailUrl,
      } : null,
    }))

    return NextResponse.json({
      projectId,
      totalHomeowners: homeownerCountResult[0]?.count || 0,
      totalSelections: selectionsWithDetails.length,
      selections: selectionsWithDetails,
    })
  } catch (error) {
    console.error('Error fetching homeowner selections:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
