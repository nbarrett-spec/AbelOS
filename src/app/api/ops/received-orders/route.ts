export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/received-orders — List received/new orders with pagination
export async function GET(request: NextRequest) {
  // SECURITY: Require staff auth
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const status = searchParams.get('status') || 'RECEIVED,CONFIRMED'
    const builderId = searchParams.get('builderId') || null
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '20'))
    const offset = (page - 1) * limit

    // Parse status filter
    const statuses = status.split(',').map(s => s.trim().toUpperCase())

    // Build WHERE clause
    let whereClause = ''
    const params: any[] = []

    // Add status filter
    const statusPlaceholders = statuses.map((_, i) => `$${i + 1}`).join(',')
    whereClause += `o.status::text IN (${statusPlaceholders})`
    params.push(...statuses)

    // Add builderId filter if provided
    if (builderId) {
      whereClause += ` AND o."builderId" = $${params.length + 1}`
      params.push(builderId)
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM "Order" o
      WHERE ${whereClause}
    `
    const countResult: any[] = await prisma.$queryRawUnsafe(countQuery, ...params)
    const total = countResult[0]?.total || 0

    // Get paginated orders with builder info and item count
    const ordersQuery = `
      SELECT
        o.id,
        o."orderNumber",
        b."companyName" as "builderName",
        o."builderId",
        o."poNumber",
        o.total,
        o.status::text as status,
        b."paymentTerm",
        (SELECT COUNT(*)::int FROM "OrderItem" WHERE "orderId" = o.id) as "itemCount",
        o."createdAt",
        o."deliveryDate"
      FROM "Order" o
      JOIN "Builder" b ON o."builderId" = b.id
      WHERE ${whereClause}
      ORDER BY o."createdAt" DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `

    const orders: any[] = await prisma.$queryRawUnsafe(
      ordersQuery,
      ...params,
      limit,
      offset
    )

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      items: orders,
      total,
      page,
      limit,
      totalPages,
    })
  } catch (error: any) {
    console.error('Failed to fetch received orders:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
