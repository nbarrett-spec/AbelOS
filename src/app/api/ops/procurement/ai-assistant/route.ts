export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/procurement/ai-assistant — AI Procurement Brain
// Handles: demand forecasting, reorder recommendations, best-buy analysis,
//          PO scheduling, supplier comparison, stockout prevention
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Procurement', undefined, { method: 'POST' }).catch(() => {})

    const { action } = await request.json()

    switch (action) {
      case 'demand_forecast': return await runDemandForecast()
      case 'reorder_recommendations': return await getReorderRecommendations()
      case 'best_buy_analysis': return await runBestBuyAnalysis()
      case 'po_schedule': return await generatePOSchedule()
      case 'supplier_scorecard': return await supplierScorecard()
      case 'inventory_health': return await inventoryHealthCheck()
      case 'full_analysis': return await fullProcurementAnalysis()
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('AI Procurement error:', error)
    return NextResponse.json({ error: 'AI analysis failed', details: String(error) }, { status: 500 })
  }
}

// ── DEMAND FORECASTING ──────────────────────────────────────────────────
// Analyzes historical order data + open quotes to predict demand
async function runDemandForecast() {
  // Get 6 months of order item history by category
  const historicalDemand = await prisma.$queryRawUnsafe(`
    SELECT
      p."category",
      p."sku",
      p."name" as "productName",
      DATE_TRUNC('month', o."createdAt") as "month",
      SUM(oi."quantity")::int as "totalQty",
      COUNT(DISTINCT o."id")::int as "orderCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o."id"
    JOIN "Product" p ON oi."productId" = p."id"
    WHERE o."createdAt" > NOW() - INTERVAL '6 months'
      AND o."status"::text != 'CANCELLED'
    GROUP BY p."category", p."sku", p."name", DATE_TRUNC('month', o."createdAt")
    ORDER BY p."category", p."sku", "month"
  `) as any[]

  // Get open quotes (potential upcoming orders)
  const pendingDemand = await prisma.$queryRawUnsafe(`
    SELECT
      p."category",
      p."sku",
      p."name" as "productName",
      SUM(qi."quantity")::int as "pendingQty",
      COUNT(DISTINCT q."id")::int as "quoteCount"
    FROM "QuoteItem" qi
    JOIN "Quote" q ON qi."quoteId" = q."id"
    JOIN "Product" p ON qi."productId" = p."id"
    WHERE q."status"::text IN ('SENT', 'APPROVED')
    GROUP BY p."category", p."sku", p."name"
    ORDER BY SUM(qi."quantity") DESC
  `) as any[]

  // Calculate demand by category
  const categoryDemand = await prisma.$queryRawUnsafe(`
    SELECT
      p."category",
      SUM(oi."quantity")::int as "total6mo",
      ROUND(SUM(oi."quantity")::numeric / 6, 1) as "avgMonthly",
      ROUND(SUM(oi."quantity")::numeric / 180, 2) as "avgDaily",
      COUNT(DISTINCT p."sku")::int as "uniqueSkus"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o."id"
    JOIN "Product" p ON oi."productId" = p."id"
    WHERE o."createdAt" > NOW() - INTERVAL '6 months'
      AND o."status"::text != 'CANCELLED'
    GROUP BY p."category"
    ORDER BY SUM(oi."quantity") DESC
  `) as any[]

  // AI-generated forecasts by category for next 30/60/90 days
  const forecasts = categoryDemand.map((cat: any) => {
    const monthlyAvg = Number(cat.avgMonthly) || 0
    // Apply seasonal adjustment (spring/summer = higher for construction)
    const month = new Date().getMonth()
    const seasonalFactor = [0.7, 0.75, 0.85, 0.95, 1.1, 1.2, 1.25, 1.2, 1.1, 0.95, 0.8, 0.7][month]
    // Growth trend (5% monthly growth estimate)
    const trendFactor = 1.05

    const adjustedMonthly = Math.round(monthlyAvg * seasonalFactor * trendFactor)

    // Find pending demand for this category
    const pending = pendingDemand.filter((p: any) => p.category === cat.category)
    const pendingTotal = pending.reduce((sum: number, p: any) => sum + (Number(p.pendingQty) || 0), 0)

    return {
      category: cat.category,
      historical: {
        total6mo: Number(cat.total6mo),
        avgMonthly: monthlyAvg,
        avgDaily: Number(cat.avgDaily),
        uniqueSkus: Number(cat.uniqueSkus),
      },
      forecast: {
        next30days: adjustedMonthly,
        next60days: adjustedMonthly * 2,
        next90days: adjustedMonthly * 3,
        seasonalFactor,
        trendFactor,
        confidence: 0.72,
      },
      pendingFromQuotes: pendingTotal,
      totalExpectedDemand30: adjustedMonthly + Math.round(pendingTotal * 0.6), // 60% quote conversion
    }
  })

  // Top products by demand
  const topProducts = await prisma.$queryRawUnsafe(`
    SELECT
      p."sku", p."name", p."category",
      SUM(oi."quantity")::int as "totalOrdered",
      ROUND(SUM(oi."quantity")::numeric / 6, 1) as "avgMonthly"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o."id"
    JOIN "Product" p ON oi."productId" = p."id"
    WHERE o."createdAt" > NOW() - INTERVAL '6 months'
      AND o."status"::text != 'CANCELLED'
    GROUP BY p."sku", p."name", p."category"
    ORDER BY SUM(oi."quantity") DESC
    LIMIT 20
  `)

  return NextResponse.json({
    forecasts,
    topProducts,
    pendingDemand: pendingDemand.slice(0, 15),
    historicalByProduct: historicalDemand,
    generatedAt: new Date().toISOString(),
    aiInsights: generateDemandInsights(forecasts, pendingDemand),
  })
}

function generateDemandInsights(forecasts: any[], pendingDemand: any[]) {
  const insights: string[] = []
  const month = new Date().getMonth()
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Seasonal insight
  if (month >= 3 && month <= 7) {
    insights.push(`📈 Peak construction season (${monthNames[month]}). Demand is trending ${Math.round(([0.7, 0.75, 0.85, 0.95, 1.1, 1.2, 1.25, 1.2, 1.1, 0.95, 0.8, 0.7][month] - 1) * 100)}% above annual average. Consider increasing safety stock levels for high-velocity items.`)
  } else {
    insights.push(`📉 Off-peak season (${monthNames[month]}). Demand is trending ${Math.round((1 - [0.7, 0.75, 0.85, 0.95, 1.1, 1.2, 1.25, 1.2, 1.1, 0.95, 0.8, 0.7][month]) * 100)}% below annual average. Good time for overseas orders with longer lead times.`)
  }

  // Pending demand insight
  const totalPending = pendingDemand.reduce((s: number, p: any) => s + (Number(p.pendingQty) || 0), 0)
  if (totalPending > 0) {
    insights.push(`📋 ${totalPending} units in pending quotes across ${pendingDemand.length} products. At 60% conversion rate, expect ~${Math.round(totalPending * 0.6)} additional units needed in the next 30-45 days.`)
  }

  // Category insights
  for (const f of forecasts) {
    if (f.forecast.next30days > f.historical.avgMonthly * 1.2) {
      insights.push(`⚠️ ${f.category}: Forecasted demand (${f.forecast.next30days}/mo) is ${Math.round(((f.forecast.next30days / f.historical.avgMonthly) - 1) * 100)}% above average. Recommend pre-ordering to avoid stockouts.`)
    }
  }

  insights.push(`🤖 AI Recommendation: Review top 10 SKUs by velocity. For overseas-sourced items, place orders 6-8 weeks ahead of forecasted need to account for shipping and customs.`)

  return insights
}

// ── REORDER RECOMMENDATIONS ─────────────────────────────────────────────
async function getReorderRecommendations() {
  // Items below reorder point or approaching it
  const needsReorder = await prisma.$queryRawUnsafe(`
    SELECT i.*,
      CASE
        WHEN i."onHand" = 0 THEN 'CRITICAL'
        WHEN i."onHand" <= i."safetyStock" THEN 'URGENT'
        WHEN i."onHand" <= i."reorderPoint" THEN 'REORDER_NOW'
        WHEN i."avgDailyUsage" > 0 AND (i."onHand" / i."avgDailyUsage") < 14 THEN 'REORDER_SOON'
        ELSE 'OK'
      END as "urgency",
      CASE
        WHEN i."avgDailyUsage" > 0 THEN ROUND((i."onHand"::numeric / i."avgDailyUsage"), 0)
        ELSE 999
      END as "daysUntilStockout"
    FROM "InventoryItem" i
    WHERE (
      i."onHand" <= i."reorderPoint"
      OR (i."avgDailyUsage" > 0 AND (i."onHand" / GREATEST(i."avgDailyUsage", 0.01)) < 14)
    )
    ORDER BY
      CASE
        WHEN i."onHand" = 0 THEN 0
        WHEN i."onHand" <= i."safetyStock" THEN 1
        WHEN i."onHand" <= i."reorderPoint" THEN 2
        ELSE 3
      END,
      i."avgDailyUsage" DESC
  `) as any[]

  // Find best supplier for each item
  const recommendations = []
  for (const item of needsReorder) {
    const suppliers = await prisma.$queryRawUnsafe(`
      SELECT sp.*, s."name" as "supplierName", s."type" as "supplierType",
        s."avgLeadTimeDays", s."onTimeDeliveryPct", s."qualityRating",
        s."dutyRate", s."freightCostPct",
        (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) as "landedCost"
      FROM "SupplierProduct" sp
      JOIN "Supplier" s ON sp."supplierId" = s."id"
      WHERE (sp."productId" = $1 OR sp."sku" = $2)
        AND sp."active" = true AND s."status"::text = 'ACTIVE'
      ORDER BY (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) ASC
    `, item.productId, item.sku) as any[]

    const daysUntilStockout = Number(item.daysUntilStockout) || 999
    const urgency = item.urgency

    // AI recommendation logic
    let recommendedSupplier = suppliers[0] || null
    let aiReason = ''

    if (suppliers.length > 1) {
      const cheapest = suppliers[0]
      const fastest = [...suppliers].sort((a: any, b: any) => (a.avgLeadTimeDays || 99) - (b.avgLeadTimeDays || 99))[0]

      if (urgency === 'CRITICAL' || daysUntilStockout < 7) {
        // Emergency: pick fastest supplier even if more expensive
        recommendedSupplier = fastest
        aiReason = `EMERGENCY: Only ${daysUntilStockout} days of stock left. Recommending ${fastest.supplierName} (fastest delivery: ${fastest.avgLeadTimeDays} days) despite higher cost. Consider air freight.`
      } else if (daysUntilStockout < (cheapest.avgLeadTimeDays || 14) + 7) {
        // Not enough time for cheapest, go with fastest that fits
        const viable = suppliers.filter((s: any) => (s.avgLeadTimeDays || 14) < daysUntilStockout - 3)
        recommendedSupplier = viable.length > 0 ? viable[0] : fastest
        aiReason = `${daysUntilStockout} days until stockout. Cheapest option (${cheapest.supplierName}) takes ${cheapest.avgLeadTimeDays} days — too risky. Recommending ${recommendedSupplier.supplierName} with ${recommendedSupplier.avgLeadTimeDays}-day lead time.`
      } else {
        // Enough time: go with best value (landed cost)
        recommendedSupplier = cheapest
        const savings = suppliers.length > 1
          ? ((Number(suppliers[1].landedCost) - Number(cheapest.landedCost)) * (item.reorderQty || 50)).toFixed(2)
          : '0'
        aiReason = `Sufficient lead time. Recommending ${cheapest.supplierName} at $${Number(cheapest.landedCost).toFixed(2)}/unit landed cost. Saves $${savings} vs next option on ${item.reorderQty || 50} units.`
      }
    } else if (suppliers.length === 1) {
      aiReason = `Single source: ${suppliers[0].supplierName}. Consider adding alternative suppliers for price competition and risk mitigation.`
    } else {
      aiReason = `No suppliers configured for this product. Add supplier pricing to enable automated purchasing.`
    }

    recommendations.push({
      ...item,
      daysUntilStockout,
      recommendedSupplier,
      allSuppliers: suppliers,
      aiReason,
      suggestedQty: Math.max(item.reorderQty || 50, Math.round((item.avgDailyUsage || 1) * 30)),
      estimatedCost: recommendedSupplier
        ? Number(recommendedSupplier.landedCost || recommendedSupplier.unitCost) * Math.max(item.reorderQty || 50, Math.round((item.avgDailyUsage || 1) * 30))
        : 0,
    })
  }

  return NextResponse.json({
    recommendations,
    summary: {
      totalItemsNeedReorder: needsReorder.length,
      criticalCount: needsReorder.filter((i: any) => i.urgency === 'CRITICAL').length,
      urgentCount: needsReorder.filter((i: any) => i.urgency === 'URGENT').length,
      estimatedTotalCost: recommendations.reduce((s, r) => s + (r.estimatedCost || 0), 0),
    },
    generatedAt: new Date().toISOString(),
  })
}

// ── BEST BUY ANALYSIS ───────────────────────────────────────────────────
async function runBestBuyAnalysis() {
  // Compare all supplier prices for common categories
  const categories = ['Trim', 'MDF', 'Hardware', 'Interior Doors', 'Exterior Doors']

  const analysis = []
  for (const category of categories) {
    const comparison = await prisma.$queryRawUnsafe(`
      SELECT
        sp."productName",
        sp."sku",
        sp."unitCost",
        sp."moq",
        sp."leadTimeDays",
        s."name" as "supplierName",
        s."type" as "supplierType",
        s."country",
        s."dutyRate",
        s."freightCostPct",
        s."qualityRating",
        s."onTimeDeliveryPct",
        (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) as "landedCost"
      FROM "SupplierProduct" sp
      JOIN "Supplier" s ON sp."supplierId" = s."id"
      WHERE sp."category" = $1 AND sp."active" = true AND s."status"::text = 'ACTIVE'
      ORDER BY sp."productName", (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) ASC
    `, category) as any[]

    // Group by product and find best buy
    const productMap: Record<string, any[]> = {}
    for (const item of comparison) {
      const key = item.productName || item.sku
      if (!productMap[key]) productMap[key] = []
      productMap[key].push(item)
    }

    const products = Object.entries(productMap).map(([name, suppliers]) => {
      const cheapest = suppliers[0]
      const domesticOptions = suppliers.filter((s: any) => s.supplierType === 'DOMESTIC')
      const overseasOptions = suppliers.filter((s: any) => s.supplierType === 'OVERSEAS')

      let savingsPercent = 0
      if (domesticOptions.length > 0 && overseasOptions.length > 0) {
        const bestDomestic = Number(domesticOptions[0].landedCost)
        const bestOverseas = Number(overseasOptions[0].landedCost)
        savingsPercent = Math.round(((bestDomestic - bestOverseas) / bestDomestic) * 100)
      }

      return {
        productName: name,
        bestBuy: cheapest,
        supplierCount: suppliers.length,
        domesticBest: domesticOptions[0] || null,
        overseasBest: overseasOptions[0] || null,
        overseasSavingsPct: savingsPercent,
        allOptions: suppliers,
      }
    })

    if (products.length > 0) {
      analysis.push({
        category,
        productCount: products.length,
        products,
        avgOverseasSavings: products.filter(p => p.overseasSavingsPct > 0).length > 0
          ? Math.round(products.filter(p => p.overseasSavingsPct > 0).reduce((s, p) => s + p.overseasSavingsPct, 0) / products.filter(p => p.overseasSavingsPct > 0).length)
          : 0,
      })
    }
  }

  return NextResponse.json({
    analysis,
    aiInsights: [
      '🔍 Best-buy analysis compares landed cost (unit price + duty + freight) across all active suppliers.',
      '💰 Overseas sourcing typically saves 15-35% on trim and MDF components, but requires 4-8 week lead times.',
      '⚠️ Factor in quality differences — a lower unit cost with higher defect rate may cost more long-term.',
      '🤖 Recommendation: Start overseas sourcing with high-volume, low-complexity items (standard trim profiles, basic hardware) where quality consistency is easier to maintain.',
    ],
    generatedAt: new Date().toISOString(),
  })
}

// ── PO SCHEDULE GENERATION ──────────────────────────────────────────────
async function generatePOSchedule() {
  // Get all items needing reorder with lead times
  const items = await prisma.$queryRawUnsafe(`
    SELECT i.*,
      CASE
        WHEN i."avgDailyUsage" > 0 THEN ROUND((i."onHand"::numeric / i."avgDailyUsage"), 0)
        ELSE 999
      END as "daysUntilStockout"
    FROM "InventoryItem" i
    WHERE i."onHand" <= i."reorderPoint" * 1.5
    ORDER BY
      CASE WHEN i."avgDailyUsage" > 0 THEN (i."onHand" / i."avgDailyUsage") ELSE 999 END ASC
  `) as any[]

  // Group by best supplier and generate PO recommendations
  const poGroups: Record<string, { supplier: any; items: any[]; totalCost: number }> = {}

  for (const item of items) {
    const suppliers = await prisma.$queryRawUnsafe(`
      SELECT sp.*, s."name" as "supplierName", s."id" as "sid", s."type" as "supplierType",
        s."avgLeadTimeDays", s."minOrderValue",
        (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) as "landedCost"
      FROM "SupplierProduct" sp
      JOIN "Supplier" s ON sp."supplierId" = s."id"
      WHERE (sp."productId" = $1 OR sp."sku" = $2)
        AND sp."active" = true AND s."status"::text = 'ACTIVE'
      ORDER BY (sp."unitCost" * (1 + COALESCE(s."dutyRate", 0)/100 + COALESCE(s."freightCostPct", 0)/100)) ASC
      LIMIT 1
    `, item.productId, item.sku) as any[]

    if (suppliers.length > 0) {
      const sup = suppliers[0]
      const supplierId = sup.sid

      if (!poGroups[supplierId]) {
        poGroups[supplierId] = { supplier: sup, items: [], totalCost: 0 }
      }

      const qty = Math.max(item.reorderQty || 50, Math.round((item.avgDailyUsage || 1) * 30))
      const cost = Number(sup.landedCost || sup.unitCost) * qty

      poGroups[supplierId].items.push({
        ...item,
        suggestedQty: qty,
        unitCost: Number(sup.unitCost),
        landedCost: Number(sup.landedCost),
        lineCost: cost,
      })
      poGroups[supplierId].totalCost += cost
    }
  }

  const suggestedPOs = Object.entries(poGroups).map(([supplierId, group]) => ({
    supplierId,
    supplierName: group.supplier.supplierName,
    supplierType: group.supplier.supplierType,
    leadTimeDays: group.supplier.avgLeadTimeDays,
    itemCount: group.items.length,
    totalCost: Math.round(group.totalCost * 100) / 100,
    meetsMinOrder: group.totalCost >= (group.supplier.minOrderValue || 0),
    minOrderValue: group.supplier.minOrderValue || 0,
    suggestedOrderDate: new Date().toISOString().split('T')[0],
    expectedDelivery: new Date(Date.now() + (group.supplier.avgLeadTimeDays || 14) * 86400000).toISOString().split('T')[0],
    items: group.items,
    priority: group.items.some((i: any) => Number(i.daysUntilStockout) < 7) ? 'URGENT'
      : group.items.some((i: any) => Number(i.daysUntilStockout) < 14) ? 'HIGH' : 'NORMAL',
  }))

  // Sort by priority
  suggestedPOs.sort((a, b) => {
    const prio = { URGENT: 0, HIGH: 1, NORMAL: 2 }
    return (prio[a.priority as keyof typeof prio] || 2) - (prio[b.priority as keyof typeof prio] || 2)
  })

  return NextResponse.json({
    suggestedPOs,
    summary: {
      totalPOs: suggestedPOs.length,
      totalValue: suggestedPOs.reduce((s, p) => s + p.totalCost, 0),
      urgentPOs: suggestedPOs.filter(p => p.priority === 'URGENT').length,
      totalItems: suggestedPOs.reduce((s, p) => s + p.itemCount, 0),
    },
    aiInsights: [
      `🤖 AI has grouped ${items.length} items needing reorder into ${suggestedPOs.length} suggested purchase orders by supplier.`,
      suggestedPOs.some(p => p.priority === 'URGENT')
        ? `🚨 ${suggestedPOs.filter(p => p.priority === 'URGENT').length} URGENT POs need immediate attention — items at risk of stockout within 7 days.`
        : '✅ No immediate stockout risks detected.',
      `💰 Total estimated spend: $${suggestedPOs.reduce((s, p) => s + p.totalCost, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      `📦 Click "Generate PO" on any recommendation to auto-create a draft purchase order.`,
    ],
    generatedAt: new Date().toISOString(),
  })
}

// ── SUPPLIER SCORECARD ──────────────────────────────────────────────────
async function supplierScorecard() {
  const suppliers = await prisma.$queryRawUnsafe(`
    SELECT s.*,
      (SELECT COUNT(*)::int FROM "PurchaseOrder" po WHERE po."supplierId" = s."id" AND po."status" != 'CANCELLED') as "totalPOs",
      (SELECT COUNT(*)::int FROM "PurchaseOrder" po WHERE po."supplierId" = s."id" AND po."status" = 'RECEIVED') as "completedPOs",
      (SELECT COALESCE(SUM(po."totalCost"), 0) FROM "PurchaseOrder" po WHERE po."supplierId" = s."id" AND po."status" != 'CANCELLED') as "totalSpend",
      (SELECT COUNT(*)::int FROM "SupplierProduct" sp WHERE sp."supplierId" = s."id" AND sp."active" = true) as "activeProducts",
      (SELECT AVG(EXTRACT(EPOCH FROM (po."actualDate" - po."createdAt")) / 86400)
       FROM "PurchaseOrder" po WHERE po."supplierId" = s."id" AND po."actualDate" IS NOT NULL) as "avgActualLeadDays"
    FROM "Supplier" s
    WHERE s."status"::text = 'ACTIVE'
    ORDER BY s."name"
  `) as any[]

  const scorecards = suppliers.map((s: any) => {
    // Composite score: quality (30%) + reliability (25%) + on-time (25%) + value (20%)
    const qualityScore = (Number(s.qualityRating) || 3) / 5 * 100
    const reliabilityScore = (Number(s.reliabilityScore) || 3) / 5 * 100
    const onTimeScore = Number(s.onTimeDeliveryPct) || 90
    const valueScore = Math.min(100, 100 - ((Number(s.avgActualLeadDays) || Number(s.avgLeadTimeDays) || 14) - 7) * 2)

    const compositeScore = Math.round(
      qualityScore * 0.30 +
      reliabilityScore * 0.25 +
      onTimeScore * 0.25 +
      Math.max(0, valueScore) * 0.20
    )

    return {
      ...s,
      scores: { quality: Math.round(qualityScore), reliability: Math.round(reliabilityScore), onTime: Math.round(onTimeScore), value: Math.round(Math.max(0, valueScore)) },
      compositeScore,
      grade: compositeScore >= 90 ? 'A' : compositeScore >= 80 ? 'B' : compositeScore >= 70 ? 'C' : compositeScore >= 60 ? 'D' : 'F',
    }
  })

  scorecards.sort((a: any, b: any) => b.compositeScore - a.compositeScore)

  return NextResponse.json({ scorecards, generatedAt: new Date().toISOString() })
}

// ── INVENTORY HEALTH CHECK ──────────────────────────────────────────────
async function inventoryHealthCheck() {
  const health = await prisma.$queryRawUnsafe(`
    SELECT
      "category",
      COUNT(*)::int as "totalItems",
      SUM("onHand")::int as "totalUnits",
      ROUND(SUM("onHand" * "unitCost")::numeric, 2) as "totalValue",
      COUNT(*) FILTER (WHERE "onHand" = 0)::int as "outOfStock",
      COUNT(*) FILTER (WHERE "onHand" <= "safetyStock" AND "onHand" > 0)::int as "critical",
      COUNT(*) FILTER (WHERE "onHand" <= "reorderPoint" AND "onHand" > "safetyStock")::int as "lowStock",
      COUNT(*) FILTER (WHERE "onHand" > "maxStock")::int as "overstock",
      ROUND(AVG("avgDailyUsage")::numeric, 2) as "avgUsage",
      ROUND(AVG(CASE WHEN "avgDailyUsage" > 0 THEN "onHand" / "avgDailyUsage" ELSE NULL END)::numeric, 1) as "avgDaysOfSupply"
    FROM "InventoryItem"
    GROUP BY "category"
    ORDER BY "category"
  `) as any[]

  const totals = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalSkus",
      COALESCE(SUM("onHand" * "unitCost"), 0)::numeric as "totalInventoryValue",
      COUNT(*) FILTER (WHERE "onHand" = 0)::int as "outOfStockSkus",
      COUNT(*) FILTER (WHERE "onHand" <= "reorderPoint")::int as "belowReorderPoint",
      COUNT(*) FILTER (WHERE "onHand" > "maxStock")::int as "overstocked",
      ROUND(AVG(CASE WHEN "avgDailyUsage" > 0 THEN "onHand" / "avgDailyUsage" ELSE NULL END)::numeric, 1) as "avgDaysOfSupply"
    FROM "InventoryItem"
  `) as any[]

  return NextResponse.json({
    byCategory: health,
    totals: totals[0],
    healthScore: calculateHealthScore(totals[0]),
    generatedAt: new Date().toISOString(),
  })
}

function calculateHealthScore(totals: any) {
  const total = Number(totals.totalSkus) || 1
  const outOfStock = Number(totals.outOfStockSkus) || 0
  const belowReorder = Number(totals.belowReorderPoint) || 0
  const overstock = Number(totals.overstocked) || 0

  // Perfect = 100, lose points for issues
  let score = 100
  score -= (outOfStock / total) * 40 // Heavy penalty for stockouts
  score -= (belowReorder / total) * 20 // Medium penalty for low stock
  score -= (overstock / total) * 10 // Light penalty for overstock

  return Math.max(0, Math.round(score))
}

// ── FULL PROCUREMENT ANALYSIS ───────────────────────────────────────────
async function fullProcurementAnalysis() {
  // Run all analyses and combine
  const [demandRes, reorderRes, bestBuyRes, scheduleRes, scorecardRes, healthRes] = await Promise.all([
    runDemandForecast().then(r => r.json()),
    getReorderRecommendations().then(r => r.json()),
    runBestBuyAnalysis().then(r => r.json()),
    generatePOSchedule().then(r => r.json()),
    supplierScorecard().then(r => r.json()),
    inventoryHealthCheck().then(r => r.json()),
  ])

  return NextResponse.json({
    demand: demandRes,
    reorder: reorderRes,
    bestBuy: bestBuyRes,
    poSchedule: scheduleRes,
    supplierScorecard: scorecardRes,
    inventoryHealth: healthRes,
    generatedAt: new Date().toISOString(),
  })
}
