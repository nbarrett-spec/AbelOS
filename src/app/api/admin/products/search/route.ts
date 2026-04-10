export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const limit = parseInt(searchParams.get('limit') || '20')

    let products: any[]
    if (search) {
      products = await prisma.$queryRawUnsafe(
        `SELECT "id", "sku", "name", "category", "basePrice"
         FROM "Product"
         WHERE "active" = true
           AND ("name" ILIKE $1 OR "sku" ILIKE $1)
         ORDER BY "category" ASC, "name" ASC
         LIMIT $2`,
        `%${search}%`,
        limit
      )
    } else {
      products = await prisma.$queryRawUnsafe(
        `SELECT "id", "sku", "name", "category", "basePrice"
         FROM "Product"
         WHERE "active" = true
         ORDER BY "category" ASC, "name" ASC
         LIMIT $1`,
        limit
      )
    }

    return NextResponse.json({ products })
  } catch (error) {
    console.error('Failed to search products:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
