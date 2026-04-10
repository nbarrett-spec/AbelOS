export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// Ops-side product search — staff auth via cookie (no builder session needed)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    // Support both 'q' and 'search' param names for compatibility
    const search = searchParams.get('search') || searchParams.get('q') || ''
    const limit = parseInt(searchParams.get('limit') || '20')

    let whereClause = 'WHERE "active" = true'
    const params: any[] = []
    let idx = 1

    if (search) {
      whereClause += ` AND ("name" ILIKE $${idx} OR "sku" ILIKE $${idx})`
      params.push(`%${search}%`)
    }

    const products: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "name", "category", "basePrice", "cost"
       FROM "Product"
       ${whereClause}
       ORDER BY "category" ASC, "name" ASC
       LIMIT ${limit}`,
      ...params
    )

    return NextResponse.json({ products })
  } catch (error) {
    console.error('Failed to search products:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
