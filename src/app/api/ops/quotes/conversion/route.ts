export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'

function safeJson(data: any, init?: { status?: number }): NextResponse {
  const json = JSON.stringify(data, (_k, v) => typeof v === 'bigint' ? Number(v) : v)
  return new NextResponse(json, { status: init?.status || 200, headers: { 'Content-Type': 'application/json' } })
}

// Quote Conversion Tracking API
// Analyzes where quotes die, why they don't convert, and identifies recovery opportunities

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'funnel';

    switch (report) {
      case 'funnel':
        return await getConversionFunnel();
      case 'by-builder':
        return await getConversionByBuilder();
      case 'by-category':
        return await getConversionByCategory();
      case 'recovery':
        return await getRecoveryOpportunities();
      case 'trends':
        return await getConversionTrends();
      default:
        return safeJson({ error: 'Unknown report type' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Quote conversion error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getConversionFunnel() {
  // Overall funnel
  const funnel: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      status,
      COUNT(*) as "count",
      ROUND(COALESCE(SUM("total"), 0)::numeric, 2) as "totalValue",
      ROUND(AVG("total")::numeric, 2) as "avgValue",
      ROUND(AVG(EXTRACT(DAY FROM (NOW() - "createdAt")))::numeric, 0) as "avgAge"
    FROM "Quote"
    GROUP BY status
    ORDER BY
      CASE status::text
        WHEN 'DRAFT' THEN 1
        WHEN 'SENT' THEN 2
        WHEN 'APPROVED' THEN 3
        WHEN 'ORDERED' THEN 4
        WHEN 'EXPIRED' THEN 5
        WHEN 'REJECTED' THEN 6
        ELSE 8
      END
  `);

  // Conversion rates between stages
  const totalQuotes = funnel.reduce((sum, f) => sum + Number(f.count), 0);
  const sentCount = Number(funnel.find(f => f.status === 'SENT')?.count || 0);
  const orderedCount = Number(funnel.find(f => f.status === 'ORDERED')?.count || 0);
  const expiredCount = Number(funnel.find(f => f.status === 'EXPIRED')?.count || 0);

  // Time-to-conversion for ordered quotes
  const timeToConvert: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(AVG(EXTRACT(DAY FROM ("updatedAt" - "createdAt")))::numeric, 1) as "avgDays",
      ROUND(MIN(EXTRACT(DAY FROM ("updatedAt" - "createdAt")))::numeric, 1) as "minDays",
      ROUND(MAX(EXTRACT(DAY FROM ("updatedAt" - "createdAt")))::numeric, 1) as "maxDays"
    FROM "Quote"
    WHERE status = 'ORDERED'
  `);

  return safeJson({
    report: 'funnel',
    generatedAt: new Date().toISOString(),
    funnel,
    summary: {
      totalQuotes,
      overallConversionPct: totalQuotes > 0 ? ((orderedCount / totalQuotes) * 100).toFixed(1) : '0',
      sentToOrderPct: sentCount > 0 ? ((orderedCount / sentCount) * 100).toFixed(1) : '0',
      expirationRate: totalQuotes > 0 ? ((expiredCount / totalQuotes) * 100).toFixed(1) : '0',
      totalRevenueLost: funnel.find(f => f.status === 'EXPIRED')?.totalValue || 0,
    },
    timeToConvert: timeToConvert[0] || {},
  });
}

async function getConversionByBuilder() {
  const builderConversion: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id as "builderId",
      b."companyName",
      COUNT(*) as "totalQuotes",
      COUNT(CASE WHEN q.status::text = 'ORDERED' THEN 1 END) as "converted",
      COUNT(CASE WHEN q.status::text = 'EXPIRED' THEN 1 END) as "expired",
      COUNT(CASE WHEN q.status::text IN ('DRAFT', 'SENT') THEN 1 END) as "pending",
      ROUND(
        CASE WHEN COUNT(*) > 0
        THEN COUNT(CASE WHEN q.status = 'ORDERED' THEN 1 END)::numeric / COUNT(*)::numeric * 100
        ELSE 0 END, 1
      ) as "conversionPct",
      ROUND(COALESCE(SUM(q."total"), 0)::numeric, 2) as "totalQuotedValue",
      ROUND(COALESCE(SUM(CASE WHEN q.status = 'ORDERED' THEN q."total" ELSE 0 END), 0)::numeric, 2) as "convertedValue",
      ROUND(COALESCE(SUM(CASE WHEN q.status = 'EXPIRED' THEN q."total" ELSE 0 END), 0)::numeric, 2) as "expiredValue"
    FROM "Quote" q
    JOIN "Project" p ON q."projectId" = p.id
    JOIN "Builder" b ON p."builderId" = b.id
    GROUP BY b.id, b."companyName"
    HAVING COUNT(*) >= 1
    ORDER BY "totalQuotedValue" DESC
  `);

  return safeJson({
    report: 'by-builder',
    generatedAt: new Date().toISOString(),
    builders: builderConversion,
  });
}

async function getConversionByCategory() {
  // Which product categories have the best/worst quote-to-order conversion
  const categoryConversion: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(p.category, 'Unknown') as category,
      COUNT(DISTINCT q.id) as "quotesContaining",
      COUNT(DISTINCT CASE WHEN q.status::text = 'ORDERED' THEN q.id END) as "orderedQuotes",
      ROUND(
        CASE WHEN COUNT(DISTINCT q.id) > 0
        THEN COUNT(DISTINCT CASE WHEN q.status::text = 'ORDERED' THEN q.id END)::numeric / COUNT(DISTINCT q.id)::numeric * 100
        ELSE 0 END, 1
      ) as "conversionPct",
      ROUND(SUM(qi."lineTotal")::numeric, 2) as "totalQuotedValue",
      ROUND(SUM(CASE WHEN q.status::text = 'ORDERED' THEN qi."lineTotal" ELSE 0 END)::numeric, 2) as "convertedValue",
      ROUND(AVG(qi."unitPrice")::numeric, 2) as "avgUnitPrice",
      SUM(qi.quantity) as "totalQty"
    FROM "QuoteItem" qi
    JOIN "Quote" q ON qi."quoteId" = q.id
    LEFT JOIN "Product" p ON qi."productId" = p.id
    GROUP BY p.category
    ORDER BY "totalQuotedValue" DESC
  `);

  return safeJson({
    report: 'by-category',
    generatedAt: new Date().toISOString(),
    categories: categoryConversion,
  });
}

async function getRecoveryOpportunities() {
  // Recently expired or stale quotes that could be recovered
  const recoverable: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      q.id, q.status, q."total", q."createdAt", q."validUntil",
      b.id as "builderId", b."companyName", b.email, b.phone,
      p.name as "projectName",
      EXTRACT(DAY FROM (NOW() - q."createdAt"))::int as "daysSinceCreated",
      (SELECT COUNT(*) FROM "Order" o WHERE o."builderId" = b.id AND o."createdAt" > NOW() - INTERVAL '90 days') as "recentOrders"
    FROM "Quote" q
    LEFT JOIN "Project" p ON q."projectId" = p.id
    JOIN "Builder" b ON p."builderId" = b.id
    WHERE q.status::text IN ('EXPIRED', 'SENT')
    AND q."total" > 500
    AND q."createdAt" > NOW() - INTERVAL '60 days'
    ORDER BY q."total" DESC
    LIMIT 30
  `);

  // Builders who got quotes but never ordered (anywhere)
  const neverOrdered: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id as "builderId", b."companyName", b.email,
      COUNT(q.id) as "quoteCount",
      ROUND(SUM(q."total")::numeric, 2) as "totalQuoted",
      MAX(q."createdAt") as "lastQuoteDate"
    FROM "Builder" b
    JOIN "Quote" q ON q."projectId" IN (SELECT id FROM "Project" WHERE "builderId" = b.id)
    LEFT JOIN "Order" o ON b.id = o."builderId"
    WHERE o.id IS NULL
    GROUP BY b.id, b."companyName", b.email
    HAVING COUNT(q.id) >= 1
    ORDER BY SUM(q."total") DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'recovery',
    generatedAt: new Date().toISOString(),
    recoverable,
    neverOrdered,
    totalRecoverableValue: recoverable.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0),
  });
}

async function getConversionTrends() {
  // Monthly conversion trend
  const monthly: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', "createdAt") as "month",
      COUNT(*) as "totalQuotes",
      COUNT(CASE WHEN status::text = 'ORDERED' THEN 1 END) as "converted",
      COUNT(CASE WHEN status::text = 'EXPIRED' THEN 1 END) as "expired",
      ROUND(COALESCE(SUM("total"), 0)::numeric, 2) as "totalValue",
      ROUND(COALESCE(SUM(CASE WHEN status::text = 'ORDERED' THEN "total" ELSE 0 END), 0)::numeric, 2) as "convertedValue",
      ROUND(
        CASE WHEN COUNT(*) > 0
        THEN COUNT(CASE WHEN status::text = 'ORDERED' THEN 1 END)::numeric / COUNT(*)::numeric * 100
        ELSE 0 END, 1
      ) as "conversionPct"
    FROM "Quote"
    WHERE "createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY "month" DESC
  `);

  return safeJson({
    report: 'trends',
    generatedAt: new Date().toISOString(),
    monthly,
  });
}
