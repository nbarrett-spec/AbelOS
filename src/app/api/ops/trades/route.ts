export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/trades — List trades with search and filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const search = sp.get('search')
    const tradeType = sp.get('tradeType')
    const verified = sp.get('verified')
    const city = sp.get('city')
    const minRating = sp.get('minRating')
    const page = parseInt(sp.get('page') || '1')
    const limit = Math.min(100, parseInt(sp.get('limit') || '50'))
    const offset = (page - 1) * limit

    const conditions: string[] = ['t."active" = true']
    const params: any[] = []
    let paramIdx = 1

    if (search) {
      conditions.push(`(t."companyName" ILIKE $${paramIdx} OR t."contactName" ILIKE $${paramIdx} OR t."tradeType" ILIKE $${paramIdx})`)
      params.push(`%${search}%`)
      paramIdx++
    }
    if (tradeType) { conditions.push(`t."tradeType" = $${paramIdx++}`); params.push(tradeType) }
    if (verified === 'true') { conditions.push(`t."verified" = true`) }
    if (city) { conditions.push(`t."city" ILIKE $${paramIdx++}`); params.push(`%${city}%`) }
    if (minRating) { conditions.push(`t."rating" >= $${paramIdx++}`); params.push(parseFloat(minRating)) }

    const where = `WHERE ${conditions.join(' AND ')}`

    const trades: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.*,
              s."firstName" || ' ' || s."lastName" as "addedByName"
       FROM "Trade" t
       LEFT JOIN "Staff" s ON s.id = t."addedById"
       ${where}
       ORDER BY t."rating" DESC, t."reviewCount" DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      ...params, limit, offset
    )

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM "Trade" t ${where}`,
      ...params
    )

    // Get trade type counts for filters
    const typeCounts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "tradeType", COUNT(*)::int as count
       FROM "Trade" WHERE "active" = true
       GROUP BY "tradeType" ORDER BY count DESC`
    )

    return NextResponse.json({
      trades,
      total: countResult[0]?.total || 0,
      page,
      totalPages: Math.ceil((countResult[0]?.total || 0) / limit),
      tradeTypes: typeCounts,
    })
  } catch (error: any) {
    console.error('[Trades GET]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// POST /api/ops/trades — Add a new trade to the network
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Trades', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const {
      companyName, tradeType, contactName, email, phone, website,
      address, city, state, zip, serviceArea, description, licenses, insurance, insuranceExpiry,
    } = body

    if (!companyName || !tradeType) {
      return NextResponse.json({ error: 'companyName and tradeType are required' }, { status: 400 })
    }

    const staffId = request.headers.get('x-staff-id')

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Trade" (
        "id", "companyName", "tradeType", "contactName", "email", "phone", "website",
        "address", "city", "state", "zip", "serviceArea", "description",
        "licenses", "insurance", "insuranceExpiry", "addedById"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11::text[], $12,
        $13::jsonb, $14::jsonb, $15::date, $16
      ) RETURNING *`,
      companyName, tradeType, contactName || null, email || null, phone || null, website || null,
      address || null, city || null, state || null, zip || null,
      serviceArea || [], description || null,
      JSON.stringify(licenses || []), JSON.stringify(insurance || {}),
      insuranceExpiry || null, staffId || null
    )

    return NextResponse.json({ trade: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[Trades POST]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
