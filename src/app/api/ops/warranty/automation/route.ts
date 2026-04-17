export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// Warranty Automation API
// Automated warranty tracking, expiration alerts, claim pattern analysis,
// proactive warranty outreach, and cost analytics

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WarrantyTracker" (
      id TEXT PRIMARY KEY,
      "orderId" TEXT,
      "orderItemId" TEXT,
      "builderId" TEXT NOT NULL,
      "productId" TEXT,
      "productName" TEXT,
      "warrantyType" TEXT DEFAULT 'STANDARD',
      "startDate" DATE NOT NULL,
      "endDate" DATE NOT NULL,
      "status" TEXT DEFAULT 'ACTIVE',
      "claimCount" INTEGER DEFAULT 0,
      "lastClaimDate" DATE,
      notes TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_warranty_builder" ON "WarrantyTracker"("builderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_warranty_end" ON "WarrantyTracker"("endDate")`);
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTables();
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'expiring': return await getExpiring();
      case 'claim-patterns': return await getClaimPatterns();
      case 'cost-analysis': return await getCostAnalysis();
      case 'builder-warranties': return await getBuilderWarranties();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Warranty automation error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Warranty', undefined, { method: 'POST' }).catch(() => {})

    await ensureTables();
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'auto-generate': return await autoGenerateWarranties();
      case 'register-warranty': return await registerWarranty(body);
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Warranty automation POST error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Warranty overview
  const overview: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as "totalWarranties",
      COUNT(CASE WHEN status = 'ACTIVE' AND "endDate" >= CURRENT_DATE THEN 1 END) as "activeWarranties",
      COUNT(CASE WHEN "endDate" < CURRENT_DATE THEN 1 END) as "expiredWarranties",
      COUNT(CASE WHEN "endDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as "expiring30d",
      COUNT(CASE WHEN "endDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days' THEN 1 END) as "expiring90d",
      COALESCE(SUM("claimCount"), 0) as "totalClaims"
    FROM "WarrantyTracker"
  `);

  // Existing warranty claims from the Warranty model
  const claimStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as "totalClaims",
      COUNT(CASE WHEN status = 'OPEN' THEN 1 END) as "openClaims",
      COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as "inProgressClaims",
      COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) as "resolvedClaims",
      COUNT(CASE WHEN status = 'DENIED' THEN 1 END) as "deniedClaims",
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '30 days' THEN 1 END) as "newThisMonth"
    FROM "WarrantyClaim"
  `);

  // Recent claims
  const recentClaims: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      wc.id, wc."claimNumber", wc.status, wc.description,
      wc."createdAt", b."companyName"
    FROM "WarrantyClaim" wc
    JOIN "Builder" b ON wc."builderId" = b.id
    ORDER BY wc."createdAt" DESC
    LIMIT 10
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    overview: overview[0] || {},
    claimStats: claimStats[0] || {},
    recentClaims,
  });
}

async function getExpiring() {
  // Warranties expiring in next 30/60/90 days
  const expiring: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      wt.id, wt."productName", wt."warrantyType", wt."startDate", wt."endDate",
      wt."claimCount", wt.status,
      b."companyName", b."contactName", b.email, b.phone,
      EXTRACT(DAY FROM AGE(wt."endDate", CURRENT_DATE))::integer as "daysRemaining",
      CASE
        WHEN wt."endDate" <= CURRENT_DATE + INTERVAL '30 days' THEN 'URGENT'
        WHEN wt."endDate" <= CURRENT_DATE + INTERVAL '60 days' THEN 'SOON'
        ELSE 'UPCOMING'
      END as urgency
    FROM "WarrantyTracker" wt
    JOIN "Builder" b ON wt."builderId" = b.id
    WHERE wt."endDate" >= CURRENT_DATE AND wt."endDate" <= CURRENT_DATE + INTERVAL '90 days'
      AND wt.status = 'ACTIVE'
    ORDER BY wt."endDate" ASC
  `);

  // Recently expired (last 30 days) — opportunity for extended warranty upsell
  const recentlyExpired: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      wt.id, wt."productName", wt."warrantyType", wt."endDate",
      b."companyName", b.email, b.phone,
      EXTRACT(DAY FROM AGE(CURRENT_DATE, wt."endDate"))::integer as "daysSinceExpired"
    FROM "WarrantyTracker" wt
    JOIN "Builder" b ON wt."builderId" = b.id
    WHERE wt."endDate" BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE
    ORDER BY wt."endDate" DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'expiring',
    generatedAt: new Date().toISOString(),
    expiring,
    recentlyExpired,
    summary: {
      urgent: expiring.filter((e: any) => e.urgency === 'URGENT').length,
      soon: expiring.filter((e: any) => e.urgency === 'SOON').length,
      upcoming: expiring.filter((e: any) => e.urgency === 'UPCOMING').length,
    },
  });
}

async function getClaimPatterns() {
  // Claims by product category
  const byCategory: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(p.category, 'Unknown') as category,
      COUNT(*) as "claimCount",
      COUNT(CASE WHEN wc.status = 'RESOLVED' THEN 1 END) as resolved,
      COUNT(CASE WHEN wc.status = 'DENIED' THEN 1 END) as denied
    FROM "WarrantyClaim" wc
    LEFT JOIN "Product" p ON wc."productId" = p.id
    GROUP BY p.category
    ORDER BY "claimCount" DESC
  `);

  // Claims by builder (repeat claimers)
  const byBuilder: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."contactName", b.email,
      COUNT(wc.id) as "claimCount",
      COUNT(CASE WHEN wc.status = 'OPEN' OR wc.status = 'IN_PROGRESS' THEN 1 END) as "activeClaims",
      MIN(wc."createdAt") as "firstClaim",
      MAX(wc."createdAt") as "lastClaim"
    FROM "WarrantyClaim" wc
    JOIN "Builder" b ON wc."builderId" = b.id
    GROUP BY b.id, b."companyName", b."contactName", b.email
    HAVING COUNT(wc.id) >= 2
    ORDER BY "claimCount" DESC
    LIMIT 20
  `);

  // Monthly claim volume
  const monthly: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', "createdAt") as month,
      COUNT(*) as claims,
      COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) as resolved,
      COUNT(CASE WHEN status = 'DENIED' THEN 1 END) as denied
    FROM "WarrantyClaim"
    WHERE "createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY month ASC
  `);

  // Common claim reasons
  const reasons: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(SUBSTRING(description FROM 1 FOR 80), 'No description') as reason,
      COUNT(*) as count
    FROM "WarrantyClaim"
    GROUP BY SUBSTRING(description FROM 1 FOR 80)
    ORDER BY count DESC
    LIMIT 15
  `);

  return safeJson({
    report: 'claim-patterns',
    generatedAt: new Date().toISOString(),
    byCategory,
    byBuilder,
    monthly,
    reasons,
  });
}

async function getCostAnalysis() {
  // Warranty cost estimation (based on claim resolution)
  const costs: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(p.category, 'Unknown') as category,
      COUNT(wc.id) as "totalClaims",
      COUNT(CASE WHEN wc.status = 'RESOLVED' THEN 1 END) as "resolvedClaims",
      -- Estimate replacement cost from product base price
      ROUND(COALESCE(SUM(CASE WHEN wc.status = 'RESOLVED' THEN p."basePrice" ELSE 0 END), 0)::numeric, 2) as "estimatedReplacementCost",
      ROUND(COALESCE(AVG(CASE WHEN wc.status = 'RESOLVED' THEN p."basePrice" ELSE NULL END), 0)::numeric, 2) as "avgClaimCost"
    FROM "WarrantyClaim" wc
    LEFT JOIN "Product" p ON wc."productId" = p.id
    GROUP BY p.category
    ORDER BY "estimatedReplacementCost" DESC
  `);

  // Total warranty liability
  const liability: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as "activeWarranties",
      -- Estimate potential liability: active warranties * historical claim rate * avg cost
      ROUND((
        COUNT(*)::numeric *
        (SELECT COALESCE(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM "WarrantyTracker"), 0), 0.05) FROM "WarrantyClaim") *
        COALESCE((SELECT AVG("basePrice") FROM "Product" WHERE "basePrice" > 0), 100)
      )::numeric, 2) as "estimatedLiability"
    FROM "WarrantyTracker"
    WHERE status = 'ACTIVE' AND "endDate" >= CURRENT_DATE
  `);

  return safeJson({
    report: 'cost-analysis',
    generatedAt: new Date().toISOString(),
    costByCategory: costs,
    totalReplacementCost: costs.reduce((s, c) => s + Number(c.estimatedReplacementCost || 0), 0),
    liability: liability[0] || {},
  });
}

async function getBuilderWarranties() {
  // Per-builder warranty summary
  const builders: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."contactName", b.email,
      COUNT(wt.id) as "warrantyCount",
      COUNT(CASE WHEN wt.status = 'ACTIVE' AND wt."endDate" >= CURRENT_DATE THEN 1 END) as "activeCount",
      COUNT(CASE WHEN wt."endDate" < CURRENT_DATE THEN 1 END) as "expiredCount",
      COUNT(CASE WHEN wt."endDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days' THEN 1 END) as "expiringSoon",
      COALESCE(SUM(wt."claimCount"), 0) as "totalClaims",
      MIN(wt."startDate") as "earliestWarranty",
      MAX(wt."endDate") as "latestExpiry"
    FROM "Builder" b
    JOIN "WarrantyTracker" wt ON b.id = wt."builderId"
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName", b."contactName", b.email
    ORDER BY "warrantyCount" DESC
  `);

  return safeJson({
    report: 'builder-warranties',
    generatedAt: new Date().toISOString(),
    builders,
  });
}

async function autoGenerateWarranties() {
  // Auto-generate warranty records from delivered orders that don't have warranties yet
  const newWarranties: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id as "orderId", o."builderId", oi.id as "orderItemId",
      oi."productId", oi.description as "productName",
      o."createdAt" as "orderDate"
    FROM "Order" o
    JOIN "OrderItem" oi ON o.id = oi."orderId"
    WHERE o.status = 'DELIVERED'
    AND NOT EXISTS (
      SELECT 1 FROM "WarrantyTracker" wt
      WHERE wt."orderItemId" = oi.id
    )
    LIMIT 100
  `);

  let created = 0;
  for (const item of newWarranties) {
    const id = 'wt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const startDate = new Date(item.orderDate);
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1); // 1 year standard warranty

    await prisma.$executeRawUnsafe(`
      INSERT INTO "WarrantyTracker" (id, "orderId", "orderItemId", "builderId", "productId", "productName", "warrantyType", "startDate", "endDate", status)
      VALUES ($1, $2, $3, $4, $5, $6, 'STANDARD', $7, $8, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `, id, item.orderId, item.orderItemId, item.builderId, item.productId, item.productName || 'Product', startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);
    created++;
  }

  return safeJson({ success: true, warrantyCount: created });
}

async function registerWarranty(body: any) {
  const { builderId, productId, productName, warrantyType, startDate, endDate } = body;
  if (!builderId || !startDate || !endDate) return NextResponse.json({ error: 'builderId, startDate, endDate required' }, { status: 400 });

  const id = 'wt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "WarrantyTracker" (id, "builderId", "productId", "productName", "warrantyType", "startDate", "endDate")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, id, builderId, productId || null, productName || 'Product', warrantyType || 'STANDARD', startDate, endDate);

  return safeJson({ success: true, warrantyId: id });
}
