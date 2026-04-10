export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mapCategory } from '@/lib/product-categories'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/products/cleanup — Remap all product categories
// GET  /api/ops/products/cleanup — Preview the mapping (dry run)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Get all distinct raw categories
    const rawCategories: any[] = await prisma.$queryRawUnsafe(
      `SELECT "category", COUNT(*)::int AS "count"
       FROM "Product"
       WHERE "active" = true
       GROUP BY "category"
       ORDER BY COUNT(*)::int DESC`
    )

    // Map each to the new taxonomy
    const mapping = rawCategories.map(raw => {
      const mapped = mapCategory(raw.category)
      return {
        original: raw.category,
        count: raw.count,
        newCategory: mapped.category,
        newSubcategory: mapped.subcategory,
      }
    })

    // Summarize by new category
    const summary: Record<string, number> = {}
    for (const m of mapping) {
      summary[m.newCategory] = (summary[m.newCategory] || 0) + m.count
    }

    return NextResponse.json({
      mode: 'preview',
      originalCategoryCount: rawCategories.length,
      newCategoryCount: Object.keys(summary).length,
      summary: Object.entries(summary)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, count]) => ({ category: cat, productCount: count })),
      fullMapping: mapping,
    })
  } catch (error: any) {
    console.error('Category cleanup preview error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get all distinct raw categories
    const rawCategories: any[] = await prisma.$queryRawUnsafe(
      `SELECT "category", COUNT(*)::int AS "count"
       FROM "Product"
       WHERE "active" = true
       GROUP BY "category" ORDER BY COUNT(*)::int DESC`
    )

    let totalUpdated = 0
    const updates: any[] = []

    // Update each category group
    for (const raw of rawCategories) {
      const mapped = mapCategory(raw.category)

      // Skip if already correct
      if (raw.category === mapped.category) continue

      const result: any[] = await prisma.$queryRawUnsafe(
        `UPDATE "Product"
         SET "category" = $1, "subcategory" = $2
         WHERE "category" = $3
         RETURNING "id"`,
        mapped.category,
        mapped.subcategory,
        raw.category
      )

      totalUpdated += result.length
      updates.push({
        from: raw.category,
        to: `${mapped.category} / ${mapped.subcategory}`,
        count: result.length,
      })
    }

    // Get new category distribution
    const newCategories: any[] = await prisma.$queryRawUnsafe(
      `SELECT "category", COUNT(*)::int AS "count"
       FROM "Product"
       WHERE "active" = true
       GROUP BY "category"
       ORDER BY COUNT(*)::int DESC`
    )

    return NextResponse.json({
      success: true,
      totalUpdated,
      originalCategoryCount: rawCategories.length,
      newCategoryCount: newCategories.length,
      updates,
      newDistribution: newCategories.map(c => ({
        category: c.category,
        count: c.count,
      })),
    })
  } catch (error: any) {
    console.error('Category cleanup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
