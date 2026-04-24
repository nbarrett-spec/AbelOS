export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { toCsv } from '@/lib/csv'

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
    const format = searchParams.get('format')

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

    // CSV export branch — return ALL filtered rows (no pagination), join Supplier name and InventoryItem.onHand
    if (format === 'csv') {
      // Build a parallel WHERE clause with p. prefixes (same filters, same params, same param order)
      const csvWhereConditions: string[] = ['p."active" = true']
      let csvParamIndex = 1

      if (category) {
        csvWhereConditions.push(`p."category" = $${csvParamIndex}`)
        csvParamIndex++
      }

      if (search) {
        csvWhereConditions.push(
          `(p."name" ILIKE $${csvParamIndex} OR p."sku" ILIKE $${csvParamIndex + 1} OR p."description" ILIKE $${csvParamIndex + 2})`
        )
        csvParamIndex += 3
      }

      if (imageStatus === 'has-image') {
        csvWhereConditions.push(`(p."imageUrl" IS NOT NULL AND p."imageUrl" != '')`)
      } else if (imageStatus === 'needs-image') {
        csvWhereConditions.push(`(p."imageUrl" IS NULL OR p."imageUrl" = '')`)
      }

      if (priceStatus === 'priced') {
        csvWhereConditions.push(`p."basePrice" > 0`)
      } else if (priceStatus === 'unpriced') {
        csvWhereConditions.push(`p."basePrice" = 0`)
      }

      const csvWhereClause = csvWhereConditions.join(' AND ')

      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT
          p."sku",
          p."name",
          p."category",
          p."subcategory",
          p."productType",
          p."cost",
          p."basePrice" as "sellPrice",
          p."supplierId",
          s."name" as "supplierName",
          p."leadTimeDays",
          COALESCE(i."onHand", 0) as "stockQty",
          p."active",
          p."createdAt"
        FROM "Product" p
        LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
        LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
        WHERE ${csvWhereClause}
        ORDER BY p."category" ASC, p."name" ASC`,
        ...params
      )

      const csvRows = rows.map((r) => {
        const cost = Number(r.cost) || 0
        const sellPrice = Number(r.sellPrice) || 0
        const margin = sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : 0
        return {
          sku: r.sku ?? '',
          name: r.name ?? '',
          category: r.category ?? '',
          subcategory: r.subcategory ?? '',
          productType: r.productType ?? '',
          cost: cost.toFixed(2),
          sellPrice: sellPrice.toFixed(2),
          margin: `${margin.toFixed(2)}%`,
          vendor: r.supplierName ?? r.supplierId ?? '',
          leadTime: r.leadTimeDays ?? '',
          stockQty: r.stockQty ?? 0,
          active: r.active ? 'true' : 'false',
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
        }
      })

      const csv = toCsv(csvRows, [
        { key: 'sku', label: 'sku' },
        { key: 'name', label: 'name' },
        { key: 'category', label: 'category' },
        { key: 'subcategory', label: 'subcategory' },
        { key: 'productType', label: 'productType' },
        { key: 'cost', label: 'cost' },
        { key: 'sellPrice', label: 'sellPrice' },
        { key: 'margin', label: 'margin' },
        { key: 'vendor', label: 'vendor' },
        { key: 'leadTime', label: 'leadTime' },
        { key: 'stockQty', label: 'stockQty' },
        { key: 'active', label: 'active' },
        { key: 'createdAt', label: 'createdAt' },
      ])

      const date = new Date().toISOString().split('T')[0]
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="products-${date}.csv"`,
        },
      })
    }

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
