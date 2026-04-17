export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/procurement/suppliers/[id] — Get supplier detail
// PATCH /api/ops/procurement/suppliers/[id] — Update supplier
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const suppliers = await prisma.$queryRawUnsafe(`SELECT * FROM "Supplier" WHERE "id" = $1`, id) as any[]
    if (!suppliers.length) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

    // Get supplier products with price comparisons
    const products = await prisma.$queryRawUnsafe(`
      SELECT sp.*, p."name" as "catalogName", p."basePrice", p."cost" as "catalogCost"
      FROM "SupplierProduct" sp
      LEFT JOIN "Product" p ON sp."productId" = p."id"
      WHERE sp."supplierId" = $1 AND sp."active" = true
      ORDER BY sp."category", sp."productName"
    `, id)

    // Get recent POs
    const recentPOs = await prisma.$queryRawUnsafe(`
      SELECT "id", "poNumber", "status", "totalCost", "expectedDate", "actualDate", "createdAt"
      FROM "PurchaseOrder" WHERE "supplierId" = $1
      ORDER BY "createdAt" DESC LIMIT 10
    `, id)

    return NextResponse.json({ supplier: suppliers[0], products, recentPOs })
  } catch (error) {
    console.error('Supplier detail error:', error)
    return NextResponse.json({ error: 'Failed to load supplier' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Procurement', undefined, { method: 'PATCH' }).catch(() => {})

    const { id } = params
    const body = await request.json()

    const fields: string[] = []
    const values: any[] = []
    let paramIdx = 1

    const allowedFields = [
      'name', 'code', 'type', 'country', 'region', 'contactName', 'contactEmail',
      'contactPhone', 'website', 'address', 'city', 'state', 'zip', 'paymentTerms',
      'currency', 'minOrderValue', 'avgLeadTimeDays', 'shippingMethod', 'dutyRate',
      'freightCostPct', 'qualityRating', 'reliabilityScore', 'onTimeDeliveryPct',
      'categories', 'notes', 'status'
    ]

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'categories') {
          fields.push(`"${field}" = $${paramIdx}::text[]`)
        } else {
          fields.push(`"${field}" = $${paramIdx}`)
        }
        values.push(body[field])
        paramIdx++
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    fields.push(`"updatedAt" = NOW()`)
    values.push(id)

    const result = await prisma.$queryRawUnsafe(`
      UPDATE "Supplier" SET ${fields.join(', ')} WHERE "id" = $${paramIdx} RETURNING *
    `, ...values) as any[]

    return NextResponse.json({ supplier: result[0] })
  } catch (error) {
    console.error('Supplier update error:', error)
    return NextResponse.json({ error: 'Failed to update supplier' }, { status: 500 })
  }
}
