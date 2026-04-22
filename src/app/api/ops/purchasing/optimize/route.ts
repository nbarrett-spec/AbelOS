export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'

// Purchasing Optimization API
// Vendor comparison, bulk buy analysis, PO consolidation, vendor scorecards

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'vendor-comparison': return await getVendorComparison();
      case 'vendor-scorecard': return await getVendorScorecard();
      case 'consolidation': return await getConsolidationOpportunities();
      case 'spend-analysis': return await getSpendAnalysis();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error) {
    console.error('Purchasing optimization error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String((error as any)?.message || error) }, { status: 500 });
  }
}

async function getDashboard() {
  const poSummary: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalPOs",
      COUNT(CASE WHEN status = 'DRAFT' THEN 1 END)::int as "draftPOs",
      COUNT(CASE WHEN status IN ('SUBMITTED', 'APPROVED', 'ORDERED') THEN 1 END)::int as "openPOs",
      COUNT(CASE WHEN status = 'RECEIVED' THEN 1 END)::int as "receivedPOs",
      ROUND(COALESCE(SUM(total), 0)::numeric, 2) as "totalSpend",
      ROUND(COALESCE(SUM(CASE WHEN status IN ('SUBMITTED', 'APPROVED', 'ORDERED') THEN total ELSE 0 END), 0)::numeric, 2) as "openValue",
      ROUND(COALESCE(AVG(CASE WHEN "receivedAt" IS NOT NULL AND "orderedAt" IS NOT NULL
        THEN EXTRACT(DAY FROM ("receivedAt" - "orderedAt")) END), 0)::numeric, 1) as "avgLeadDays"
    FROM "PurchaseOrder"
  `);

  const vendorSummary: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalVendors",
      COUNT(CASE WHEN active = true THEN 1 END)::int as "activeVendors",
      ROUND(AVG("onTimeRate")::numeric, 2) as "avgOnTimeRate"
    FROM "Vendor"
  `);

  const recentPOs: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      po.id, po."poNumber", po.status, po.total, po."orderedAt", po."expectedDate",
      v.name as "vendorName"
    FROM "PurchaseOrder" po
    JOIN "Vendor" v ON po."vendorId" = v.id
    ORDER BY po."createdAt" DESC
    LIMIT 10
  `);

  return NextResponse.json({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    poSummary: poSummary[0] || {},
    vendorSummary: vendorSummary[0] || {},
    recentPOs,
  });
}

async function getVendorComparison() {
  // Products available from multiple vendors — compare pricing
  const multiVendor: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id as "productId", p.sku, p.name, p.category, p.cost as "currentCost",
      json_agg(json_build_object(
        'vendorId', v.id,
        'vendorName', v.name,
        'vendorCode', v.code,
        'vendorCost', vp."vendorCost",
        'vendorSku', vp."vendorSku",
        'leadTimeDays', vp."leadTimeDays",
        'minOrderQty', vp."minOrderQty",
        'preferred', vp.preferred,
        'onTimeRate', v."onTimeRate"
      ) ORDER BY vp."vendorCost" ASC NULLS LAST) as vendors,
      COUNT(vp.id)::int as "vendorCount",
      MIN(vp."vendorCost") as "bestCost",
      MAX(vp."vendorCost") as "worstCost",
      ROUND((MAX(vp."vendorCost") - MIN(vp."vendorCost"))::numeric, 2) as "priceSpread"
    FROM "Product" p
    JOIN "VendorProduct" vp ON p.id = vp."productId"
    JOIN "Vendor" v ON vp."vendorId" = v.id
    WHERE p.active = true AND v.active = true
    GROUP BY p.id, p.sku, p.name, p.category, p.cost
    HAVING COUNT(vp.id) > 1
    ORDER BY "priceSpread" DESC
  `);

  // Products with only one vendor (risk)
  const singleSource: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category, p.cost,
      v.name as "vendorName", v.code as "vendorCode",
      vp."vendorCost", vp."leadTimeDays"
    FROM "Product" p
    JOIN "VendorProduct" vp ON p.id = vp."productId"
    JOIN "Vendor" v ON vp."vendorId" = v.id
    WHERE p.active = true
    AND p.id NOT IN (
      SELECT "productId" FROM "VendorProduct" GROUP BY "productId" HAVING COUNT(*) > 1
    )
    ORDER BY p.cost DESC
    LIMIT 30
  `);

  return NextResponse.json({
    report: 'vendor-comparison',
    generatedAt: new Date().toISOString(),
    multiVendor,
    singleSource,
    savingsOpportunity: multiVendor.reduce((sum, m) => sum + Number(m.priceSpread || 0), 0),
  });
}

async function getVendorScorecard() {
  const scorecards: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      v.id, v.name, v.code, v."onTimeRate", v."avgLeadDays", v.email, v.phone,
      COUNT(DISTINCT po.id)::int as "totalPOs",
      COUNT(DISTINCT CASE WHEN po.status = 'RECEIVED' THEN po.id END)::int as "completedPOs",
      ROUND(COALESCE(SUM(po.total), 0)::numeric, 2) as "totalSpend",
      ROUND(COALESCE(AVG(CASE WHEN po."receivedAt" IS NOT NULL AND po."orderedAt" IS NOT NULL
        THEN EXTRACT(DAY FROM (po."receivedAt" - po."orderedAt")) END), 0)::numeric, 1) as "actualAvgLeadDays",
      COUNT(DISTINCT vp.id)::int as "productsSupplied",
      ROUND(COALESCE(AVG(CASE WHEN po."expectedDate" IS NOT NULL AND po."receivedAt" IS NOT NULL
        THEN CASE WHEN po."receivedAt" <= po."expectedDate" THEN 1 ELSE 0 END END), 0)::numeric, 2) as "calculatedOnTimeRate"
    FROM "Vendor" v
    LEFT JOIN "PurchaseOrder" po ON v.id = po."vendorId"
    LEFT JOIN "VendorProduct" vp ON v.id = vp."vendorId"
    WHERE v.active = true
    GROUP BY v.id, v.name, v.code, v."onTimeRate", v."avgLeadDays", v.email, v.phone
    ORDER BY "totalSpend" DESC
  `);

  return NextResponse.json({
    report: 'vendor-scorecard',
    generatedAt: new Date().toISOString(),
    vendors: scorecards,
  });
}

async function getConsolidationOpportunities() {
  // Products from same vendor that could be ordered together
  const consolidation: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      v.id as "vendorId", v.name as "vendorName", v.code as "vendorCode",
      COUNT(DISTINCT i.id)::int as "productsNeedingReorder",
      json_agg(json_build_object(
        'sku', p.sku,
        'name', p.name,
        'onHand', i."onHand",
        'reorderPoint', i."reorderPoint",
        'reorderQty', i."reorderQty",
        'vendorCost', vp."vendorCost"
      )) as products,
      ROUND(SUM(COALESCE(vp."vendorCost", 0) * i."reorderQty")::numeric, 2) as "estimatedPOValue"
    FROM "InventoryItem" i
    JOIN "Product" p ON i."productId" = p.id
    JOIN "VendorProduct" vp ON p.id = vp."productId" AND vp.preferred = true
    JOIN "Vendor" v ON vp."vendorId" = v.id
    WHERE i."reorderPoint" > 0 AND (i."onHand" + COALESCE(i."onOrder", 0)) <= i."reorderPoint"
    GROUP BY v.id, v.name, v.code
    HAVING COUNT(DISTINCT i.id) > 1
    ORDER BY "estimatedPOValue" DESC
  `);

  return NextResponse.json({
    report: 'consolidation',
    generatedAt: new Date().toISOString(),
    opportunities: consolidation,
    totalSavingsEstimate: consolidation.length * 50, // ~$50 per consolidated PO in admin time
  });
}

async function getSpendAnalysis() {
  // Spend by vendor over time
  const vendorSpend: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      v.name as "vendorName",
      ROUND(SUM(CASE WHEN po."orderedAt" > NOW() - INTERVAL '30 days' THEN po.total ELSE 0 END)::numeric, 2) as "spend30d",
      ROUND(SUM(CASE WHEN po."orderedAt" > NOW() - INTERVAL '90 days' THEN po.total ELSE 0 END)::numeric, 2) as "spend90d",
      ROUND(SUM(CASE WHEN po."orderedAt" > NOW() - INTERVAL '365 days' THEN po.total ELSE 0 END)::numeric, 2) as "spend365d",
      COUNT(CASE WHEN po."orderedAt" > NOW() - INTERVAL '365 days' THEN 1 END)::int as "poCount"
    FROM "Vendor" v
    JOIN "PurchaseOrder" po ON v.id = po."vendorId"
    WHERE po.status != 'CANCELLED'
    GROUP BY v.name
    ORDER BY "spend365d" DESC
  `);

  // Spend by category
  const categorySpend: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(p.category, 'Unknown') as category,
      ROUND(SUM(poi."lineTotal")::numeric, 2) as "totalSpend",
      SUM(poi.quantity)::float as "totalQty",
      COUNT(DISTINCT po.id)::int as "poCount",
      ROUND(AVG(poi."unitCost")::numeric, 2) as "avgUnitCost"
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON poi."purchaseOrderId" = po.id
    LEFT JOIN "Product" p ON poi."productId" = p.id
    WHERE po.status != 'CANCELLED'
    GROUP BY p.category
    ORDER BY "totalSpend" DESC
  `);

  return NextResponse.json({
    report: 'spend-analysis',
    generatedAt: new Date().toISOString(),
    vendorSpend,
    categorySpend,
  });
}
