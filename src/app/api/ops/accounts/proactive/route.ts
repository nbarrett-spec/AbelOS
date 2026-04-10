export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Proactive Account Management API
// Account health monitoring, automated review triggers, retention recommendations,
// account growth planning, touchpoint tracking, and win-back automation

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AccountTouchpoint" (
      id TEXT PRIMARY KEY,
      "builderId" TEXT NOT NULL,
      "staffId" TEXT,
      "touchType" TEXT NOT NULL,
      channel TEXT DEFAULT 'PHONE',
      subject TEXT,
      notes TEXT,
      outcome TEXT,
      "followUpDate" DATE,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_touchpoint_builder" ON "AccountTouchpoint"("builderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_touchpoint_date" ON "AccountTouchpoint"("createdAt")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AccountReviewTrigger" (
      id TEXT PRIMARY KEY,
      "builderId" TEXT NOT NULL,
      "triggerType" TEXT NOT NULL,
      severity TEXT DEFAULT 'MEDIUM',
      description TEXT,
      "isResolved" BOOLEAN DEFAULT FALSE,
      "resolvedBy" TEXT,
      "resolvedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_review_trigger_builder" ON "AccountReviewTrigger"("builderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_review_trigger_resolved" ON "AccountReviewTrigger"("isResolved")`);
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTables();
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';
    const builderId = searchParams.get('builderId');

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'account-health': return await getAccountHealth();
      case 'review-queue': return await getReviewQueue();
      case 'retention': return await getRetentionAnalysis();
      case 'growth-plans': return await getGrowthPlans();
      case 'touchpoints': return await getTouchpoints(builderId);
      case 'win-back': return await getWinBackCandidates();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Proactive account management error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTables();
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'log-touchpoint': return await logTouchpoint(body);
      case 'generate-triggers': return await generateTriggers();
      case 'resolve-trigger': return await resolveTrigger(body);
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Proactive account management POST error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Overall account health distribution
  const healthDist: any[] = await prisma.$queryRawUnsafe(`
    WITH builder_metrics AS (
      SELECT
        b.id,
        b."companyName",
        b.status,
        COALESCE(SUM(o.total), 0) as "totalRevenue",
        COUNT(o.id) as "orderCount",
        MAX(o."createdAt") as "lastOrderDate",
        MIN(o."createdAt") as "firstOrderDate",
        EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(o."createdAt"), b."createdAt")))::integer as "daysSinceLastOrder"
      FROM "Builder" b
      LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
      WHERE b.status = 'ACTIVE'
      GROUP BY b.id, b."companyName", b.status
    )
    SELECT
      COUNT(*)::int as "totalAccounts",
      COUNT(CASE WHEN "daysSinceLastOrder" <= 30 AND "orderCount" >= 3 THEN 1 END)::int as "thriving",
      COUNT(CASE WHEN "daysSinceLastOrder" <= 60 AND "orderCount" >= 1 THEN 1 END)::int as "healthy",
      COUNT(CASE WHEN "daysSinceLastOrder" BETWEEN 60 AND 120 AND "orderCount" >= 1 THEN 1 END)::int as "atRisk",
      COUNT(CASE WHEN "daysSinceLastOrder" > 120 AND "orderCount" >= 1 THEN 1 END)::int as "dormant",
      COUNT(CASE WHEN "orderCount" = 0 THEN 1 END)::int as "neverOrdered",
      ROUND(COALESCE(AVG("totalRevenue"), 0)::numeric, 2) as "avgRevenue",
      ROUND(COALESCE(SUM("totalRevenue"), 0)::numeric, 2) as "totalPortfolioValue"
    FROM builder_metrics
  `);

  // Pending review triggers
  const pendingTriggers: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalPending",
      COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END)::int as "critical",
      COUNT(CASE WHEN severity = 'HIGH' THEN 1 END)::int as "high",
      COUNT(CASE WHEN severity = 'MEDIUM' THEN 1 END)::int as "medium",
      COUNT(CASE WHEN severity = 'LOW' THEN 1 END)::int as "low"
    FROM "AccountReviewTrigger"
    WHERE "isResolved" = FALSE
  `);

  // Recent touchpoints
  const recentTouchpoints: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalThisMonth",
      COUNT(CASE WHEN channel = 'PHONE' THEN 1 END)::int as "phoneCalls",
      COUNT(CASE WHEN channel = 'EMAIL' THEN 1 END)::int as "emails",
      COUNT(CASE WHEN channel = 'IN_PERSON' THEN 1 END)::int as "inPerson",
      COUNT(CASE WHEN channel = 'TEXT' THEN 1 END)::int as "texts"
    FROM "AccountTouchpoint"
    WHERE "createdAt" > NOW() - INTERVAL '30 days'
  `);

  // Accounts needing attention (no touchpoint in 60+ days with $10K+ revenue)
  const needsAttention: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."contactName", b.email, b.phone,
      COALESCE(SUM(o.total), 0)::float as "totalRevenue",
      MAX(o."createdAt") as "lastOrder",
      COALESCE(MAX(tp."createdAt"), b."createdAt") as "lastContact",
      EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(tp."createdAt"), b."createdAt")))::integer as "daysSinceContact"
    FROM "Builder" b
    LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
    LEFT JOIN "AccountTouchpoint" tp ON b.id = tp."builderId"
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName", b."contactName", b.email, b.phone
    HAVING COALESCE(SUM(o.total), 0) >= 10000
      AND EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(tp."createdAt"), b."createdAt"))) > 60
    ORDER BY COALESCE(SUM(o.total), 0) DESC
    LIMIT 15
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    healthDistribution: healthDist[0] || {},
    pendingTriggers: pendingTriggers[0] || {},
    touchpointActivity: recentTouchpoints[0] || {},
    needsAttention,
  });
}

async function getAccountHealth() {
  // Per-account health scoring
  const accounts: any[] = await prisma.$queryRawUnsafe(`
    WITH metrics AS (
      SELECT
        b.id, b."companyName", b."contactName", b.email, b.phone,
        b."creditLimit", b."accountBalance", b."paymentTerm",
        COUNT(o.id)::int as "orderCount",
        COALESCE(SUM(o.total), 0)::numeric as "totalRevenue",
        MAX(o."createdAt") as "lastOrderDate",
        MIN(o."createdAt") as "firstOrderDate",
        EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(o."createdAt"), b."createdAt")))::integer as "daysSinceLastOrder",
        EXTRACT(DAY FROM AGE(NOW(), b."createdAt"))::integer as "tenureDays",
        COUNT(CASE WHEN o."createdAt" > NOW() - INTERVAL '90 days' THEN 1 END)::int as "recentOrders",
        COALESCE(SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '90 days' THEN o.total ELSE 0 END), 0)::numeric as "recentRevenue"
      FROM "Builder" b
      LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
      WHERE b.status = 'ACTIVE'
      GROUP BY b.id, b."companyName", b."contactName", b.email, b.phone, b."creditLimit", b."accountBalance", b."paymentTerm"
    )
    SELECT *,
      CASE
        WHEN "orderCount" = 0 THEN 'NEW'
        WHEN "daysSinceLastOrder" <= 30 AND "recentOrders" >= 2 THEN 'THRIVING'
        WHEN "daysSinceLastOrder" <= 60 THEN 'HEALTHY'
        WHEN "daysSinceLastOrder" <= 120 THEN 'AT_RISK'
        ELSE 'DORMANT'
      END as "healthStatus",
      CASE
        WHEN "orderCount" = 0 THEN 10
        ELSE LEAST(100, GREATEST(0,
          -- Recency (0-30)
          CASE
            WHEN "daysSinceLastOrder" <= 14 THEN 30
            WHEN "daysSinceLastOrder" <= 30 THEN 25
            WHEN "daysSinceLastOrder" <= 60 THEN 15
            WHEN "daysSinceLastOrder" <= 120 THEN 5
            ELSE 0
          END +
          -- Frequency (0-25)
          LEAST(25, ("recentOrders" * 8)) +
          -- Monetary (0-25)
          CASE
            WHEN "totalRevenue" >= 100000 THEN 25
            WHEN "totalRevenue" >= 50000 THEN 20
            WHEN "totalRevenue" >= 20000 THEN 15
            WHEN "totalRevenue" >= 5000 THEN 10
            ELSE 5
          END +
          -- Tenure (0-20)
          CASE
            WHEN "tenureDays" >= 365 THEN 20
            WHEN "tenureDays" >= 180 THEN 15
            WHEN "tenureDays" >= 90 THEN 10
            ELSE 5
          END
        ))
      END as "healthScore"
    FROM metrics
    ORDER BY "totalRevenue" DESC
  `);

  return safeJson({
    report: 'account-health',
    generatedAt: new Date().toISOString(),
    accounts,
    summary: {
      thriving: accounts.filter(a => a.healthStatus === 'THRIVING').length,
      healthy: accounts.filter(a => a.healthStatus === 'HEALTHY').length,
      atRisk: accounts.filter(a => a.healthStatus === 'AT_RISK').length,
      dormant: accounts.filter(a => a.healthStatus === 'DORMANT').length,
      new: accounts.filter(a => a.healthStatus === 'NEW').length,
    },
  });
}

async function getReviewQueue() {
  // Active review triggers
  const triggers: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      art.id, art."builderId", art."triggerType", art.severity,
      art.description, art."createdAt",
      b."companyName", b."contactName", b.email, b.phone
    FROM "AccountReviewTrigger" art
    JOIN "Builder" b ON art."builderId" = b.id
    WHERE art."isResolved" = FALSE
    ORDER BY
      CASE art.severity
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        ELSE 4
      END,
      art."createdAt" DESC
  `);

  // Recently resolved
  const resolved: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      art.id, art."triggerType", art.severity, art.description,
      art."resolvedAt", b."companyName"
    FROM "AccountReviewTrigger" art
    JOIN "Builder" b ON art."builderId" = b.id
    WHERE art."isResolved" = TRUE
      AND art."resolvedAt" > NOW() - INTERVAL '30 days'
    ORDER BY art."resolvedAt" DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'review-queue',
    generatedAt: new Date().toISOString(),
    triggers,
    recentlyResolved: resolved,
    stats: {
      total: triggers.length,
      critical: triggers.filter(t => t.severity === 'CRITICAL').length,
      high: triggers.filter(t => t.severity === 'HIGH').length,
      medium: triggers.filter(t => t.severity === 'MEDIUM').length,
      low: triggers.filter(t => t.severity === 'LOW').length,
    },
  });
}

async function getRetentionAnalysis() {
  // Cohort retention: builders by signup month, with retention at 3/6/12 months
  const cohorts: any[] = await prisma.$queryRawUnsafe(`
    WITH cohort AS (
      SELECT
        DATE_TRUNC('month', b."createdAt") as "cohortMonth",
        b.id as "builderId"
      FROM "Builder" b
      WHERE b.status = 'ACTIVE'
        AND b."createdAt" > NOW() - INTERVAL '18 months'
    ),
    activity AS (
      SELECT
        c."cohortMonth",
        c."builderId",
        COUNT(CASE WHEN o."createdAt" <= c."cohortMonth" + INTERVAL '3 months' THEN 1 END) > 0 as "active3m",
        COUNT(CASE WHEN o."createdAt" <= c."cohortMonth" + INTERVAL '6 months' THEN 1 END) > 0 as "active6m",
        COUNT(CASE WHEN o."createdAt" <= c."cohortMonth" + INTERVAL '12 months' THEN 1 END) > 0 as "active12m"
      FROM cohort c
      LEFT JOIN "Order" o ON c."builderId" = o."builderId" AND o.status != 'CANCELLED'
      GROUP BY c."cohortMonth", c."builderId"
    )
    SELECT
      "cohortMonth",
      COUNT(*)::int as "cohortSize",
      COUNT(CASE WHEN "active3m" THEN 1 END)::int as "retained3m",
      COUNT(CASE WHEN "active6m" THEN 1 END)::int as "retained6m",
      COUNT(CASE WHEN "active12m" THEN 1 END)::int as "retained12m",
      ROUND(COUNT(CASE WHEN "active3m" THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as "retention3m",
      ROUND(COUNT(CASE WHEN "active6m" THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as "retention6m",
      ROUND(COUNT(CASE WHEN "active12m" THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as "retention12m"
    FROM activity
    GROUP BY "cohortMonth"
    ORDER BY "cohortMonth" DESC
  `);

  // Revenue retention: compare 90-day revenue windows
  const revenueRetention: any[] = await prisma.$queryRawUnsafe(`
    WITH current_period AS (
      SELECT "builderId", SUM(total) as revenue
      FROM "Order"
      WHERE status != 'CANCELLED'
        AND "createdAt" > NOW() - INTERVAL '90 days'
      GROUP BY "builderId"
    ),
    prior_period AS (
      SELECT "builderId", SUM(total) as revenue
      FROM "Order"
      WHERE status != 'CANCELLED'
        AND "createdAt" BETWEEN NOW() - INTERVAL '180 days' AND NOW() - INTERVAL '90 days'
      GROUP BY "builderId"
    )
    SELECT
      COUNT(DISTINCT pp."builderId")::int as "priorBuilders",
      COUNT(DISTINCT CASE WHEN cp."builderId" IS NOT NULL THEN pp."builderId" END)::int as "retainedBuilders",
      ROUND(COALESCE(SUM(pp.revenue), 0)::numeric, 2) as "priorRevenue",
      ROUND(COALESCE(SUM(CASE WHEN cp."builderId" IS NOT NULL THEN cp.revenue ELSE 0 END), 0)::numeric, 2) as "retainedRevenue",
      ROUND(
        COALESCE(SUM(CASE WHEN cp."builderId" IS NOT NULL THEN cp.revenue ELSE 0 END), 0)::numeric /
        NULLIF(COALESCE(SUM(pp.revenue), 0)::numeric, 0) * 100
      , 1) as "revenueRetentionPct"
    FROM prior_period pp
    LEFT JOIN current_period cp ON pp."builderId" = cp."builderId"
  `);

  // Churn reasons (builders who went dormant)
  const churnInsights: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."paymentTerm",
      COALESCE(SUM(o.total), 0)::numeric as "lifetimeRevenue",
      COUNT(o.id)::int as "orderCount",
      MAX(o."createdAt") as "lastOrder",
      EXTRACT(DAY FROM AGE(NOW(), MAX(o."createdAt")))::integer as "daysDormant"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName", b."paymentTerm"
    HAVING MAX(o."createdAt") < NOW() - INTERVAL '90 days'
      AND COUNT(o.id) >= 2
    ORDER BY COALESCE(SUM(o.total), 0) DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'retention',
    generatedAt: new Date().toISOString(),
    cohorts,
    revenueRetention: revenueRetention[0] || {},
    churnInsights,
  });
}

async function getGrowthPlans() {
  // Identify growth opportunities per account
  const growthAccounts: any[] = await prisma.$queryRawUnsafe(`
    WITH builder_stats AS (
      SELECT
        b.id, b."companyName", b."contactName", b.email,
        b."creditLimit", b."accountBalance",
        COUNT(DISTINCT o.id)::int as "orderCount",
        COALESCE(SUM(o.total), 0)::numeric as "totalRevenue",
        COALESCE(AVG(o.total), 0)::numeric as "avgOrderValue",
        COUNT(DISTINCT p.category)::int as "categoryCount",
        MAX(o."createdAt") as "lastOrder"
      FROM "Builder" b
      JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON oi."productId" = p.id
      WHERE b.status = 'ACTIVE'
      GROUP BY b.id, b."companyName", b."contactName", b.email, b."creditLimit", b."accountBalance"
      HAVING COUNT(DISTINCT o.id) >= 2
    )
    SELECT *,
      CASE
        WHEN "totalRevenue" >= 100000 THEN 'ENTERPRISE'
        WHEN "totalRevenue" >= 50000 THEN 'STRATEGIC'
        WHEN "totalRevenue" >= 20000 THEN 'GROWTH'
        WHEN "totalRevenue" >= 5000 THEN 'DEVELOPING'
        ELSE 'EMERGING'
      END as "accountTier",
      -- Growth potential signals
      CASE WHEN "categoryCount" <= 2 THEN TRUE ELSE FALSE END as "crossSellOpportunity",
      CASE
        WHEN "creditLimit" IS NOT NULL AND "totalRevenue" < "creditLimit" * 0.5 THEN TRUE
        ELSE FALSE
      END as "underutilizedCredit",
      CASE
        WHEN "avgOrderValue" < (SELECT AVG(total)::numeric FROM "Order" WHERE status != 'CANCELLED') * 0.7 THEN TRUE
        ELSE FALSE
      END as "upsellOpportunity",
      ROUND("avgOrderValue"::numeric, 2) as "avgOrderValueRounded"
    FROM builder_stats
    ORDER BY "totalRevenue" DESC
  `);

  // Category penetration across builders
  const categoryPenetration: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.category,
      COUNT(DISTINCT o."builderId")::int as "builderCount",
      COUNT(DISTINCT o.id)::int as "orderCount",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "totalRevenue"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id AND o.status != 'CANCELLED'
    JOIN "Product" p ON oi."productId" = p.id
    WHERE p.category IS NOT NULL
    GROUP BY p.category
    ORDER BY "totalRevenue" DESC
  `);

  return safeJson({
    report: 'growth-plans',
    generatedAt: new Date().toISOString(),
    accounts: growthAccounts,
    categoryPenetration,
    tierSummary: {
      enterprise: growthAccounts.filter(a => a.accountTier === 'ENTERPRISE').length,
      strategic: growthAccounts.filter(a => a.accountTier === 'STRATEGIC').length,
      growth: growthAccounts.filter(a => a.accountTier === 'GROWTH').length,
      developing: growthAccounts.filter(a => a.accountTier === 'DEVELOPING').length,
      emerging: growthAccounts.filter(a => a.accountTier === 'EMERGING').length,
    },
  });
}

async function getTouchpoints(builderId: string | null) {
  if (!builderId) {
    // All recent touchpoints
    const touchpoints: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        tp.id, tp."touchType", tp.channel, tp.subject, tp.notes, tp.outcome,
        tp."followUpDate", tp."createdAt",
        b."companyName", b."contactName"
      FROM "AccountTouchpoint" tp
      JOIN "Builder" b ON tp."builderId" = b.id
      ORDER BY tp."createdAt" DESC
      LIMIT 50
    `);

    return safeJson({
      report: 'touchpoints',
      generatedAt: new Date().toISOString(),
      touchpoints,
    });
  }

  // Touchpoints for specific builder
  const touchpoints: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      tp.id, tp."touchType", tp.channel, tp.subject, tp.notes, tp.outcome,
      tp."followUpDate", tp."createdAt"
    FROM "AccountTouchpoint" tp
    WHERE tp."builderId" = $1
    ORDER BY tp."createdAt" DESC
  `, builderId);

  const builderInfo: any[] = await prisma.$queryRawUnsafe(`
    SELECT b."companyName", b."contactName", b.email, b.phone
    FROM "Builder" b WHERE b.id = $1
  `, builderId);

  return safeJson({
    report: 'touchpoints',
    generatedAt: new Date().toISOString(),
    builder: builderInfo[0] || {},
    touchpoints,
  });
}

async function getWinBackCandidates() {
  // Dormant accounts with significant lifetime value
  const candidates: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."contactName", b.email, b.phone,
      COUNT(o.id)::int as "orderCount",
      ROUND(COALESCE(SUM(o.total), 0)::numeric, 2) as "lifetimeRevenue",
      ROUND(COALESCE(AVG(o.total), 0)::numeric, 2) as "avgOrderValue",
      MAX(o."createdAt") as "lastOrderDate",
      EXTRACT(DAY FROM AGE(NOW(), MAX(o."createdAt")))::integer as "daysDormant",
      CASE
        WHEN COALESCE(SUM(o.total), 0) >= 50000 THEN 'PLATINUM'
        WHEN COALESCE(SUM(o.total), 0) >= 20000 THEN 'GOLD'
        WHEN COALESCE(SUM(o.total), 0) >= 5000 THEN 'SILVER'
        ELSE 'BRONZE'
      END as "valueTier",
      CASE
        WHEN EXTRACT(DAY FROM AGE(NOW(), MAX(o."createdAt"))) BETWEEN 90 AND 180 THEN 'WINNABLE'
        WHEN EXTRACT(DAY FROM AGE(NOW(), MAX(o."createdAt"))) BETWEEN 180 AND 365 THEN 'CHALLENGING'
        ELSE 'LONG_SHOT'
      END as "winBackDifficulty"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName", b."contactName", b.email, b.phone
    HAVING MAX(o."createdAt") < NOW() - INTERVAL '90 days'
      AND SUM(o.total) >= 5000
    ORDER BY COALESCE(SUM(o.total), 0) DESC
  `);

  // Suggested win-back actions
  const summary = {
    totalCandidates: candidates.length,
    totalAtRiskRevenue: candidates.reduce((s, c) => s + Number(c.lifetimeRevenue || 0), 0),
    platinum: candidates.filter(c => c.valueTier === 'PLATINUM').length,
    gold: candidates.filter(c => c.valueTier === 'GOLD').length,
    silver: candidates.filter(c => c.valueTier === 'SILVER').length,
    winnable: candidates.filter(c => c.winBackDifficulty === 'WINNABLE').length,
    challenging: candidates.filter(c => c.winBackDifficulty === 'CHALLENGING').length,
  };

  return safeJson({
    report: 'win-back',
    generatedAt: new Date().toISOString(),
    candidates,
    summary,
  });
}

async function logTouchpoint(body: any) {
  const { builderId, touchType, channel, subject, notes, outcome, followUpDate } = body;
  if (!builderId || !touchType) {
    return safeJson({ error: 'builderId and touchType required' }, { status: 400 });
  }

  const id = 'tp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "AccountTouchpoint" (id, "builderId", "touchType", channel, subject, notes, outcome, "followUpDate")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, id, builderId, touchType, channel || 'PHONE', subject || null, notes || null, outcome || null, followUpDate || null);

  return safeJson({ success: true, touchpointId: id });
}

async function generateTriggers() {
  // Auto-detect accounts needing review
  let created = 0;

  // 1. Spending drop-off: builders whose last 90d revenue < 50% of prior 90d
  const spendingDrops: any[] = await prisma.$queryRawUnsafe(`
    WITH current AS (
      SELECT "builderId", SUM(total) as rev
      FROM "Order" WHERE status != 'CANCELLED' AND "createdAt" > NOW() - INTERVAL '90 days'
      GROUP BY "builderId"
    ),
    prior AS (
      SELECT "builderId", SUM(total) as rev
      FROM "Order" WHERE status != 'CANCELLED'
        AND "createdAt" BETWEEN NOW() - INTERVAL '180 days' AND NOW() - INTERVAL '90 days'
      GROUP BY "builderId"
    )
    SELECT p."builderId", p.rev as "priorRev", COALESCE(c.rev, 0) as "currentRev"
    FROM prior p
    LEFT JOIN current c ON p."builderId" = c."builderId"
    WHERE COALESCE(c.rev, 0) < p.rev * 0.5
      AND p.rev >= 5000
      AND NOT EXISTS (
        SELECT 1 FROM "AccountReviewTrigger" art
        WHERE art."builderId" = p."builderId"
          AND art."triggerType" = 'SPENDING_DROP'
          AND art."isResolved" = FALSE
      )
  `);

  for (const drop of spendingDrops) {
    const id = 'art_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "AccountReviewTrigger" (id, "builderId", "triggerType", severity, description)
      VALUES ($1, $2, 'SPENDING_DROP', 'HIGH', $3)
    `, id, drop.builderId, `Revenue dropped from $${Number(drop.priorRev).toLocaleString()} to $${Number(drop.currentRev).toLocaleString()} (last 90 days vs prior 90 days)`);
    created++;
  }

  // 2. Payment delinquency: overdue invoices
  const overdue: any[] = await prisma.$queryRawUnsafe(`
    SELECT o."builderId", COUNT(*)::int as "overdueCount",
      SUM(o.total)::float as "overdueAmount"
    FROM "Order" o
    WHERE o."paymentStatus" IN ('PENDING', 'PARTIAL')
      AND o."dueDate" < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM "AccountReviewTrigger" art
        WHERE art."builderId" = o."builderId"
          AND art."triggerType" = 'PAYMENT_DELINQUENT'
          AND art."isResolved" = FALSE
      )
    GROUP BY o."builderId"
    HAVING COUNT(*) >= 2
  `);

  for (const od of overdue) {
    const id = 'art_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "AccountReviewTrigger" (id, "builderId", "triggerType", severity, description)
      VALUES ($1, $2, 'PAYMENT_DELINQUENT', 'CRITICAL', $3)
    `, id, od.builderId, `${od.overdueCount} overdue invoices totaling $${Number(od.overdueAmount).toLocaleString()}`);
    created++;
  }

  // 3. Inactive high-value: $20K+ lifetime, no orders in 60+ days
  const inactive: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, SUM(o.total) as "lifetime"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
    WHERE b.status = 'ACTIVE'
    GROUP BY b.id
    HAVING SUM(o.total) >= 20000
      AND MAX(o."createdAt") < NOW() - INTERVAL '60 days'
      AND NOT EXISTS (
        SELECT 1 FROM "AccountReviewTrigger" art
        WHERE art."builderId" = b.id
          AND art."triggerType" = 'INACTIVE_HIGH_VALUE'
          AND art."isResolved" = FALSE
      )
  `);

  for (const inv of inactive) {
    const id = 'art_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "AccountReviewTrigger" (id, "builderId", "triggerType", severity, description)
      VALUES ($1, $2, 'INACTIVE_HIGH_VALUE', 'HIGH', $3)
    `, id, inv.id, `High-value account ($${Number(inv.lifetime).toLocaleString()} lifetime) with no recent orders`);
    created++;
  }

  return safeJson({ success: true, triggersCreated: created });
}

async function resolveTrigger(body: any) {
  const { triggerId, resolvedBy } = body;
  if (!triggerId) return NextResponse.json({ error: 'triggerId required' }, { status: 400 });

  await prisma.$executeRawUnsafe(`
    UPDATE "AccountReviewTrigger"
    SET "isResolved" = TRUE, "resolvedBy" = $2, "resolvedAt" = NOW()
    WHERE id = $1
  `, triggerId, resolvedBy || null);

  return safeJson({ success: true });
}
