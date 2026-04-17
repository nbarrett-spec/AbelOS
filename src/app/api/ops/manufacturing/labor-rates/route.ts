export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// Labor & Overhead Rate Management
// Sets laborCost and overheadCost on Products by category, using rates derived from payroll analysis
// These flow into bom_cost() → pricing engine → margin calculations → executive dashboards

// GET: Show current labor/overhead rates by category
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.category,
        COUNT(*)::int as "productCount",
        ROUND(AVG(p."laborCost")::numeric, 2)::float as "avgLaborCost",
        ROUND(AVG(p."overheadCost")::numeric, 2)::float as "avgOverheadCost",
        ROUND(AVG(p."laborCost" + p."overheadCost")::numeric, 2)::float as "avgTotalLabor",
        COUNT(CASE WHEN p."laborCost" > 0 THEN 1 END)::int as "hasLabor",
        COUNT(CASE WHEN p."overheadCost" > 0 THEN 1 END)::int as "hasOverhead",
        COUNT(CASE WHEN bom_cost(p.id) IS NOT NULL THEN 1 END)::int as "hasBOM",
        ROUND(AVG(COALESCE(bom_cost(p.id), p.cost))::numeric, 2)::float as "avgEffectiveCost",
        ROUND(AVG(p."basePrice")::numeric, 2)::float as "avgBasePrice"
      FROM "Product" p
      WHERE p.active = true
      GROUP BY p.category
      ORDER BY "productCount" DESC
    `)

    return safeJson({ rates })
  } catch (error: any) {
    console.error('Labor rates GET error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}

// POST: Apply labor/overhead rates by category
// Body: { rates: [{ category: string, laborCost: number, overheadCost: number }], dryRun?: boolean }
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { rates, dryRun } = body

    if (!rates || !Array.isArray(rates)) {
      return safeJson({ error: 'rates array required: [{ category, laborCost, overheadCost }]' }, { status: 400 })
    }

    const results = []

    for (const rate of rates) {
      const { category, laborCost, overheadCost } = rate
      if (!category) continue

      // Preview what would change
      const preview: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int as "productCount",
          ROUND(AVG(p."laborCost")::numeric, 2)::float as "currentAvgLabor",
          ROUND(AVG(p."overheadCost")::numeric, 2)::float as "currentAvgOverhead"
        FROM "Product" p
        WHERE p.category = $1 AND p.active = true
      `, category)

      const info = preview[0] || { productCount: 0 }

      if (!dryRun) {
        // Apply labor cost if provided
        if (laborCost !== undefined && laborCost !== null) {
          await prisma.$executeRawUnsafe(`
            UPDATE "Product" SET "laborCost" = $1, "updatedAt" = NOW()
            WHERE category = $2 AND active = true
          `, laborCost, category)
        }

        // Apply overhead cost if provided
        if (overheadCost !== undefined && overheadCost !== null) {
          await prisma.$executeRawUnsafe(`
            UPDATE "Product" SET "overheadCost" = $1, "updatedAt" = NOW()
            WHERE category = $2 AND active = true
          `, overheadCost, category)
        }
      }

      results.push({
        category,
        productsUpdated: info.productCount,
        laborCost: laborCost ?? null,
        overheadCost: overheadCost ?? null,
        previousAvgLabor: info.currentAvgLabor,
        previousAvgOverhead: info.currentAvgOverhead,
      })
    }

    return safeJson({
      success: true,
      dryRun: !!dryRun,
      results,
      totalProductsAffected: results.reduce((s, r) => s + r.productsUpdated, 0),
      note: dryRun
        ? 'Dry run — no changes made. Remove dryRun to apply.'
        : 'Labor and overhead costs updated. bom_cost() will now include these in all margin calculations.',
    })
  } catch (error: any) {
    console.error('Labor rates POST error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}
