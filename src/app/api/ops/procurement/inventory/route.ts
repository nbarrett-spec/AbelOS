export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/procurement/inventory — List inventory with alerts
// POST /api/ops/procurement/inventory — Sync products into inventory
// PATCH /api/ops/procurement/inventory — Update inventory item
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const status = searchParams.get('status') // LOW_STOCK, OUT_OF_STOCK, OVERSTOCK, IN_STOCK
    const search = searchParams.get('search')
    const sortBy = searchParams.get('sort') || 'daysOfSupply'

    // Parameterized query to prevent SQL injection
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (category) { conditions.push(`i."category" = $${idx}`); params.push(category); idx++ }
    if (search) { conditions.push(`(i."productName" ILIKE $${idx} OR i."sku" ILIKE $${idx})`); params.push(`%${search}%`); idx++ }
    if (status === 'LOW_STOCK') conditions.push(`i."onHand" <= i."reorderPoint" AND i."onHand" > 0`)
    if (status === 'OUT_OF_STOCK') conditions.push(`i."onHand" = 0`)
    if (status === 'OVERSTOCK') conditions.push(`i."onHand" > i."maxStock"`)
    if (status === 'IN_STOCK') conditions.push(`i."onHand" > i."reorderPoint"`)

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Safe sort mapping (no user input in ORDER BY)
    const sortMap: Record<string, string> = {
      daysOfSupply: `i."daysOfSupply" ASC`,
      name: `i."productName" ASC`,
      value: `(i."onHand" * i."unitCost") DESC`,
      usage: `i."avgDailyUsage" DESC`,
    }
    const orderBy = `ORDER BY ${sortMap[sortBy] || sortMap.daysOfSupply}`

    const inventory = await prisma.$queryRawUnsafe(`
      SELECT i.*,
        CASE
          WHEN i."onHand" = 0 THEN 'OUT_OF_STOCK'
          WHEN i."onHand" <= i."safetyStock" THEN 'CRITICAL'
          WHEN i."onHand" <= i."reorderPoint" THEN 'LOW_STOCK'
          WHEN i."onHand" > i."maxStock" THEN 'OVERSTOCK'
          ELSE 'IN_STOCK'
        END as "stockStatus",
        CASE
          WHEN i."avgDailyUsage" > 0 THEN ROUND((i."onHand"::numeric / i."avgDailyUsage"), 1)
          ELSE 999
        END as "calcDaysOfSupply"
      FROM "InventoryItem" i
      ${where}
      ${orderBy}
    `, ...params)

    // Summary stats
    const stats = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalItems",
        COALESCE(SUM(i."onHand" * i."unitCost"), 0) as "totalValue",
        COUNT(*) FILTER (WHERE i."onHand" <= i."reorderPoint" AND i."onHand" > 0)::int as "lowStockCount",
        COUNT(*) FILTER (WHERE i."onHand" = 0)::int as "outOfStockCount",
        COUNT(*) FILTER (WHERE i."onHand" > i."maxStock")::int as "overstockCount",
        COUNT(*) FILTER (WHERE i."onHand" <= i."safetyStock" AND i."onHand" > 0)::int as "criticalCount"
      FROM "InventoryItem" i
    `) as any[]

    return NextResponse.json({ inventory, stats: stats[0] })
  } catch (error) {
    console.error('Inventory list error:', error)
    return NextResponse.json({ error: 'Failed to load inventory', details: String((error as any)?.message || error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Procurement', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()

    if (body.action === 'sync_products') {
      // Sync all active products into inventory if not already there
      const result = await prisma.$queryRawUnsafe(`
        INSERT INTO "InventoryItem" ("sku", "productName", "category", "productId", "unitCost", "onHand")
        SELECT p."sku", p."name", p."category", p."id", p."cost", 0
        FROM "Product" p
        WHERE p."active" = true
          AND NOT EXISTS (SELECT 1 FROM "InventoryItem" i WHERE i."productId" = p."id")
        RETURNING "id"
      `) as any[]

      return NextResponse.json({ synced: result.length, message: `${result.length} products synced to inventory` })
    }

    // Manual add
    const { sku, productName, category, productId, onHand, unitCost, reorderPoint, reorderQty, safetyStock, maxStock } = body

    const result = await prisma.$queryRawUnsafe(`
      INSERT INTO "InventoryItem" ("sku", "productName", "category", "productId", "onHand", "unitCost", "reorderPoint", "reorderQty", "safetyStock", "maxStock")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, sku, productName, category, productId || null, onHand || 0, unitCost || 0,
       reorderPoint || 10, reorderQty || 50, safetyStock || 5, maxStock || 200) as any[]

    return NextResponse.json({ item: result[0] }, { status: 201 })
  } catch (error) {
    console.error('Inventory create error:', error)
    return NextResponse.json({ error: 'Failed to update inventory', details: String(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Procurement', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const { id, onHand, committed, onOrder, reorderPoint, reorderQty, safetyStock, maxStock, avgDailyUsage } = body

    const fields: string[] = []
    const values: any[] = []
    let idx = 1

    if (onHand !== undefined) { fields.push(`"onHand" = $${idx}`); values.push(onHand); idx++ }
    if (committed !== undefined) { fields.push(`"committed" = $${idx}`); values.push(committed); idx++ }
    if (onOrder !== undefined) { fields.push(`"onOrder" = $${idx}`); values.push(onOrder); idx++ }
    if (reorderPoint !== undefined) { fields.push(`"reorderPoint" = $${idx}`); values.push(reorderPoint); idx++ }
    if (reorderQty !== undefined) { fields.push(`"reorderQty" = $${idx}`); values.push(reorderQty); idx++ }
    if (safetyStock !== undefined) { fields.push(`"safetyStock" = $${idx}`); values.push(safetyStock); idx++ }
    if (maxStock !== undefined) { fields.push(`"maxStock" = $${idx}`); values.push(maxStock); idx++ }
    if (avgDailyUsage !== undefined) { fields.push(`"avgDailyUsage" = $${idx}`); values.push(avgDailyUsage); idx++ }

    fields.push(`"updatedAt" = NOW()`)

    // Recalc available = onHand - committed
    fields.push(`"available" = COALESCE($${idx}, "onHand") - COALESCE($${idx + 1}, "committed")`)
    values.push(onHand ?? null, committed ?? null)
    idx += 2

    // Recalc days of supply
    fields.push(`"daysOfSupply" = CASE WHEN COALESCE($${idx}, "avgDailyUsage", 0) > 0 THEN COALESCE($${idx + 1}, "onHand") / COALESCE($${idx}, "avgDailyUsage", 1) ELSE 999 END`)
    values.push(avgDailyUsage || null, onHand || null)
    idx += 2

    values.push(id)

    const result = await prisma.$queryRawUnsafe(`
      UPDATE "InventoryItem" SET ${fields.join(', ')} WHERE "id" = $${idx} RETURNING *
    `, ...values) as any[]

    return NextResponse.json({ item: result[0] })
  } catch (error) {
    console.error('Inventory update error:', error)
    return NextResponse.json({ error: 'Failed to update inventory item' }, { status: 500 })
  }
}
