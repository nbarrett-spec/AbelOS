export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Recommendation {
  id: string
  name: string
  sku: string
  price: number
  category: string
  reason: string
}

export async function GET(request: NextRequest) {
  const auth = await getSession()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const productIdsParam = searchParams.get('productIds')

    if (!productIdsParam) {
      return NextResponse.json({ recommendations: [] }, { status: 200 })
    }

    const productIds = productIdsParam.split(',').filter(id => id.trim())

    if (productIds.length === 0) {
      return NextResponse.json({ recommendations: [] }, { status: 200 })
    }

    const recommendations: Recommendation[] = []
    const recommendedIds = new Set<string>()

    // Query 1: Find products frequently ordered together
    const frequentlyOrderedTogether = await prisma.$queryRawUnsafe<
      Array<{ productId: string; name: string; sku: string; basePrice: number; cleanCategory: string; frequency: number }>
    >(
      `
      SELECT oi2."productId", p."name", p."sku", p."basePrice", p."cleanCategory",
             COUNT(*)::int as "frequency"
      FROM "OrderItem" oi1
      JOIN "OrderItem" oi2 ON oi1."orderId" = oi2."orderId" AND oi1."productId" != oi2."productId"
      JOIN "Product" p ON oi2."productId" = p."id"
      WHERE oi1."productId" = ANY($1::text[])
      AND oi2."productId" != ALL($2::text[])
      AND p."active" = true
      GROUP BY oi2."productId", p."name", p."sku", p."basePrice", p."cleanCategory"
      ORDER BY COUNT(*) DESC
      LIMIT 6
      `,
      [productIds, productIds]
    )

    frequentlyOrderedTogether.forEach(item => {
      if (!recommendedIds.has(item.productId)) {
        recommendations.push({
          id: item.productId,
          name: item.name,
          sku: item.sku,
          price: item.basePrice,
          category: item.cleanCategory,
          reason: 'Frequently ordered together',
        })
        recommendedIds.add(item.productId)
      }
    })

    // Query 2: Check if cart has doors but no hardware
    const hasDoors = await prisma.$queryRawUnsafe<Array<{ cleanCategory: string }>>(
      `
      SELECT DISTINCT p."cleanCategory"
      FROM "Product" p
      WHERE p."id" = ANY($1::text[])
      AND LOWER(p."cleanCategory") LIKE '%door%'
      `,
      [productIds]
    )

    const hasHardware = await prisma.$queryRawUnsafe<Array<{ cleanCategory: string }>>(
      `
      SELECT DISTINCT p."cleanCategory"
      FROM "Product" p
      WHERE p."id" = ANY($1::text[])
      AND (LOWER(p."cleanCategory") LIKE '%hardware%'
      OR LOWER(p."cleanCategory") LIKE '%frame%'
      OR LOWER(p."cleanCategory") LIKE '%component%')
      `,
      [productIds]
    )

    if (hasDoors.length > 0 && hasHardware.length === 0 && recommendations.length < 6) {
      const matchingHardware = await prisma.$queryRawUnsafe<
        Array<{ id: string; name: string; sku: string; basePrice: number; cleanCategory: string }>
      >(
        `
        SELECT "id", "name", "sku", "basePrice", "cleanCategory"
        FROM "Product"
        WHERE (LOWER("cleanCategory") LIKE '%hardware%'
        OR LOWER("cleanCategory") LIKE '%frame%'
        OR LOWER("cleanCategory") LIKE '%component%')
        AND "active" = true
        ORDER BY "basePrice" DESC
        LIMIT 3
        `
      )

      matchingHardware.forEach(item => {
        if (!recommendedIds.has(item.id)) {
          recommendations.push({
            id: item.id,
            name: item.name,
            sku: item.sku,
            price: item.basePrice,
            category: item.cleanCategory,
            reason: 'Matching hardware for your doors',
          })
          recommendedIds.add(item.id)
        }
      })
    }

    // Query 3: Popular products with similar builders (if still under limit)
    if (recommendations.length < 6) {
      const popular = await prisma.$queryRawUnsafe<
        Array<{ id: string; name: string; sku: string; basePrice: number; cleanCategory: string }>
      >(
        `
        SELECT p."id", p."name", p."sku", p."basePrice", p."cleanCategory"
        FROM "Product" p
        JOIN (
          SELECT oi."productId", COUNT(*)::int as "orderCount"
          FROM "OrderItem" oi
          GROUP BY oi."productId"
          ORDER BY COUNT(*) DESC
          LIMIT 12
        ) top_products ON p."id" = top_products."productId"
        WHERE p."active" = true
        AND p."id" != ALL($1::text[])
        ORDER BY top_products."orderCount" DESC
        LIMIT ${6 - recommendations.length}
        `,
        [productIds]
      )

      popular.forEach(item => {
        if (!recommendedIds.has(item.id)) {
          recommendations.push({
            id: item.id,
            name: item.name,
            sku: item.sku,
            price: item.basePrice,
            category: item.cleanCategory,
            reason: 'Popular with similar builders',
          })
          recommendedIds.add(item.id)
        }
      })
    }

    return NextResponse.json({ recommendations: recommendations.slice(0, 6) }, { status: 200 })
  } catch (error) {
    console.error('GET /api/recommendations error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recommendations' },
      { status: 500 }
    )
  }
}
