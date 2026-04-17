export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/suppliers — List all suppliers
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || ''
    const active = searchParams.get('active')

    let where = 'WHERE 1=1'
    const params: any[] = []
    let idx = 1

    if (search) {
      where += ` AND (s."name" ILIKE $${idx} OR s."code" ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    if (type) {
      where += ` AND s."type" = $${idx}`
      params.push(type)
      idx++
    }
    if (active === 'true') {
      where += ` AND s."active" = true`
    } else if (active === 'false') {
      where += ` AND s."active" = false`
    }

    const suppliers: any[] = await prisma.$queryRawUnsafe(
      `SELECT s.*,
        (SELECT COUNT(*)::int FROM "SupplierProduct" sp WHERE sp."supplierId" = s.id) as "productCount"
       FROM "Supplier" s
       ${where}
       ORDER BY s."name" ASC`,
      ...params
    )

    // Get summary stats
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE "active" = true)::int as "activeCount",
        COUNT(*) FILTER (WHERE "type" = 'MANUFACTURER')::int as "manufacturers",
        COUNT(*) FILTER (WHERE "type" = 'DISTRIBUTOR')::int as "distributors"
       FROM "Supplier"`
    )

    return NextResponse.json({
      suppliers,
      stats: stats[0] || { total: 0, activeCount: 0, manufacturers: 0, distributors: 0 },
    })
  } catch (error: any) {
    console.error('[Suppliers GET]', error)
    if (error?.message?.includes('does not exist') || error?.message?.includes('relation')) {
      return NextResponse.json({
        suppliers: [],
        stats: { total: 0, activeCount: 0, manufacturers: 0, distributors: 0 },
        migrationRequired: true,
        message: 'Supplier table not found — run the product-expansion migration first',
      })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/suppliers — Create a new supplier
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Supplier', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const {
      name, code, type, contactName, email, phone, website,
      address, city, state, zip, categories, paymentTerms,
      leadTimeDays, minOrderAmount, freightPolicy, notes,
    } = body

    if (!name || !code) {
      return NextResponse.json({ error: 'Name and code are required' }, { status: 400 })
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Supplier" (
        "id", "name", "code", "type", "contactName", "email", "phone", "website",
        "address", "city", "state", "zip", "categories", "paymentTerms",
        "leadTimeDays", "minOrderAmount", "freightPolicy", "notes"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::text[], $13,
        $14, $15, $16, $17
      )`,
      name,
      code.toUpperCase(),
      type || 'DISTRIBUTOR',
      contactName || null,
      email || null,
      phone || null,
      website || null,
      address || null,
      city || null,
      state || null,
      zip || null,
      categories || [],
      paymentTerms || 'NET_30',
      leadTimeDays || 14,
      minOrderAmount || 0,
      freightPolicy || null,
      notes || null
    )

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error: any) {
    if (error?.message?.includes('duplicate key') || error?.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'A supplier with this code already exists' }, { status: 409 })
    }
    console.error('[Suppliers POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
