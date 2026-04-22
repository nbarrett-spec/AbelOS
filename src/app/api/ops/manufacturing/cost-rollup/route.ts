export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/manufacturing/cost-rollup
 * Shows the cost comparison: stored Product.cost vs calculated BOM cost
 * Query: ?parentId=xxx (single) or no params (all parents)
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const parentId = searchParams.get('parentId')

    if (parentId) {
      // Single product cost breakdown
      const result = await getProductCostBreakdown(parentId)
      return safeJson(result)
    }

    // All parent products: compare stored cost vs BOM-calculated cost
    const comparison: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        p.cost as "storedCost",
        p."basePrice",
        COALESCE(p."laborCost", 0)::float as "laborCost",
        COALESCE(p."overheadCost", 0)::float as "overheadCost",
        COALESCE(bom.component_cost, 0)::float as "componentCost",
        (COALESCE(bom.component_cost, 0) + COALESCE(p."laborCost", 0) + COALESCE(p."overheadCost", 0))::float as "calculatedCost",
        (p.cost - (COALESCE(bom.component_cost, 0) + COALESCE(p."laborCost", 0) + COALESCE(p."overheadCost", 0)))::float as "costDrift",
        bom.component_count::int as "componentCount",
        CASE WHEN p."basePrice" > 0
          THEN ROUND(((p."basePrice" - (COALESCE(bom.component_cost, 0) + COALESCE(p."laborCost", 0) + COALESCE(p."overheadCost", 0))) / p."basePrice" * 100)::numeric, 1)::float
          ELSE 0 END as "trueMarginPct",
        CASE WHEN p."basePrice" > 0
          THEN ROUND(((p."basePrice" - p.cost) / p."basePrice" * 100)::numeric, 1)::float
          ELSE 0 END as "storedMarginPct"
      FROM "Product" p
      JOIN (
        SELECT
          be."parentId",
          SUM(cp.cost * be.quantity)::float as component_cost,
          COUNT(*)::int as component_count
        FROM "BomEntry" be
        JOIN "Product" cp ON be."componentId" = cp.id
        GROUP BY be."parentId"
      ) bom ON bom."parentId" = p.id
      ORDER BY ABS(p.cost - (COALESCE(bom.component_cost, 0) + COALESCE(p."laborCost", 0) + COALESCE(p."overheadCost", 0))) DESC
      LIMIT 500
    `)

    // Summary stats
    const totalProducts = comparison.length
    const drifted = comparison.filter(c => Math.abs(c.costDrift) > 1.0)
    const zeroCost = comparison.filter(c => c.storedCost === 0)
    const avgDrift = comparison.length > 0
      ? comparison.reduce((sum, c) => sum + Math.abs(c.costDrift), 0) / comparison.length
      : 0

    return safeJson({
      products: comparison,
      summary: {
        totalParentsWithBOM: totalProducts,
        productsWithCostDrift: drifted.length,
        productsWithZeroCost: zeroCost.length,
        avgAbsoluteDrift: Math.round(avgDrift * 100) / 100,
      },
    })
  } catch (error: any) {
    console.error('[Cost Rollup GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get cost rollup'},
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/manufacturing/cost-rollup
 * Recalculate and sync Product.cost from BOM components for one or all parent products.
 *
 * Body: { productId?: string, syncAll?: boolean, dryRun?: boolean }
 *   - productId: sync one product
 *   - syncAll: sync ALL products that have BOMs
 *   - dryRun: show what would change without writing
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { productId, syncAll, dryRun } = body

    if (!productId && !syncAll) {
      return NextResponse.json(
        { error: 'Either productId or syncAll=true required' },
        { status: 400 }
      )
    }

    // Get all parent products with BOM-calculated costs
    let whereClause = ''
    const params: any[] = []
    if (productId) {
      whereClause = 'AND p.id = $1'
      params.push(productId)
    }

    const products: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.cost as "storedCost",
        p."basePrice",
        COALESCE(p."laborCost", 0)::float as "laborCost",
        COALESCE(p."overheadCost", 0)::float as "overheadCost",
        SUM(cp.cost * be.quantity)::float as "componentCost"
      FROM "Product" p
      JOIN "BomEntry" be ON be."parentId" = p.id
      JOIN "Product" cp ON be."componentId" = cp.id
      WHERE 1=1 ${whereClause}
      GROUP BY p.id, p.sku, p.name, p.cost, p."basePrice", p."laborCost", p."overheadCost"
    `, ...params)

    const results: any[] = []
    let updated = 0

    for (const prod of products) {
      const newCost = prod.componentCost + prod.laborCost + prod.overheadCost
      const oldCost = prod.storedCost
      const changed = Math.abs(newCost - oldCost) > 0.001

      const entry: any = {
        id: prod.id,
        sku: prod.sku,
        name: prod.name,
        oldCost,
        newCost: Math.round(newCost * 100) / 100,
        componentCost: prod.componentCost,
        laborCost: prod.laborCost,
        overheadCost: prod.overheadCost,
        changed,
        diff: Math.round((newCost - oldCost) * 100) / 100,
      }

      if (prod.basePrice > 0) {
        entry.oldMarginPct = Math.round(((prod.basePrice - oldCost) / prod.basePrice) * 10000) / 100
        entry.newMarginPct = Math.round(((prod.basePrice - newCost) / prod.basePrice) * 10000) / 100
      }

      if (changed && !dryRun) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Product"
          SET cost = $1, "updatedAt" = NOW()
          WHERE id = $2
        `, Math.round(newCost * 100) / 100, prod.id)
        updated++
        entry.synced = true
      }

      results.push(entry)
    }

    return safeJson({
      success: true,
      dryRun: !!dryRun,
      total: products.length,
      changed: results.filter(r => r.changed).length,
      updated,
      results: productId ? results : results.filter(r => r.changed), // Only show changed for bulk
    })
  } catch (error: any) {
    console.error('[Cost Rollup POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to sync costs'},
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: detailed cost breakdown for a single product
// ──────────────────────────────────────────────────────────────────────────
async function getProductCostBreakdown(productId: string) {
  const product: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, sku, name, category, cost, "basePrice", "minMargin",
      COALESCE("laborCost", 0)::float as "laborCost",
      COALESCE("overheadCost", 0)::float as "overheadCost"
    FROM "Product" WHERE id = $1
  `, productId)

  if (product.length === 0) return { error: 'Product not found' }

  const prod = product[0]

  const components: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      be.id as "bomEntryId",
      be."componentType",
      be.quantity,
      cp.id as "componentId",
      cp.sku,
      cp.name,
      cp.cost as "unitCost",
      (cp.cost * be.quantity)::float as "lineCost"
    FROM "BomEntry" be
    JOIN "Product" cp ON be."componentId" = cp.id
    WHERE be."parentId" = $1
    ORDER BY
      CASE be."componentType"
        WHEN 'Slab' THEN 1 WHEN 'Jamb' THEN 2 WHEN 'Casing' THEN 3
        WHEN 'Hinge' THEN 4 WHEN 'Lockset' THEN 5 ELSE 99
      END
  `, productId)

  const componentCostTotal = components.reduce((sum, c) => sum + c.lineCost, 0)
  const calculatedCost = componentCostTotal + prod.laborCost + prod.overheadCost

  return {
    product: prod,
    components,
    costBreakdown: {
      componentCost: Math.round(componentCostTotal * 100) / 100,
      laborCost: prod.laborCost,
      overheadCost: prod.overheadCost,
      calculatedTotal: Math.round(calculatedCost * 100) / 100,
      storedCost: prod.cost,
      drift: Math.round((prod.cost - calculatedCost) * 100) / 100,
    },
    margin: prod.basePrice > 0 ? {
      storedMarginPct: Math.round(((prod.basePrice - prod.cost) / prod.basePrice) * 10000) / 100,
      trueMarginPct: Math.round(((prod.basePrice - calculatedCost) / prod.basePrice) * 10000) / 100,
      basePrice: prod.basePrice,
    } : null,
  }
}
