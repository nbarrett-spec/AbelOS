export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface SearchResult {
  id: string
  sku: string
  name: string
  displayName: string | null
  category: string
  basePrice: number
  stock: number
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()

    if (!q || q.length < 1) {
      return NextResponse.json({ results: [] })
    }

    // First try exact SKU match
    let products: any[] = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.sku, p.name, p."displayName", p.category, p."basePrice"
       FROM "Product" p
       WHERE p.sku = $1 AND p.active = true
       LIMIT 10`,
      q.toUpperCase()
    )

    // If no exact match, try partial SKU match (ILIKE)
    if (products.length === 0) {
      products = await prisma.$queryRawUnsafe(
        `SELECT p.id, p.sku, p.name, p."displayName", p.category, p."basePrice"
         FROM "Product" p
         WHERE (p.sku ILIKE $1 OR p.name ILIKE $1) AND p.active = true
         ORDER BY p.sku, p.name
         LIMIT 10`,
        `%${q}%`
      )
    }

    // Get stock levels for all found products
    const results: SearchResult[] = []
    for (const product of products) {
      const stockRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("onHand"), 0) as stock FROM "InventoryItem" WHERE "productId" = $1`,
        product.id
      )
      const stock = Number(stockRows[0]?.stock || 0)

      results.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        displayName: product.displayName || product.name,
        category: product.category,
        basePrice: Number(product.basePrice) || 0,
        stock,
      })
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Quick order search error:', error)
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    )
  }
}
