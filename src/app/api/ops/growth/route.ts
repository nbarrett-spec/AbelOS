export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Growth Opportunities API
// Identifies and surfaces revenue growth opportunities from live data:
// - Cross-sell opportunities (single/dual-category buyers with multi-category potential)
// - Volume upgrades (growing order frequency)
// - Win-back opportunities (dormant but previously active)
// - Pricing optimization (high-volume, low-margin products)
// - New builder nurture targets (recent low-order accounts)

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const opportunities = await computeOpportunities()
    return NextResponse.json({ opportunities, count: opportunities.length })
  } catch (error: any) {
    console.error('Growth opportunities error:', error)
    return safeJson({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { opportunityId, opportunityType, title, description, builderName, builderIdForTask, estimatedImpact, priority } = body

    if (!opportunityId || !opportunityType) {
      return NextResponse.json({ error: 'opportunityId and opportunityType required' }, { status: 400 })
    }

    // Create an AgentTask from the approved opportunity
    // We need to find a staff member to assign to (default to the first SALES_REP or ops user)
    const staffRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM "Staff"
      WHERE "role"::text IN ('SALES_REP', 'SALES_MANAGER', 'BUSINESS_DEV')
        AND active = true
      ORDER BY "firstName" ASC
      LIMIT 1
    `)

    if (staffRow.length === 0) {
      return NextResponse.json({ error: 'No staff available to assign task' }, { status: 400 })
    }

    const assigneeId = staffRow[0].id

    // Insert the task
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const taskPriority = priority === 'HIGH' ? 'CRITICAL' : priority === 'MEDIUM' ? 'HIGH' : 'MEDIUM'

    await prisma.$executeRawUnsafe(`
      INSERT INTO "Task" (
        id, "assigneeId", "creatorId", "builderId", title, description,
        priority, status, category, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    `, taskId, assigneeId, builderIdForTask || null, title, description, taskPriority, 'TODO', 'SALES')

    return NextResponse.json({
      success: true,
      taskId,
      message: `Growth opportunity approved: ${title}`,
    })
  } catch (error: any) {
    console.error('Growth approval error:', error)
    return safeJson({ error: 'Failed to approve opportunity' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────
// Opportunity Generators
// ──────────────────────────────────────────────────────────────────────

async function computeOpportunities(): Promise<any[]> {
  const opportunities: any[] = []

  // 1. Cross-sell opportunities
  const crossSellRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName",
      COUNT(DISTINCT p.category)::int as "categoriesOrdered",
      COUNT(DISTINCT o.id)::int as "orderCount",
      COALESCE(SUM(o.total), 0)::float as "totalSpend"
    FROM "Builder" b
    JOIN "Order" o ON o."builderId" = b.id AND o."createdAt" >= NOW() - INTERVAL '6 months'
    JOIN "OrderItem" oi ON oi."orderId" = o.id
    JOIN "Product" p ON p.id = oi."productId"
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName"
    HAVING COUNT(DISTINCT p.category) <= 2 AND COUNT(DISTINCT o.id) >= 3
    ORDER BY COUNT(DISTINCT o.id) DESC
  `)

  for (const row of crossSellRows) {
    const impact = row.totalSpend * 0.15 // Assume 15% upside from cross-sell
    opportunities.push({
      id: `crosssell_${row.id}`,
      type: 'CROSS_SELL',
      title: `Cross-sell opportunity: ${row.companyName}`,
      description: `Currently ordering from ${row.categoriesOrdered} product categories across ${row.orderCount} orders. Expand to additional categories.`,
      builderName: row.companyName,
      builderId: row.id,
      estimatedImpact: Math.round(impact),
      effort: 'MEDIUM',
      priority: Math.min(100, Math.floor((impact / 1000) * 10)), // Normalize to 0-100
    })
  }

  // 2. Volume upgrade opportunities
  const volumeRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName",
      COUNT(CASE WHEN o."createdAt" >= NOW() - INTERVAL '90 days' THEN 1 END)::int as "recent",
      COUNT(CASE WHEN o."createdAt" < NOW() - INTERVAL '90 days' AND o."createdAt" >= NOW() - INTERVAL '180 days' THEN 1 END)::int as "prior",
      COALESCE(SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '90 days' THEN o.total ELSE 0 END), 0)::float as "recent_spend"
    FROM "Builder" b
    JOIN "Order" o ON o."builderId" = b.id
    WHERE b.status = 'ACTIVE' AND o."createdAt" >= NOW() - INTERVAL '180 days'
    GROUP BY b.id, b."companyName"
    HAVING COUNT(CASE WHEN o."createdAt" >= NOW() - INTERVAL '90 days' THEN 1 END) > COUNT(CASE WHEN o."createdAt" < NOW() - INTERVAL '90 days' AND o."createdAt" >= NOW() - INTERVAL '180 days' THEN 1 END) * 1.3
    ORDER BY "recent_spend" DESC
  `)

  for (const row of volumeRows) {
    const growth_rate = row.recent > 0 ? ((row.recent - row.prior) / (row.prior || 1)) * 100 : 0
    const impact = row.recent_spend * 0.2 // 20% upside from volume
    opportunities.push({
      id: `volumeupgrade_${row.id}`,
      type: 'VOLUME_UPGRADE',
      title: `Volume acceleration: ${row.companyName}`,
      description: `Orders growing at ${Math.round(growth_rate)}% (${row.recent} vs ${row.prior} orders). Opportunity for volume tier pricing.`,
      builderName: row.companyName,
      builderId: row.id,
      estimatedImpact: Math.round(impact),
      effort: 'LOW',
      priority: Math.min(100, Math.floor((impact / 1000) * 12)),
    })
  }

  // 3. Win-back opportunities
  const winbackRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", MAX(o."createdAt") as "lastOrderDate",
      COALESCE(SUM(o.total), 0)::float as "historicalSpend"
    FROM "Builder" b
    JOIN "Order" o ON o."builderId" = b.id
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName"
    HAVING MAX(o."createdAt") < NOW() - INTERVAL '90 days' AND MAX(o."createdAt") >= NOW() - INTERVAL '12 months'
    ORDER BY "historicalSpend" DESC
    LIMIT 50
  `)

  for (const row of winbackRows) {
    const daysSinceOrder = Math.floor((Date.now() - new Date(row.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
    const impact = row.historicalSpend * 0.25 // 25% upside from reactivation
    opportunities.push({
      id: `winback_${row.id}`,
      type: 'WIN_BACK',
      title: `Win-back opportunity: ${row.companyName}`,
      description: `No orders in ${daysSinceOrder} days. Historical spend: $${row.historicalSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}. Recommend outreach.`,
      builderName: row.companyName,
      builderId: row.id,
      estimatedImpact: Math.round(impact),
      effort: 'MEDIUM',
      priority: Math.min(100, Math.floor((impact / 1000) * 10)),
    })
  }

  // 4. Pricing optimization
  const pricingRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.name, p."basePrice", p.cost,
      ROUND(((p."basePrice" - COALESCE(p.cost, 0)) / NULLIF(p."basePrice", 0) * 100)::numeric, 1)::float as "marginPct",
      COUNT(oi.id)::int as "unitsSold90d"
    FROM "Product" p
    JOIN "OrderItem" oi ON oi."productId" = p.id
    JOIN "Order" o ON o.id = oi."orderId" AND o."createdAt" >= NOW() - INTERVAL '90 days'
    WHERE p.status = 'ACTIVE' AND p."basePrice" > 0
    GROUP BY p.id, p.name, p."basePrice", p.cost
    HAVING COUNT(oi.id) >= 10 AND ((p."basePrice" - COALESCE(p.cost, 0)) / NULLIF(p."basePrice", 0) * 100) < 15
    ORDER BY "unitsSold90d" DESC
    LIMIT 30
  `)

  for (const row of pricingRows) {
    const targetMargin = 25 // Target 25% margin
    const priceIncrease = (row.basePrice * (targetMargin - row.marginPct)) / 100
    const impact = priceIncrease * row.unitsSold90d * 12 / 4 // Annualize 90-day data
    opportunities.push({
      id: `pricingopt_${row.id}`,
      type: 'PRICING_OPT',
      title: `Price optimization: ${row.name}`,
      description: `High volume (${row.unitsSold90d} units/90d), low margin (${row.marginPct}%). Candidate for $${priceIncrease.toFixed(2)} increase.`,
      productName: row.name,
      productId: row.id,
      estimatedImpact: Math.round(impact),
      effort: 'LOW',
      priority: Math.min(100, Math.floor((impact / 1000) * 8)),
    })
  }

  // 5. New builder acquisition/nurture signals
  const newBuilderRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", b."createdAt",
      COUNT(o.id)::int as "orderCount"
    FROM "Builder" b
    LEFT JOIN "Order" o ON o."builderId" = b.id
    WHERE b.status = 'ACTIVE' AND b."createdAt" >= NOW() - INTERVAL '6 months'
    GROUP BY b.id, b."companyName", b."createdAt"
    HAVING COUNT(o.id) <= 2
    ORDER BY b."createdAt" DESC
    LIMIT 30
  `)

  for (const row of newBuilderRows) {
    const daysOld = Math.floor((Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    opportunities.push({
      id: `newbuilder_${row.id}`,
      type: 'NEW_NURTURE',
      title: `New builder onboarding: ${row.companyName}`,
      description: `Account created ${daysOld} days ago. ${row.orderCount} orders so far. Recommend guided onboarding call.`,
      builderName: row.companyName,
      builderId: row.id,
      estimatedImpact: 5000, // Placeholder for new-builder target
      effort: 'LOW',
      priority: 50,
    })
  }

  // Sort by priority descending
  opportunities.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  return opportunities
}
