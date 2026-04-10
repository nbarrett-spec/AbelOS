export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ops-side endpoint — no builder session required (staff auth via cookie)

    const { searchParams } = new URL(request.url)
    const skip = parseInt(searchParams.get('skip') || '0')
    const take = parseInt(searchParams.get('take') || '50')
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const imageStatus = searchParams.get('imageStatus') // 'has-image' or 'needs-image'
    const priceStatus = searchParams.get('priceStatus') // 'priced' or 'unpriced'

    // Build dynamic WHERE clause with parameters
    const whereConditions: string[] = ['active = true']
    const params: any[] = []
    let paramIndex = 1

    if (category) {
      whereConditions.push(`"category" = $${paramIndex}`)
      params.push(category)
      paramIndex++
    }

    if (search) {
      whereConditions.push(
        `("name" ILIKE $${paramIndex} OR "sku" ILIKE $${paramIndex} OR "description" ILIKE $${paramIndex})`
      )
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm)
      paramIndex += 3
    }

    if (imageStatus === 'has-image') {
      whereConditions.push(`("imageUrl" IS NOT NULL AND "imageUrl" != '')`)
    } else if (imageStatus === 'needs-image') {
      whereConditions.push(`("imageUrl" IS NULL OR "imageUrl" = '')`)
    }

    if (priceStatus === 'priced') {
      whereConditions.push(`"basePrice" > 0`)
    } else if (priceStatus === 'unpriced') {
      whereConditions.push(`"basePrice" = 0`)
    }

    const whereClause = whereConditions.join(' AND ')

    // Fetch products with pagination
    const products: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        id, sku, name, category, subcategory, "basePrice",
        "imageUrl", "thumbnailUrl", "imageAlt", "inStock", active, "displayName"
      FROM "Product"
      WHERE ${whereClause}
      ORDER BY "category" ASC, "name" ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      ...params,
      take,
      skip
    )

    // Get total count for pagination
    const totalResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Product" WHERE ${whereClause}`,
      ...params
    )
    const total = totalResult[0]?.count || 0

    // Count products with images
    const withImagesResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Product"
       WHERE ${whereClause} AND "imageUrl" IS NOT NULL AND "imageUrl" != ''`,
      ...params
    )
    const withImages = withImagesResult[0]?.count || 0

    // Count products needing images
    const needingImagesResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Product"
       WHERE ${whereClause} AND ("imageUrl" IS NULL OR "imageUrl" = '')`,
      ...params
    )
    const needingImages = needingImagesResult[0]?.count || 0

    // Count by category
    const categoryStats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        "category",
        COUNT(*)::int as total,
        SUM(CASE WHEN "imageUrl" IS NOT NULL AND "imageUrl" != '' THEN 1 ELSE 0 END)::int as withImages
      FROM "Product"
      WHERE active = true
      GROUP BY "category"
      ORDER BY "category" ASC`
    )

    const byCategory: Record<string, { total: number; withImages: number; needingImages: number }> = {}
    for (const cat of categoryStats) {
      byCategory[cat.category] = {
        total: cat.total,
        withImages: cat.withImages || 0,
        needingImages: cat.total - (cat.withImages || 0),
      }
    }

    return NextResponse.json({
      products,
      pagination: {
        skip,
        take,
        total,
      },
      stats: {
        total,
        withImages,
        needingImages,
        byCategory,
      },
    })
  } catch (error) {
    console.error('Failed to fetch products:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
