export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'

// Inventory Intelligence API
// Demand forecasting, auto-reorder, slow-mover detection, dead stock alerts

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'reorder-alerts': return await getReorderAlerts();
      case 'slow-movers': return await getSlowMovers();
      case 'demand-forecast': return await getDemandForecast();
      case 'turnover': return await getTurnoverAnalysis();
      case 'stockout-risk': return await getStockoutRisk();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error) {
    console.error('Inventory intelligence error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  const overview: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalSKUs",
      COALESCE(SUM("onHand"), 0)::int as "totalUnitsOnHand",
      COALESCE(SUM(committed), 0)::int as "totalCommitted",
      COALESCE(SUM("onOrder"), 0)::int as "totalOnOrder",
      COALESCE(SUM(available), 0)::int as "totalAvailable",
      COUNT(CASE WHEN "onHand" <= "reorderPoint" AND "reorderPoint" > 0 THEN 1 END)::int as "belowReorderPoint",
      COUNT(CASE WHEN "onHand" = 0 THEN 1 END)::int as "outOfStock",
      COUNT(CASE WHEN available < 0 THEN 1 END)::int as "negativeAvailable"
    FROM "InventoryItem"
  `);

  const inventoryValue: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(COALESCE(SUM(i."onHand" * COALESCE(bom_cost(p.id), p.cost)), 0)::numeric, 2) as "totalCostValue",
      ROUND(COALESCE(SUM(i."onHand" * p."basePrice"), 0)::numeric, 2) as "totalRetailValue",
      ROUND(COALESCE(SUM(i."onHand" * (p."basePrice" - COALESCE(bom_cost(p.id), p.cost))), 0)::numeric, 2) as "totalMarginValue"
    FROM "InventoryItem" i
    JOIN "Product" p ON i."productId" = p.id
    WHERE COALESCE(bom_cost(p.id), p.cost) > 0
  `);

  const pendingPOs: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "openPOs",
      ROUND(COALESCE(SUM(total), 0)::numeric, 2) as "totalPOValue"
    FROM "PurchaseOrder"
    WHERE status::text IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED')
  `);

  const recentActivity: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "lastReceivedAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "receivedThisWeek",
      COUNT(CASE WHEN "lastCountedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "countedThisMonth",
      COUNT(CASE WHEN "lastCountedAt" IS NULL OR "lastCountedAt" < NOW() - INTERVAL '90 days' THEN 1 END)::int as "needsCycleCount"
    FROM "InventoryItem"
  `);

  return NextResponse.json({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    overview: overview[0] || {},
    value: inventoryValue[0] || {},
    pendingPOs: pendingPOs[0] || {},
    activity: recentActivity[0] || {},
  });
}

async function getReorderAlerts() {
  const alerts: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      i.id, i."productId", i."onHand", i.committed, i.available, i."onOrder",
      i."reorderPoint", i."reorderQty", i."warehouseZone", i."binLocation",
      p.sku, p.name, p.category, p.cost, p."basePrice",
      CASE
        WHEN i."onHand" = 0 THEN 'OUT_OF_STOCK'
        WHEN i.available <= 0 THEN 'CRITICAL'
        WHEN i."onHand" <= i."reorderPoint" THEN 'REORDER'
        WHEN i."onHand" <= i."reorderPoint" * 1.5 THEN 'LOW'
        ELSE 'OK'
      END as "alertLevel",
      COALESCE(vp."vendorCost", 0) as "vendorCost",
      COALESCE(v.name, '') as "vendorName",
      COALESCE(vp."leadTimeDays", 0) as "leadTimeDays"
    FROM "InventoryItem" i
    JOIN "Product" p ON i."productId" = p.id
    LEFT JOIN "VendorProduct" vp ON p.id = vp."productId" AND vp.preferred = true
    LEFT JOIN "Vendor" v ON vp."vendorId" = v.id
    WHERE i."reorderPoint" > 0 AND i."onHand" <= i."reorderPoint" * 1.5
    ORDER BY
      CASE
        WHEN i."onHand" = 0 THEN 1
        WHEN i.available <= 0 THEN 2
        WHEN i."onHand" <= i."reorderPoint" THEN 3
        ELSE 4
      END,
      (i."onHand" - i."reorderPoint") ASC
  `);

  return NextResponse.json({
    report: 'reorder-alerts',
    generatedAt: new Date().toISOString(),
    alerts,
    summary: {
      outOfStock: alerts.filter(a => a.alertLevel === 'OUT_OF_STOCK').length,
      critical: alerts.filter(a => a.alertLevel === 'CRITICAL').length,
      reorder: alerts.filter(a => a.alertLevel === 'REORDER').length,
      low: alerts.filter(a => a.alertLevel === 'LOW').length,
    },
  });
}

async function getSlowMovers() {
  // Products with inventory that haven't sold recently
  const slowMovers: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category, COALESCE(bom_cost(p.id), p.cost) as cost, p."basePrice",
      i."onHand", i.available, i."warehouseZone", i."binLocation",
      ROUND((i."onHand" * COALESCE(bom_cost(p.id), p.cost))::numeric, 2) as "carryingCost",
      COALESCE(sales."lastSoldDate", i."lastReceivedAt") as "lastMovement",
      COALESCE(sales."qtySold90d", 0) as "qtySold90d",
      COALESCE(sales."qtySold180d", 0) as "qtySold180d",
      CASE
        WHEN COALESCE(sales."qtySold180d", 0) = 0 THEN 'DEAD_STOCK'
        WHEN COALESCE(sales."qtySold90d", 0) = 0 THEN 'VERY_SLOW'
        WHEN COALESCE(sales."qtySold90d", 0) < 3 THEN 'SLOW'
        ELSE 'MODERATE'
      END as "velocityClass",
      CASE
        WHEN COALESCE(sales."avgMonthlyQty", 0) > 0
        THEN ROUND((i."onHand" / sales."avgMonthlyQty")::numeric, 1)
        ELSE 999
      END as "monthsOfSupply"
    FROM "InventoryItem" i
    JOIN "Product" p ON i."productId" = p.id
    LEFT JOIN (
      SELECT
        oi."productId",
        MAX(o."createdAt") as "lastSoldDate",
        SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '90 days' THEN oi.quantity ELSE 0 END) as "qtySold90d",
        SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '180 days' THEN oi.quantity ELSE 0 END) as "qtySold180d",
        SUM(oi.quantity)::numeric / GREATEST(EXTRACT(MONTH FROM (NOW() - MIN(o."createdAt"))), 1) as "avgMonthlyQty"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      GROUP BY oi."productId"
    ) sales ON p.id = sales."productId"
    WHERE i."onHand" > 0 AND p.active = true
    ORDER BY "carryingCost" DESC
  `);

  const deadStock = slowMovers.filter(s => s.velocityClass === 'DEAD_STOCK');
  const totalCarryingCost = slowMovers
    .filter(s => ['DEAD_STOCK', 'VERY_SLOW'].includes(s.velocityClass))
    .reduce((sum, s) => sum + Number(s.carryingCost || 0), 0);

  return NextResponse.json({
    report: 'slow-movers',
    generatedAt: new Date().toISOString(),
    items: slowMovers,
    summary: {
      deadStock: deadStock.length,
      verySlow: slowMovers.filter(s => s.velocityClass === 'VERY_SLOW').length,
      slow: slowMovers.filter(s => s.velocityClass === 'SLOW').length,
      totalCarryingCost: Math.round(totalCarryingCost * 100) / 100,
      deadStockValue: Math.round(deadStock.reduce((sum, s) => sum + Number(s.carryingCost || 0), 0) * 100) / 100,
    },
  });
}

async function getDemandForecast() {
  // Monthly demand by category (last 12 months) to project future demand
  const monthlyDemand: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', o."createdAt") as "month",
      p.category,
      SUM(oi.quantity) as "totalQty",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "totalRevenue",
      COUNT(DISTINCT o.id) as "orderCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', o."createdAt"), p.category
    ORDER BY "month" DESC, "totalRevenue" DESC
  `);

  // Top products by demand velocity
  const topProducts: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category,
      SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END) as "qty30d",
      SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '90 days' THEN oi.quantity ELSE 0 END) as "qty90d",
      SUM(oi.quantity) as "totalQty",
      ROUND(SUM(oi.quantity)::numeric / GREATEST(EXTRACT(MONTH FROM (NOW() - MIN(o."createdAt"))), 1), 1) as "avgMonthly",
      COALESCE(i."onHand", 0) as "currentStock",
      CASE
        WHEN SUM(oi.quantity)::numeric / GREATEST(EXTRACT(MONTH FROM (NOW() - MIN(o."createdAt"))), 1) > 0
        THEN ROUND((COALESCE(i."onHand", 0)::numeric / (SUM(oi.quantity)::numeric / GREATEST(EXTRACT(MONTH FROM (NOW() - MIN(o."createdAt"))), 1)))::numeric, 1)
        ELSE 999
      END as "monthsOfStock"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    LEFT JOIN "InventoryItem" i ON p.id = i."productId"
    WHERE o."createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY p.id, p.sku, p.name, p.category, i."onHand"
    ORDER BY "avgMonthly" DESC
    LIMIT 40
  `);

  return NextResponse.json({
    report: 'demand-forecast',
    generatedAt: new Date().toISOString(),
    monthlyDemand,
    topProducts,
  });
}

async function getTurnoverAnalysis() {
  // Inventory turnover by category
  const turnover: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.category,
      COUNT(DISTINCT i.id) as "skuCount",
      SUM(i."onHand") as "totalOnHand",
      ROUND(SUM(i."onHand" * COALESCE(bom_cost(p.id), p.cost))::numeric, 2) as "inventoryValue",
      COALESCE(SUM(sales."annualQty"), 0) as "annualUnitsSold",
      ROUND(COALESCE(SUM(sales."annualRevenue"), 0)::numeric, 2) as "annualRevenue",
      CASE
        WHEN SUM(i."onHand" * COALESCE(bom_cost(p.id), p.cost)) > 0
        THEN ROUND((COALESCE(SUM(sales."annualCOGS"), 0) / SUM(i."onHand" * COALESCE(bom_cost(p.id), p.cost)))::numeric, 1)
        ELSE 0
      END as "turnoverRate",
      CASE
        WHEN COALESCE(SUM(sales."annualCOGS"), 0) > 0
        THEN ROUND((365.0 * SUM(i."onHand" * COALESCE(bom_cost(p.id), p.cost)) / COALESCE(SUM(sales."annualCOGS"), 1))::numeric, 0)
        ELSE 999
      END as "daysOfInventory"
    FROM "InventoryItem" i
    JOIN "Product" p ON i."productId" = p.id
    LEFT JOIN (
      SELECT
        oi."productId",
        SUM(oi.quantity) as "annualQty",
        SUM(oi."lineTotal") as "annualRevenue",
        SUM(oi.quantity * COALESCE(p2.cost, 0)) as "annualCOGS"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      JOIN "Product" p2 ON oi."productId" = p2.id
      WHERE o."createdAt" > NOW() - INTERVAL '12 months'
      GROUP BY oi."productId"
    ) sales ON p.id = sales."productId"
    WHERE i."onHand" > 0
    GROUP BY p.category
    ORDER BY "turnoverRate" DESC
  `);

  return NextResponse.json({
    report: 'turnover',
    generatedAt: new Date().toISOString(),
    categories: turnover,
  });
}

async function getStockoutRisk() {
  // Products at risk of stocking out based on current velocity
  const atRisk: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category, p.cost,
      i."onHand", i.committed, i.available, i."onOrder", i."reorderPoint",
      COALESCE(demand."avgDaily", 0) as "avgDailyDemand",
      CASE
        WHEN COALESCE(demand."avgDaily", 0) > 0
        THEN ROUND((i.available::numeric / demand."avgDaily")::numeric, 0)
        ELSE 999
      END as "daysUntilStockout",
      COALESCE(vp."leadTimeDays", 14) as "leadTimeDays",
      CASE
        WHEN COALESCE(demand."avgDaily", 0) > 0
          AND (i.available::numeric / demand."avgDaily") < COALESCE(vp."leadTimeDays", 14)
        THEN true ELSE false
      END as "willStockOutBeforeReorder"
    FROM "InventoryItem" i
    JOIN "Product" p ON i."productId" = p.id
    LEFT JOIN (
      SELECT oi."productId",
        SUM(oi.quantity)::numeric / 90 as "avgDaily"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      WHERE o."createdAt" > NOW() - INTERVAL '90 days'
      GROUP BY oi."productId"
    ) demand ON p.id = demand."productId"
    LEFT JOIN "VendorProduct" vp ON p.id = vp."productId" AND vp.preferred = true
    WHERE i."onHand" > 0
      AND p.active = true
      AND COALESCE(demand."avgDaily", 0) > 0
    ORDER BY "daysUntilStockout" ASC
    LIMIT 50
  `);

  return NextResponse.json({
    report: 'stockout-risk',
    generatedAt: new Date().toISOString(),
    items: atRisk,
    criticalCount: atRisk.filter(a => a.willStockOutBeforeReorder).length,
  });
}
