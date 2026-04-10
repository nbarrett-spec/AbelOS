export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Sales Follow-Up Engine
// Identifies deals that need attention, stale quotes, and auto-generates follow-up tasks

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard':
        return await getFollowUpDashboard();
      case 'stale-deals':
        return await getStaleDeals();
      case 'stale-quotes':
        return await getStaleQuotes();
      case 'rep-activity':
        return await getRepActivity();
      case 'pipeline-velocity':
        return await getPipelineVelocity();
      default:
        return NextResponse.json({ error: 'Unknown report type' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Follow-up engine error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =====================================================
// DASHBOARD: Sales follow-up overview
// =====================================================
async function getFollowUpDashboard() {
  // Pipeline summary
  const pipeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      "stage"::text AS "stage",
      COUNT(*) as "dealCount",
      ROUND(COALESCE(SUM("dealValue"), 0)::numeric, 2) as "totalValue",
      ROUND(AVG(EXTRACT(DAY FROM (NOW() - "createdAt")))::numeric, 0) as "avgDaysInPipeline"
    FROM "Deal"
    WHERE "stage"::text NOT IN ('WON', 'LOST')
    GROUP BY "stage"::text
    ORDER BY
      CASE "stage"::text
        WHEN 'PROSPECT' THEN 1
        WHEN 'DISCOVERY' THEN 2
        WHEN 'BID_SUBMITTED' THEN 3
        WHEN 'NEGOTIATION' THEN 4
        WHEN 'WALKTHROUGH' THEN 5
        WHEN 'BID_REVIEW' THEN 6
        ELSE 7
      END
  `);

  // Deals needing follow-up (no activity in last 7 days)
  const needsFollowUp: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d.id, d."dealNumber", d."stage"::text AS "stage", d."dealValue", d."companyName",
      d."ownerId", d."createdAt",
      EXTRACT(DAY FROM (NOW() - d."updatedAt"))::int as "daysSinceUpdate",
      (SELECT MAX(da."createdAt") FROM "DealActivity" da WHERE da."dealId" = d.id) as "lastActivityDate",
      EXTRACT(DAY FROM (NOW() - COALESCE(
        (SELECT MAX(da."createdAt") FROM "DealActivity" da WHERE da."dealId" = d.id),
        d."createdAt"
      )))::int as "daysSinceActivity"
    FROM "Deal" d
    WHERE d."stage"::text NOT IN ('WON', 'LOST')
    AND COALESCE(
      (SELECT MAX(da."createdAt") FROM "DealActivity" da WHERE da."dealId" = d.id),
      d."createdAt"
    ) < NOW() - INTERVAL '7 days'
    ORDER BY d."dealValue" DESC
  `);

  // Win rate stats
  const winRate: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as "totalDeals",
      COUNT(CASE WHEN "stage"::text = 'WON' THEN 1 END) as "won",
      COUNT(CASE WHEN "stage"::text = 'LOST' THEN 1 END) as "lost",
      ROUND(
        CASE WHEN COUNT(CASE WHEN "stage"::text IN ('WON', 'LOST') THEN 1 END) > 0
        THEN COUNT(CASE WHEN "stage"::text = 'WON' THEN 1 END)::numeric / COUNT(CASE WHEN "stage"::text IN ('WON', 'LOST') THEN 1 END)::numeric * 100
        ELSE 0 END, 1
      ) as "winRatePct",
      ROUND(COALESCE(AVG(CASE WHEN "stage"::text = 'WON' THEN "dealValue" END), 0)::numeric, 2) as "avgWonValue",
      ROUND(COALESCE(SUM(CASE WHEN "stage"::text = 'WON' THEN "dealValue" ELSE 0 END), 0)::numeric, 2) as "totalWonValue"
    FROM "Deal"
    WHERE "createdAt" > NOW() - INTERVAL '180 days'
  `);

  // Quotes pending
  const pendingQuotes: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as "totalPending",
      ROUND(COALESCE(SUM("total"), 0)::numeric, 2) as "pendingValue",
      COUNT(CASE WHEN "createdAt" < NOW() - INTERVAL '7 days' AND "status"::text = 'SENT' THEN 1 END) as "staleCount",
      ROUND(COALESCE(SUM(CASE WHEN "createdAt" < NOW() - INTERVAL '7 days' AND "status"::text = 'SENT' THEN "total" ELSE 0 END), 0)::numeric, 2) as "staleValue"
    FROM "Quote"
    WHERE "status"::text IN ('DRAFT', 'SENT')
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    pipeline,
    needsFollowUp: { count: needsFollowUp.length, deals: needsFollowUp.slice(0, 20) },
    winRate: winRate[0] || {},
    pendingQuotes: pendingQuotes[0] || {},
    totalPipelineValue: pipeline.reduce((sum, p) => sum + Number(p.totalValue || 0), 0),
    totalActiveDeals: pipeline.reduce((sum, p) => sum + Number(p.dealCount || 0), 0),
  });
}

// =====================================================
// STALE DEALS: Deals going cold
// =====================================================
async function getStaleDeals() {
  const staleDeals: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d.id, d."dealNumber", d."stage"::text AS "stage", d."dealValue", d."companyName",
      d."contactName", d."contactEmail", d."contactPhone",
      d."ownerId", d."source"::text AS "source", d."expectedCloseDate",
      d."createdAt", d."updatedAt",
      EXTRACT(DAY FROM (NOW() - d."updatedAt"))::int as "daysSinceUpdate",
      EXTRACT(DAY FROM (NOW() - d."createdAt"))::int as "totalDaysOpen",
      (SELECT COUNT(*) FROM "DealActivity" da WHERE da."dealId" = d.id) as "activityCount",
      (SELECT MAX(da."createdAt") FROM "DealActivity" da WHERE da."dealId" = d.id) as "lastActivityDate",
      CASE
        WHEN EXTRACT(DAY FROM (NOW() - d."updatedAt")) > 30 THEN 'CRITICAL'
        WHEN EXTRACT(DAY FROM (NOW() - d."updatedAt")) > 14 THEN 'WARNING'
        WHEN EXTRACT(DAY FROM (NOW() - d."updatedAt")) > 7 THEN 'ATTENTION'
        ELSE 'OK'
      END as "staleness"
    FROM "Deal" d
    WHERE d."stage"::text NOT IN ('WON', 'LOST')
    AND d."updatedAt" < NOW() - INTERVAL '7 days'
    ORDER BY d."dealValue" DESC
  `);

  return safeJson({
    report: 'stale-deals',
    generatedAt: new Date().toISOString(),
    deals: staleDeals,
    summary: {
      critical: staleDeals.filter(d => d.staleness === 'CRITICAL').length,
      warning: staleDeals.filter(d => d.staleness === 'WARNING').length,
      attention: staleDeals.filter(d => d.staleness === 'ATTENTION').length,
      totalValue: staleDeals.reduce((sum, d) => sum + Number(d.dealValue || 0), 0),
    },
  });
}

// =====================================================
// STALE QUOTES: Quotes that need follow-up
// =====================================================
async function getStaleQuotes() {
  const staleQuotes: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      q.id, q."status"::text AS "status", q."total", q."createdAt", q."updatedAt",
      q."validUntil", q."version",
      b.id as "builderId", b."companyName", b.email,
      p.id as "projectId", p.name as "projectName",
      EXTRACT(DAY FROM (NOW() - q."createdAt"))::int as "daysOld",
      CASE
        WHEN q."validUntil" IS NOT NULL AND q."validUntil" < NOW() THEN 'EXPIRED'
        WHEN q."status"::text = 'SENT' AND q."createdAt" < NOW() - INTERVAL '14 days' THEN 'VERY_STALE'
        WHEN q."status"::text = 'SENT' AND q."createdAt" < NOW() - INTERVAL '7 days' THEN 'STALE'
        WHEN q."status"::text = 'DRAFT' AND q."createdAt" < NOW() - INTERVAL '3 days' THEN 'DRAFT_STALE'
        ELSE 'ACTIVE'
      END as "quoteHealth"
    FROM "Quote" q
    LEFT JOIN "Project" p ON q."projectId" = p.id
    JOIN "Builder" b ON p."builderId" = b.id
    WHERE q."status"::text IN ('DRAFT', 'SENT')
    ORDER BY q."total" DESC
  `);

  return safeJson({
    report: 'stale-quotes',
    generatedAt: new Date().toISOString(),
    quotes: staleQuotes,
    summary: {
      veryStale: staleQuotes.filter(q => q.quoteHealth === 'VERY_STALE').length,
      stale: staleQuotes.filter(q => q.quoteHealth === 'STALE').length,
      draftStale: staleQuotes.filter(q => q.quoteHealth === 'DRAFT_STALE').length,
      totalAtRisk: staleQuotes.reduce((sum, q) =>
        ['VERY_STALE', 'STALE'].includes(q.quoteHealth) ? sum + Number(q.totalAmount || 0) : sum, 0),
    },
  });
}

// =====================================================
// REP ACTIVITY: Sales rep performance
// =====================================================
async function getRepActivity() {
  const repStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d."ownerId" as "repName",
      COUNT(*) as "activeDeals",
      ROUND(COALESCE(SUM(CASE WHEN d."stage"::text NOT IN ('WON', 'LOST') THEN d."dealValue" ELSE 0 END), 0)::numeric, 2) as "pipelineValue",
      COUNT(CASE WHEN d."stage"::text = 'WON' AND d."updatedAt" > NOW() - INTERVAL '90 days' THEN 1 END) as "recentWins",
      ROUND(COALESCE(SUM(CASE WHEN d."stage"::text = 'WON' AND d."updatedAt" > NOW() - INTERVAL '90 days' THEN d."dealValue" ELSE 0 END), 0)::numeric, 2) as "recentWonValue",
      COUNT(CASE WHEN d."stage"::text NOT IN ('WON', 'LOST') AND d."updatedAt" < NOW() - INTERVAL '7 days' THEN 1 END) as "staleDeals",
      (SELECT COUNT(*) FROM "DealActivity" da JOIN "Deal" dd ON da."dealId" = dd.id
       WHERE dd."ownerId" = d."ownerId" AND da."createdAt" > NOW() - INTERVAL '7 days') as "weeklyActivities"
    FROM "Deal" d
    WHERE d."ownerId" IS NOT NULL
    GROUP BY d."ownerId"
    ORDER BY "pipelineValue" DESC
  `);

  return safeJson({
    report: 'rep-activity',
    generatedAt: new Date().toISOString(),
    reps: repStats,
  });
}

// =====================================================
// PIPELINE VELOCITY: How fast deals move
// =====================================================
async function getPipelineVelocity() {
  // Average time in each stage for won deals
  const stageVelocity: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      da.description as "toStage",
      ROUND(AVG(EXTRACT(DAY FROM (da."createdAt" - d."createdAt")))::numeric, 1) as "avgDaysToReach",
      COUNT(*) as "transitions"
    FROM "DealActivity" da
    JOIN "Deal" d ON da."dealId" = d.id
    WHERE da.type = 'STAGE_CHANGE'
    GROUP BY da.description
    ORDER BY "avgDaysToReach" ASC
  `);

  // Monthly deal flow
  const monthlyFlow: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', "createdAt") as "month",
      COUNT(*) as "newDeals",
      ROUND(SUM("dealValue")::numeric, 2) as "newValue",
      COUNT(CASE WHEN "stage"::text = 'WON' THEN 1 END) as "wonDeals",
      ROUND(COALESCE(SUM(CASE WHEN "stage"::text = 'WON' THEN "dealValue" ELSE 0 END), 0)::numeric, 2) as "wonValue"
    FROM "Deal"
    WHERE "createdAt" > NOW() - INTERVAL '6 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY "month" DESC
  `);

  return safeJson({
    report: 'pipeline-velocity',
    generatedAt: new Date().toISOString(),
    stageVelocity,
    monthlyFlow,
  });
}
