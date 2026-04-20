export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Margin analysis is restricted to roles that need cost/margin visibility
const MARGIN_ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'ESTIMATOR', 'PURCHASING']

function canAccessMargins(request: NextRequest): boolean {
  const roles = (request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || '')
    .split(',').map(r => r.trim())
  return roles.some(r => MARGIN_ALLOWED_ROLES.includes(r))
}

// GET /api/ops/accounts/[id]/margins
// Returns margin targets, category breakdowns, and actual performance
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Additional role check — margin data is sensitive
  if (!canAccessMargins(request)) {
    return NextResponse.json(
      { error: 'Access denied. Margin analysis requires ADMIN, MANAGER, ESTIMATOR, or PURCHASING role.' },
      { status: 403 }
    )
  }

  const builderId = params.id

  try {
    // 1. Get blended margin target
    const targetRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "AccountMarginTarget"
      WHERE "builderId" = $1
    `, builderId)
    const marginTarget = targetRows[0] || null

    // 2. Get per-category margin targets
    const categoryTargets: any[] = await prisma.$queryRawUnsafe(`
      SELECT acm.*, cmd."sortOrder"
      FROM "AccountCategoryMargin" acm
      LEFT JOIN "CategoryMarginDefault" cmd ON cmd."category" = acm."category"
      WHERE acm."builderId" = $1
      ORDER BY COALESCE(cmd."sortOrder", 999), acm."category"
    `, builderId)

    // 3. Get category defaults (for categories not yet customized)
    const defaults: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CategoryMarginDefault"
      WHERE "active" = true
      ORDER BY "sortOrder"
    `)

    // 4. Calculate actual margins from order data
    const actualMargins: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."category",
        COUNT(DISTINCT oi.id)::int as "lineCount",
        ROUND(SUM(oi."lineTotal")::numeric, 2) AS "revenue",
        ROUND(SUM(oi."quantity" * p."cost")::numeric, 2) AS "cogs",
        CASE
          WHEN SUM(oi."lineTotal") > 0
          THEN ROUND(((SUM(oi."lineTotal") - SUM(oi."quantity" * p."cost")) / SUM(oi."lineTotal") * 100)::numeric, 2)
          ELSE 0
        END AS "actualMarginPct"
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p.id
      JOIN "Order" o ON oi."orderId" = o.id
      WHERE o."builderId" = $1
        AND o."status" != 'CANCELLED'::"OrderStatus"
      GROUP BY p."category"
      ORDER BY SUM(oi."lineTotal") DESC
    `, builderId)

    // 5. Calculate overall blended actual margin
    const blendedActual: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(DISTINCT o.id)::int as "orderCount",
        ROUND(COALESCE(SUM(oi."lineTotal"), 0)::numeric, 2) AS "totalRevenue",
        ROUND(COALESCE(SUM(oi."quantity" * p."cost"), 0)::numeric, 2) AS "totalCOGS",
        CASE
          WHEN SUM(oi."lineTotal") > 0
          THEN ROUND(((SUM(oi."lineTotal") - SUM(oi."quantity" * p."cost")) / SUM(oi."lineTotal") * 100)::numeric, 2)
          ELSE 0
        END AS "blendedMarginPct"
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p.id
      JOIN "Order" o ON oi."orderId" = o.id
      WHERE o."builderId" = $1
        AND o."status" != 'CANCELLED'::"OrderStatus"
    `, builderId)

    // 6. Get custom pricing count
    const pricingCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as "count"
      FROM "BuilderPricing"
      WHERE "builderId" = $1
    `, builderId)

    // Merge category targets with defaults
    const targetMap = new Map(categoryTargets.map((ct: any) => [ct.category, ct]))
    const mergedCategories = defaults.map((d: any) => {
      const custom = targetMap.get(d.category)
      return {
        category: d.category,
        categoryType: custom?.categoryType || d.categoryType,
        targetMargin: custom ? Number(custom.targetMargin) : Number(d.defaultTargetMargin),
        minMargin: custom ? Number(custom.minMargin) : Number(d.defaultMinMargin),
        isCustom: !!custom,
        sortOrder: d.sortOrder,
        notes: custom?.notes || null,
      }
    })

    // Add actual margin data to each category
    const actualMap = new Map(actualMargins.map((a: any) => [a.category, a]))
    const categoriesWithActuals = mergedCategories.map((cat: any) => {
      const actual = actualMap.get(cat.category)
      return {
        ...cat,
        actualMarginPct: actual ? Number(actual.actualMarginPct) : null,
        revenue: actual ? Number(actual.revenue) : 0,
        cogs: actual ? Number(actual.cogs) : 0,
        lineCount: actual ? Number(actual.lineCount) : 0,
        status: actual
          ? Number(actual.actualMarginPct) >= cat.targetMargin * 100
            ? 'ON_TARGET'
            : Number(actual.actualMarginPct) >= cat.minMargin * 100
              ? 'BELOW_TARGET'
              : 'CRITICAL'
          : 'NO_DATA',
      }
    })

    const blended = blendedActual[0] || {}

    return NextResponse.json({
      builderId,
      marginTarget: marginTarget
        ? {
            targetBlendedMargin: Number(marginTarget.targetBlendedMargin),
            notes: marginTarget.notes,
            updatedAt: marginTarget.updatedAt,
          }
        : null,
      blendedActual: {
        orderCount: Number(blended.orderCount || 0),
        totalRevenue: Number(blended.totalRevenue || 0),
        totalCOGS: Number(blended.totalCOGS || 0),
        blendedMarginPct: Number(blended.blendedMarginPct || 0),
      },
      categories: categoriesWithActuals,
      customPricingCount: Number(pricingCount[0]?.count || 0),
    })
  } catch (error: any) {
    console.error('GET /api/ops/accounts/[id]/margins error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/accounts/[id]/margins
// Set or update margin targets for a builder
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Margin target setting restricted to privileged roles
  if (!canAccessMargins(request)) {
    return NextResponse.json(
      { error: 'Access denied. Margin target updates require ADMIN, MANAGER, ESTIMATOR, or PURCHASING role.' },
      { status: 403 }
    )
  }

  const builderId = params.id

  try {
    // Audit log
    audit(request, 'CREATE', 'Account', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { targetBlendedMargin, categories, notes } = body

    // Upsert blended margin target
    if (targetBlendedMargin !== undefined) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AccountMarginTarget" ("builderId", "targetBlendedMargin", "notes")
        VALUES ($1, $2, $3)
        ON CONFLICT ("builderId")
        DO UPDATE SET
          "targetBlendedMargin" = $2,
          "notes" = $3,
          "updatedAt" = CURRENT_TIMESTAMP
      `, builderId, targetBlendedMargin, notes || null)
    }

    // Upsert per-category margin targets
    if (categories && Array.isArray(categories)) {
      for (const cat of categories) {
        if (!cat.category) continue
        await prisma.$executeRawUnsafe(`
          INSERT INTO "AccountCategoryMargin" ("builderId", "category", "categoryType", "targetMargin", "minMargin", "notes")
          VALUES ($1, $2, $3::\"CategoryType\", $4, $5, $6)
          ON CONFLICT ("builderId", "category")
          DO UPDATE SET
            "categoryType" = $3::\"CategoryType\",
            "targetMargin" = $4,
            "minMargin" = $5,
            "notes" = $6,
            "updatedAt" = CURRENT_TIMESTAMP
        `, builderId, cat.category, cat.categoryType || 'CORE', cat.targetMargin || 0.25, cat.minMargin || 0.15, cat.notes || null)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('POST /api/ops/accounts/[id]/margins error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
