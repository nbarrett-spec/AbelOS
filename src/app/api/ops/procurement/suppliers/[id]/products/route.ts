export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/procurement/suppliers/[id]/products — List supplier products
// POST /api/ops/procurement/suppliers/[id]/products — Add product to supplier
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const products = await prisma.$queryRawUnsafe(`
      SELECT sp.*, p."name" as "catalogName", p."basePrice", p."cost" as "catalogCost",
        s."dutyRate", s."freightCostPct",
        (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) as "landedCost"
      FROM "SupplierProduct" sp
      LEFT JOIN "Product" p ON sp."productId" = p."id"
      JOIN "Supplier" s ON sp."supplierId" = s."id"
      WHERE sp."supplierId" = $1 AND sp."active" = true
      ORDER BY sp."category", sp."productName"
    `, params.id)

    return NextResponse.json({ products })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load supplier products' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { productId, sku, productName, category, unitCost, moq, leadTimeDays, packSize, notes } = body

    if (!productName || !category || !unitCost) {
      return NextResponse.json({ error: 'Product name, category, and unit cost required' }, { status: 400 })
    }

    const result = await prisma.$queryRawUnsafe(`
      INSERT INTO "SupplierProduct" ("supplierId", "productId", "sku", "productName", "category", "unitCost", "moq", "leadTimeDays", "packSize", "notes", "lastQuoteDate")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `, params.id, productId || null, sku || null, productName, category, unitCost, moq || 1,
       leadTimeDays || 14, packSize || 1, notes || null) as any[]

    return NextResponse.json({ product: result[0] }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add supplier product', details: String(error) }, { status: 500 })
  }
}
