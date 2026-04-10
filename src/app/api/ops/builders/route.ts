export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/builders — List all builders (ops-side, staff auth via cookie)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams

    // Pagination params
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    // Filter params
    const search = searchParams.get('search') || ''
    const statusFilter = searchParams.get('status') || 'ALL'
    const termFilter = searchParams.get('paymentTerm') || 'ALL'
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Sort params
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortDir = searchParams.get('sortDir') || 'desc'

    // Build where clause
    interface WhereClause {
      AND?: Array<any>
      OR?: Array<any>
      status?: string
      paymentTerm?: string
      createdAt?: any
    }

    const where: WhereClause = {}

    // Search filter
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Status filter
    if (statusFilter !== 'ALL') {
      where.status = statusFilter
    }

    // Payment term filter
    if (termFilter !== 'ALL') {
      where.paymentTerm = termFilter
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom)
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
      }
    }

    // Build orderBy
    const orderBy: Record<string, string> = {}
    const validSortFields = ['companyName', 'contactName', 'status', 'paymentTerm', 'creditLimit', 'createdAt']
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt'
    orderBy[sortField] = sortDir === 'asc' ? 'asc' : 'desc'

    // Build WHERE clause with parameterized queries
    let whereClause = ''
    const whereConditions: string[] = []
    const sqlParams: any[] = []
    let pidx = 1

    if (where.status) {
      whereConditions.push(`b."status" = $${pidx}`)
      sqlParams.push(where.status)
      pidx++
    }
    if (where.paymentTerm) {
      whereConditions.push(`b."paymentTerm" = $${pidx}`)
      sqlParams.push(where.paymentTerm)
      pidx++
    }
    if (where.OR && search) {
      whereConditions.push(`(b."companyName" ILIKE $${pidx} OR b."contactName" ILIKE $${pidx} OR b."email" ILIKE $${pidx} OR b."city" ILIKE $${pidx})`)
      sqlParams.push(`%${search}%`)
      pidx++
    }
    if (where.createdAt) {
      if ((where.createdAt as any).gte) {
        whereConditions.push(`b."createdAt" >= $${pidx}::timestamptz`)
        sqlParams.push((where.createdAt as any).gte.toISOString())
        pidx++
      }
      if ((where.createdAt as any).lte) {
        whereConditions.push(`b."createdAt" <= $${pidx}::timestamptz`)
        sqlParams.push((where.createdAt as any).lte.toISOString())
        pidx++
      }
    }

    if (whereConditions.length > 0) {
      whereClause = 'WHERE ' + whereConditions.join(' AND ')
    }

    // Build ORDER BY clause (whitelist approach)
    const dirStr = sortDir === 'asc' ? 'ASC' : 'DESC'
    const builderSortMap: Record<string, string> = {
      companyName: `b."companyName" ${dirStr}`,
      contactName: `b."contactName" ${dirStr}`,
      status: `b."status" ${dirStr}`,
      paymentTerm: `b."paymentTerm" ${dirStr}`,
      creditLimit: `b."creditLimit" ${dirStr}`,
      createdAt: `b."createdAt" ${dirStr}`,
    }
    const orderBySQL = builderSortMap[sortField] || `b."createdAt" ${dirStr}`

    // Get total count for pagination
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total FROM "Builder" b ${whereClause}`, ...sqlParams
    )
    const total = countResult[0]?.total || 0

    const builders = await prisma.$queryRawUnsafe(`
      SELECT b."id", b."companyName", b."contactName", b."email", b."phone", b."city", b."state",
             b."paymentTerm", b."taxExempt", b."status", b."creditLimit", b."accountBalance",
             b."pricingTier", b."createdAt",
             bo."name" as "organizationName", d."name" as "divisionName"
      FROM "Builder" b
      LEFT JOIN "Division" d ON b."divisionId" = d."id"
      LEFT JOIN "BuilderOrganization" bo ON d."organizationId" = bo."id"
      ${whereClause}
      ORDER BY ${orderBySQL}
      LIMIT $${pidx} OFFSET $${pidx + 1}
    `, ...sqlParams, limit, skip)

    // Also get counts for each builder (only for displayed builders)
    const builderIds = (builders as any[]).map(b => b.id)
    let countResults: Array<{id: string, projects: number, orders: number}> = []

    if (builderIds.length > 0) {
      countResults = await prisma.$queryRawUnsafe(`
        SELECT b."id", COUNT(DISTINCT p."id")::int as "projects", COUNT(DISTINCT o."id")::int as "orders"
        FROM "Builder" b
        LEFT JOIN "Project" p ON b."id" = p."builderId"
        LEFT JOIN "Order" o ON b."id" = o."builderId"
        WHERE b."id" = ANY($1::text[])
        GROUP BY b."id"
      `, builderIds) as any
    }

    const countMap = new Map(countResults.map(c => [c.id, {projects: Number(c.projects), orders: Number(c.orders)}]))

    // Get builder pricing counts
    const pricingCounts: any[] = await prisma.$queryRawUnsafe(`
      SELECT "builderId", COUNT(*)::int AS count FROM "BuilderPricing" GROUP BY "builderId"
    `)
    const pricingMap = new Map(pricingCounts.map((p: any) => [p.builderId, p.count]))

    const buildersWithStats = (builders as any[]).map((builder) => {
      const counts = countMap.get(builder.id) || {projects: 0, orders: 0}
      return {
        ...builder,
        totalProjects: counts.projects,
        totalOrders: counts.orders,
        customPricingCount: pricingMap.get(builder.id) || 0,
        _count: {
          projects: counts.projects,
          orders: counts.orders,
          customPricing: pricingMap.get(builder.id) || 0,
        },
      }
    })

    return NextResponse.json({
      builders: buildersWithStats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      }
    })
  } catch (error) {
    console.error('GET /api/ops/builders error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
