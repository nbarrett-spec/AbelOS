export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/takeoffs — List all takeoffs for ops review
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const search = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '25')))
    const offset = (page - 1) * limit

    // Build parameterized WHERE conditions
    const conditions: Prisma.Sql[] = []
    if (status) {
      conditions.push(Prisma.sql`t."status" = ${status}`)
    }
    if (search) {
      const searchPattern = `%${search}%`
      conditions.push(Prisma.sql`(p."name" ILIKE ${searchPattern} OR b."companyName" ILIKE ${searchPattern})`)
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty

    const takeoffs: any[] = await prisma.$queryRaw`
      SELECT t."id", t."status", t."confidence", t."createdAt", t."projectId",
        p."name" AS "projectName", p."planName", p."sqFootage",
        b."companyName" AS "builderName", b."email" AS "builderEmail",
        bp."fileName" AS "blueprintName",
        CAST((SELECT COUNT(*) FROM "TakeoffItem" ti WHERE ti."takeoffId" = t."id") AS INTEGER) AS "itemCount",
        CAST((SELECT COUNT(*) FROM "TakeoffItem" ti WHERE ti."takeoffId" = t."id" AND ti."productId" IS NOT NULL) AS INTEGER) AS "matchedCount"
      FROM "Takeoff" t
      JOIN "Project" p ON p."id" = t."projectId"
      JOIN "Builder" b ON b."id" = p."builderId"
      LEFT JOIN "Blueprint" bp ON bp."id" = t."blueprintId"
      ${whereClause}
      ORDER BY t."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as any[]

    const countResult: any[] = await prisma.$queryRaw`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt
      FROM "Takeoff" t
      JOIN "Project" p ON p."id" = t."projectId"
      JOIN "Builder" b ON b."id" = p."builderId"
      ${whereClause}
    ` as any[]

    const statusCounts: any[] = await prisma.$queryRaw`
      SELECT t."status", CAST(COUNT(*) AS INTEGER) AS cnt
      FROM "Takeoff" t
      GROUP BY t."status"
    ` as any[]

    return NextResponse.json({
      takeoffs: takeoffs.map(t => ({
        ...t,
        confidence: Number(t.confidence),
        sqFootage: Number(t.sqFootage),
        itemCount: Number(t.itemCount),
        matchedCount: Number(t.matchedCount),
      })),
      total: Number(countResult[0]?.cnt || 0),
      page,
      statusCounts: statusCounts.reduce((acc: any, r: any) => {
        acc[r.status] = Number(r.cnt)
        return acc
      }, {}),
    })
  } catch (error: any) {
    console.error('GET /api/ops/takeoffs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
