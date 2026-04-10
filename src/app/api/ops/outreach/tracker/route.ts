export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'

// Cold Outreach & Prospecting Tracker API
// Track outreach to potential new builders, manage prospect pipeline,
// measure outreach effectiveness, and identify conversion patterns

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Prospect" (
      id TEXT PRIMARY KEY,
      "companyName" TEXT NOT NULL,
      "contactName" TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      source TEXT DEFAULT 'MANUAL',
      "licenseNumber" TEXT,
      "estimatedAnnualVolume" NUMERIC(12,2),
      status TEXT NOT NULL DEFAULT 'NEW',
      "assignedTo" TEXT,
      notes TEXT,
      "convertedBuilderId" TEXT,
      "convertedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachActivity" (
      id TEXT PRIMARY KEY,
      "prospectId" TEXT NOT NULL REFERENCES "Prospect"(id),
      type TEXT NOT NULL DEFAULT 'EMAIL',
      subject TEXT,
      body TEXT,
      outcome TEXT DEFAULT 'PENDING',
      "followUpDate" DATE,
      "performedBy" TEXT,
      "performedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_outreach_prospect" ON "OutreachActivity"("prospectId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_prospect_status" ON "Prospect"(status)`);
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
      case 'prospects': return await getProspects();
      case 'pipeline': return await getPipeline();
      case 'activity-log': return await getActivityLog();
      case 'effectiveness': return await getEffectiveness();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error) {
    console.error('Outreach tracker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
      case 'add-prospect': return await addProspect(body);
      case 'log-activity': return await logActivity(body);
      case 'update-prospect': return await updateProspect(body);
      case 'convert-prospect': return await convertProspect(body);
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Outreach tracker POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  const stats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalProspects",
      COUNT(CASE WHEN status = 'NEW' THEN 1 END)::int as "newProspects",
      COUNT(CASE WHEN status = 'CONTACTED' THEN 1 END)::int as "contacted",
      COUNT(CASE WHEN status = 'INTERESTED' THEN 1 END)::int as "interested",
      COUNT(CASE WHEN status = 'MEETING_SCHEDULED' THEN 1 END)::int as "meetingScheduled",
      COUNT(CASE WHEN status = 'PROPOSAL_SENT' THEN 1 END)::int as "proposalSent",
      COUNT(CASE WHEN status = 'CONVERTED' THEN 1 END)::int as "converted",
      COUNT(CASE WHEN status = 'LOST' THEN 1 END)::int as "lost",
      COUNT(CASE WHEN status = 'NOT_INTERESTED' THEN 1 END)::int as "notInterested",
      ROUND(COALESCE(SUM("estimatedAnnualVolume"), 0)::numeric, 0) as "totalPipelineValue",
      ROUND(COALESCE(SUM(CASE WHEN status IN ('INTERESTED', 'MEETING_SCHEDULED', 'PROPOSAL_SENT')
        THEN "estimatedAnnualVolume" ELSE 0 END), 0)::numeric, 0) as "activePipelineValue",
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "newThisWeek",
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "newThisMonth"
    FROM "Prospect"
  `);

  const activityStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalActivities",
      COUNT(CASE WHEN "performedAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "thisWeek",
      COUNT(CASE WHEN "performedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "thisMonth",
      COUNT(CASE WHEN type = 'CALL' THEN 1 END)::int as "calls",
      COUNT(CASE WHEN type = 'EMAIL' THEN 1 END)::int as "emails",
      COUNT(CASE WHEN type = 'MEETING' THEN 1 END)::int as "meetings",
      COUNT(CASE WHEN type = 'SITE_VISIT' THEN 1 END)::int as "siteVisits"
    FROM "OutreachActivity"
  `);

  // Upcoming follow-ups
  const followUps: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      oa.id, oa.type, oa.subject, oa."followUpDate", oa.outcome,
      p."companyName", p."contactName", p.phone, p.email, p.status as "prospectStatus"
    FROM "OutreachActivity" oa
    JOIN "Prospect" p ON oa."prospectId" = p.id
    WHERE oa."followUpDate" >= CURRENT_DATE
      AND oa."followUpDate" <= CURRENT_DATE + INTERVAL '14 days'
      AND p.status NOT IN ('CONVERTED', 'LOST', 'NOT_INTERESTED')
    ORDER BY oa."followUpDate" ASC
    LIMIT 20
  `);

  return NextResponse.json({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    stats: stats[0] || {},
    activityStats: activityStats[0] || {},
    upcomingFollowUps: followUps,
  });
}

async function getProspects() {
  const prospects: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p."companyName", p."contactName", p.email, p.phone,
      p.city, p.state, p.source, p.status, p."licenseNumber",
      p."estimatedAnnualVolume", p."assignedTo", p.notes,
      p."createdAt", p."updatedAt",
      COUNT(oa.id)::int as "activityCount",
      MAX(oa."performedAt") as "lastActivityDate",
      EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(oa."performedAt"), p."createdAt")))::integer as "daysSinceActivity"
    FROM "Prospect" p
    LEFT JOIN "OutreachActivity" oa ON p.id = oa."prospectId"
    WHERE p.status::text NOT IN ('CONVERTED', 'LOST', 'NOT_INTERESTED')
    GROUP BY p.id
    ORDER BY
      CASE p.status
        WHEN 'PROPOSAL_SENT' THEN 1
        WHEN 'MEETING_SCHEDULED' THEN 2
        WHEN 'INTERESTED' THEN 3
        WHEN 'CONTACTED' THEN 4
        WHEN 'NEW' THEN 5
        ELSE 6
      END,
      p."createdAt" DESC
  `);

  return NextResponse.json({
    report: 'prospects',
    generatedAt: new Date().toISOString(),
    prospects,
  });
}

async function getPipeline() {
  // Pipeline stages with values
  const stages: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      status as stage,
      COUNT(*)::int as count,
      ROUND(COALESCE(SUM("estimatedAnnualVolume"), 0)::numeric, 0) as "totalValue",
      ROUND(COALESCE(AVG("estimatedAnnualVolume"), 0)::numeric, 0) as "avgValue"
    FROM "Prospect"
    GROUP BY status
    ORDER BY
      CASE status
        WHEN 'NEW' THEN 1
        WHEN 'CONTACTED' THEN 2
        WHEN 'INTERESTED' THEN 3
        WHEN 'MEETING_SCHEDULED' THEN 4
        WHEN 'PROPOSAL_SENT' THEN 5
        WHEN 'CONVERTED' THEN 6
        WHEN 'NOT_INTERESTED' THEN 7
        WHEN 'LOST' THEN 8
      END
  `);

  // Conversion funnel
  const funnel: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalProspects",
      COUNT(CASE WHEN status::text NOT IN ('NEW') THEN 1 END)::int as "contacted",
      COUNT(CASE WHEN status::text IN ('INTERESTED', 'MEETING_SCHEDULED', 'PROPOSAL_SENT', 'CONVERTED') THEN 1 END)::int as "interested",
      COUNT(CASE WHEN status::text IN ('MEETING_SCHEDULED', 'PROPOSAL_SENT', 'CONVERTED') THEN 1 END)::int as "meetingHeld",
      COUNT(CASE WHEN status::text IN ('PROPOSAL_SENT', 'CONVERTED') THEN 1 END)::int as "proposalSent",
      COUNT(CASE WHEN status::text = 'CONVERTED' THEN 1 END)::int as "converted"
    FROM "Prospect"
  `);

  // Source effectiveness
  const sources: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(source, 'UNKNOWN') as source,
      COUNT(*)::int as "totalProspects",
      COUNT(CASE WHEN status = 'CONVERTED' THEN 1 END)::int as "conversions",
      CASE WHEN COUNT(*) > 0
        THEN ROUND(COUNT(CASE WHEN status = 'CONVERTED' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 1)
        ELSE 0
      END as "conversionRate",
      ROUND(COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN "estimatedAnnualVolume" ELSE 0 END), 0)::numeric, 0) as "convertedValue"
    FROM "Prospect"
    GROUP BY source
    ORDER BY "conversions" DESC
  `);

  return NextResponse.json({
    report: 'pipeline',
    generatedAt: new Date().toISOString(),
    stages,
    funnel: funnel[0] || {},
    sources,
  });
}

async function getActivityLog() {
  const activities: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      oa.id, oa.type, oa.subject, oa.body, oa.outcome,
      oa."followUpDate", oa."performedBy", oa."performedAt",
      p.id as "prospectId", p."companyName", p."contactName", p.status as "prospectStatus"
    FROM "OutreachActivity" oa
    JOIN "Prospect" p ON oa."prospectId" = p.id
    ORDER BY oa."performedAt" DESC
    LIMIT 100
  `);

  // Activity by type (last 30 days)
  const byType: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      type,
      COUNT(*)::int as count,
      COUNT(CASE WHEN outcome = 'POSITIVE' THEN 1 END)::int as "positive",
      COUNT(CASE WHEN outcome = 'NEGATIVE' THEN 1 END)::int as "negative",
      COUNT(CASE WHEN outcome = 'NEUTRAL' THEN 1 END)::int as "neutral",
      COUNT(CASE WHEN outcome = 'NO_RESPONSE' THEN 1 END)::int as "noResponse"
    FROM "OutreachActivity"
    WHERE "performedAt" > NOW() - INTERVAL '30 days'
    GROUP BY type
    ORDER BY count DESC
  `);

  return NextResponse.json({
    report: 'activity-log',
    generatedAt: new Date().toISOString(),
    activities,
    byType,
  });
}

async function getEffectiveness() {
  // Touches to conversion analysis
  const touchesToConvert: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p."companyName", p.status,
      COUNT(oa.id) as "touchCount",
      MIN(oa."performedAt") as "firstTouch",
      MAX(oa."performedAt") as "lastTouch",
      CASE WHEN p.status = 'CONVERTED' AND p."convertedAt" IS NOT NULL
        THEN EXTRACT(DAY FROM AGE(p."convertedAt", p."createdAt"))::integer
        ELSE NULL
      END as "daysToConvert"
    FROM "Prospect" p
    LEFT JOIN "OutreachActivity" oa ON p.id = oa."prospectId"
    WHERE p.status = 'CONVERTED'
    GROUP BY p.id, p."companyName", p.status, p."convertedAt", p."createdAt"
    ORDER BY "daysToConvert" ASC NULLS LAST
  `);

  // Monthly outreach volume
  const monthlyVolume: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', "performedAt") as month,
      COUNT(*)::int as "activities",
      COUNT(CASE WHEN outcome = 'POSITIVE' THEN 1 END)::int as "positive"
    FROM "OutreachActivity"
    WHERE "performedAt" > NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', "performedAt")
    ORDER BY month DESC
  `);

  // Avg touches per outcome
  const avgTouches: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.status,
      ROUND(AVG(touch_count)::numeric, 1) as "avgTouches",
      COUNT(*)::int as "prospectCount"
    FROM (
      SELECT p.id, p.status, COUNT(oa.id) as touch_count
      FROM "Prospect" p
      LEFT JOIN "OutreachActivity" oa ON p.id = oa."prospectId"
      GROUP BY p.id, p.status
    ) p
    GROUP BY p.status
    ORDER BY "avgTouches" DESC
  `);

  return NextResponse.json({
    report: 'effectiveness',
    generatedAt: new Date().toISOString(),
    touchesToConvert,
    monthlyVolume,
    avgTouches,
    avgDaysToConvert: touchesToConvert.length > 0
      ? Math.round(touchesToConvert.reduce((s: number, t: any) => s + (Number(t.daysToConvert) || 0), 0) / touchesToConvert.filter((t: any) => t.daysToConvert).length || 1)
      : 0,
  });
}

async function addProspect(body: any) {
  const { companyName, contactName, email, phone, address, city, state, source, licenseNumber, estimatedAnnualVolume, assignedTo, notes } = body;
  const id = 'prosp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "Prospect" (id, "companyName", "contactName", email, phone, address, city, state, source, "licenseNumber", "estimatedAnnualVolume", "assignedTo", notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, id, companyName, contactName || null, email || null, phone || null, address || null, city || null, state || null, source || 'MANUAL', licenseNumber || null, estimatedAnnualVolume || null, assignedTo || null, notes || null);

  return NextResponse.json({ success: true, prospectId: id });
}

async function logActivity(body: any) {
  const { prospectId, type, subject, activityBody, outcome, followUpDate, performedBy } = body;
  if (!prospectId) return NextResponse.json({ error: 'prospectId required' }, { status: 400 });

  const id = 'oact_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "OutreachActivity" (id, "prospectId", type, subject, body, outcome, "followUpDate", "performedBy")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, id, prospectId, type || 'EMAIL', subject || null, activityBody || null, outcome || 'PENDING', followUpDate || null, performedBy || null);

  // Auto-update prospect status if it's still NEW
  if (type) {
    await prisma.$executeRawUnsafe(`
      UPDATE "Prospect" SET status = 'CONTACTED', "updatedAt" = NOW()
      WHERE id = $1 AND status = 'NEW'
    `, prospectId);
  }

  return NextResponse.json({ success: true, activityId: id });
}

async function updateProspect(body: any) {
  const { prospectId, status, notes, estimatedAnnualVolume, assignedTo } = body;
  if (!prospectId) return NextResponse.json({ error: 'prospectId required' }, { status: 400 });

  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (status) { updates.push(`status = $${idx++}`); values.push(status); }
  if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes); }
  if (estimatedAnnualVolume !== undefined) { updates.push(`"estimatedAnnualVolume" = $${idx++}`); values.push(estimatedAnnualVolume); }
  if (assignedTo !== undefined) { updates.push(`"assignedTo" = $${idx++}`); values.push(assignedTo); }
  updates.push(`"updatedAt" = NOW()`);

  values.push(prospectId);
  await prisma.$executeRawUnsafe(
    `UPDATE "Prospect" SET ${updates.join(', ')} WHERE id = $${idx}`,
    ...values
  );

  return NextResponse.json({ success: true });
}

async function convertProspect(body: any) {
  const { prospectId, builderId } = body;
  if (!prospectId) return NextResponse.json({ error: 'prospectId required' }, { status: 400 });

  await prisma.$executeRawUnsafe(`
    UPDATE "Prospect" SET
      status = 'CONVERTED',
      "convertedBuilderId" = $2,
      "convertedAt" = NOW(),
      "updatedAt" = NOW()
    WHERE id = $1
  `, prospectId, builderId || null);

  return NextResponse.json({ success: true });
}
