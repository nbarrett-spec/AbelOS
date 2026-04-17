export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/procurement/suppliers — List all vendors (suppliers)
// POST /api/ops/procurement/suppliers — Create a new vendor
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'ACTIVE'
    const search = searchParams.get('search')

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    // Vendor uses boolean "active" not a status enum
    if (status === 'ACTIVE') {
      conditions.push(`v."active" = true`)
    } else if (status === 'INACTIVE') {
      conditions.push(`v."active" = false`)
    }
    // status === 'ALL' — no filter

    if (search) {
      conditions.push(`(v."name" ILIKE $${idx} OR v."code" ILIKE $${idx} OR v."contactName" ILIKE $${idx})`)
      params.push(`%${search}%`); idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const suppliers = await prisma.$queryRawUnsafe(`
      SELECT v.id, v.name, v.code, v."contactName", v.email, v.phone, v.address, v.website,
        v."accountNumber", v."avgLeadDays", v."onTimeRate", v.active,
        v."createdAt", v."updatedAt",
        (SELECT COUNT(*)::int FROM "VendorProduct" vp WHERE vp."vendorId" = v."id") as "productCount",
        (SELECT COUNT(*)::int FROM "PurchaseOrder" po WHERE po."vendorId" = v."id") as "poCount",
        (SELECT COALESCE(SUM(po."total"), 0) FROM "PurchaseOrder" po
         WHERE po."vendorId" = v."id" AND po."status"::text != 'CANCELLED'
         AND po."createdAt" > NOW() - INTERVAL '12 months') as "spend12mo"
      FROM "Vendor" v
      ${where}
      ORDER BY v."name" ASC
    `, ...params)

    return NextResponse.json({ suppliers })
  } catch (error) {
    console.error('Supplier list error:', error)
    return NextResponse.json({ error: 'Failed to load suppliers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Procurement', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { name, code, contactName, contactEmail, email, phone, website, address, accountNumber } = body

    if (!name) {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }

    // Auto-generate code if not provided
    const vendorCode = code || name.substring(0, 3).toUpperCase() + '-' + Date.now().toString(36).toUpperCase()

    const result = await prisma.$queryRawUnsafe(`
      INSERT INTO "Vendor" (
        "name", "code", "contactName", "email", "phone", "website", "address", "accountNumber", "active", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW()
      )
      RETURNING *
    `,
      name, vendorCode,
      contactName || null, contactEmail || email || null, phone || null,
      website || null, address || null, accountNumber || null
    ) as any[]

    return NextResponse.json({ supplier: result[0] }, { status: 201 })
  } catch (error) {
    console.error('Vendor create error:', error)
    return NextResponse.json({ error: 'Failed to create vendor', details: String(error) }, { status: 500 })
  }
}
