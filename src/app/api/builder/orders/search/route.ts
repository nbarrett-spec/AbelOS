export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface OrderSearchResult {
  id: string
  orderNumber: string
  createdAt: string
  projectName?: string
  status: string
  total: number
  itemCount: number
  itemPreview: string[]
}

interface SearchResponse {
  orders: OrderSearchResult[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const q = searchParams.get('q')?.trim() || ''
    const status = searchParams.get('status')?.toUpperCase() || ''
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    // Build base query
    let whereClause = 'o."builderId" = $1'
    const params: any[] = [session.builderId]
    let paramIndex = 2

    // Filter by status if provided
    if (status) {
      whereClause += ` AND o."status"::text = $${paramIndex}`
      params.push(status)
      paramIndex++
    }

    // Filter by date range if provided
    if (dateFrom) {
      whereClause += ` AND o."createdAt" >= $${paramIndex}`
      params.push(new Date(dateFrom))
      paramIndex++
    }
    if (dateTo) {
      whereClause += ` AND o."createdAt" <= $${paramIndex}`
      params.push(new Date(dateTo))
      paramIndex++
    }

    // Full-text search for order number, project name, and product names
    if (q) {
      whereClause += ` AND (
        o."orderNumber" ILIKE $${paramIndex}
        OR COALESCE(p."name", '') ILIKE $${paramIndex}
      )`
      params.push(`%${q}%`)
      paramIndex++
    }

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT o.id)::int as count FROM "Order" o
       LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
       LEFT JOIN "Product" p ON p.id = oi."productId"
       WHERE ${whereClause}`,
      ...params
    )
    const total = countResult[0]?.count || 0

    // Get paginated results with item preview
    const results: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        o.id,
        o."orderNumber",
        o."createdAt",
        o."status",
        o."total",
        COUNT(DISTINCT oi.id)::int as "itemCount",
        ARRAY_AGG(DISTINCT p."name" ORDER BY p."name") FILTER (WHERE p."name" IS NOT NULL)::text[] as "itemNames"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
      LEFT JOIN "Product" p ON p.id = oi."productId"
      WHERE ${whereClause}
      GROUP BY o.id, o."orderNumber", o."createdAt", o."status", o."total"
      ORDER BY o."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, ...params, limit, offset)

    const orders: OrderSearchResult[] = results.map(r => ({
      id: r.id,
      orderNumber: r.orderNumber,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      total: Number(r.total),
      itemCount: r.itemCount || 0,
      itemPreview: (r.itemNames || []).slice(0, 3),
    }))

    return NextResponse.json({
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    } as SearchResponse)
  } catch (error: any) {
    console.error('GET /api/builder/orders/search error:', error)
    return NextResponse.json(
      { error: 'Failed to search orders' },
      { status: 500 }
    )
  }
}
