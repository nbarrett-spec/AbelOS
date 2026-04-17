export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/product-categories — List all product categories with hierarchy
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const categories: any[] = await prisma.$queryRawUnsafe(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM "Product" p WHERE p."categoryId" = c.id) as "liveProductCount",
        pc."name" as "parentName"
       FROM "ProductCategory" c
       LEFT JOIN "ProductCategory" pc ON pc.id = c."parentId"
       ORDER BY c."sortOrder" ASC, c."name" ASC`
    )

    // Build tree structure
    const topLevel = categories.filter(c => !c.parentId)
    const children = categories.filter(c => c.parentId)

    const tree = topLevel.map(parent => ({
      ...parent,
      children: children.filter(c => c.parentId === parent.id),
    }))

    return NextResponse.json({
      categories: tree,
      flat: categories,
      totalCategories: categories.length,
      topLevelCount: topLevel.length,
    })
  } catch (error: any) {
    console.error('[ProductCategories GET]', error)
    // Table might not exist yet (migration not run)
    if (error?.message?.includes('does not exist') || error?.message?.includes('relation')) {
      return NextResponse.json({
        categories: [],
        flat: [],
        totalCategories: 0,
        topLevelCount: 0,
        migrationRequired: true,
        message: 'ProductCategory table not found — run the product-expansion migration first',
      })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/product-categories — Create a new category
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'ProductCategories', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { name, slug, parentId, description, icon, sortOrder, marginTarget } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
    }

    const id = 'cat_' + slug.replace(/[^a-z0-9]/g, '_')

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ProductCategory" ("id", "name", "slug", "parentId", "description", "icon", "sortOrder", "marginTarget")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      id, name, slug,
      parentId || null,
      description || null,
      icon || null,
      sortOrder || 0,
      marginTarget || 0.35
    )

    return NextResponse.json({ success: true, id }, { status: 201 })
  } catch (error: any) {
    if (error?.message?.includes('duplicate key') || error?.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'A category with this slug already exists' }, { status: 409 })
    }
    console.error('[ProductCategories POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
