export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/pricing/competitors — List competitor prices.
 * POST /api/agent-hub/pricing/competitors — Log a competitor price observation.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const category = sp.get('category')

    let where = ''
    const params: any[] = []
    if (category) { where = `WHERE "productCategory" = $1`; params.push(category) }

    const prices: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CompetitorPrice"
      ${where}
      ORDER BY "checkedAt" DESC
      LIMIT 100
    `, ...params)

    // Summary by competitor
    const byCompetitor: any[] = await prisma.$queryRawUnsafe(`
      SELECT "competitorName",
             COUNT(*)::int AS "pricePoints",
             ROUND(AVG("price")::numeric, 2)::float AS "avgPrice",
             MAX("checkedAt") AS "lastChecked"
      FROM "CompetitorPrice"
      GROUP BY "competitorName"
      ORDER BY COUNT(*) DESC
    `)

    return NextResponse.json({
      data: prices.map(p => ({ ...p, price: Number(p.price) })),
      byCompetitor,
      total: prices.length,
    })
  } catch (error) {
    console.error('GET /api/agent-hub/pricing/competitors error:', error)
    return NextResponse.json({ error: 'Failed to fetch competitor prices' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const entries = Array.isArray(body) ? body : [body]
    const created: string[] = []

    for (const entry of entries) {
      const { productCategory, competitorName, productName, price, source, notes } = entry
      if (!productCategory || !competitorName || !price) continue

      const id = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CompetitorPrice" ("id", "productCategory", "competitorName", "productName", "price", "source", "notes", "checkedAt", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, id, productCategory, competitorName, productName || null, price, source || null, notes || null)
      created.push(id)
    }

    return NextResponse.json({ created: created.length }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/pricing/competitors error:', error)
    return NextResponse.json({ error: 'Failed to log competitor price' }, { status: 500 })
  }
}
