export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Marketing Automation & Campaign Management API
// Campaign tracking, builder segmentation, drip sequences, engagement analytics
// Self-creating tables for campaign data (not in Prisma schema yet)

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MarketingCampaign" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'EMAIL',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      subject TEXT,
      body TEXT,
      "targetSegment" TEXT,
      "targetQuery" TEXT,
      "recipientCount" INTEGER DEFAULT 0,
      "sentCount" INTEGER DEFAULT 0,
      "openCount" INTEGER DEFAULT 0,
      "clickCount" INTEGER DEFAULT 0,
      "convertCount" INTEGER DEFAULT 0,
      "scheduledAt" TIMESTAMP WITH TIME ZONE,
      "sentAt" TIMESTAMP WITH TIME ZONE,
      "createdBy" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CampaignRecipient" (
      id TEXT PRIMARY KEY,
      "campaignId" TEXT NOT NULL REFERENCES "MarketingCampaign"(id),
      "builderId" TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      "sentAt" TIMESTAMP WITH TIME ZONE,
      "openedAt" TIMESTAMP WITH TIME ZONE,
      "clickedAt" TIMESTAMP WITH TIME ZONE,
      "convertedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_campaign_recipient_campaign" ON "CampaignRecipient"("campaignId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_campaign_recipient_builder" ON "CampaignRecipient"("builderId")
  `);
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
      case 'campaigns': return await getCampaigns();
      case 'segments': return await getBuilderSegments();
      case 'templates': return await getCampaignTemplates();
      case 'performance': return await getCampaignPerformance();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Marketing campaigns error:', error);
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
      case 'create-campaign': return await createCampaign(body);
      case 'update-campaign': return await updateCampaign(body);
      case 'populate-recipients': return await populateRecipients(body);
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Marketing campaign POST error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Campaign summary
  const campaignStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalCampaigns",
      COUNT(CASE WHEN status::text = 'DRAFT' THEN 1 END)::int as "draftCampaigns",
      COUNT(CASE WHEN status::text = 'SCHEDULED' THEN 1 END)::int as "scheduledCampaigns",
      COUNT(CASE WHEN status::text = 'SENT' THEN 1 END)::int as "sentCampaigns",
      COUNT(CASE WHEN status::text = 'ACTIVE' THEN 1 END)::int as "activeCampaigns",
      COALESCE(SUM("sentCount"), 0)::int as "totalSent",
      COALESCE(SUM("openCount"), 0)::int as "totalOpens",
      COALESCE(SUM("clickCount"), 0)::int as "totalClicks",
      COALESCE(SUM("convertCount"), 0)::int as "totalConversions",
      CASE WHEN SUM("sentCount") > 0
        THEN ROUND(SUM("openCount")::numeric / SUM("sentCount")::numeric * 100, 1)
        ELSE 0
      END as "avgOpenRate",
      CASE WHEN SUM("openCount") > 0
        THEN ROUND(SUM("clickCount")::numeric / SUM("openCount")::numeric * 100, 1)
        ELSE 0
      END as "avgClickRate"
    FROM "MarketingCampaign"
  `);

  // Builder reachability
  const reachability: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalBuilders",
      COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END)::int as "withEmail",
      COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END)::int as "withPhone",
      COUNT(CASE WHEN status = 'ACTIVE' AND email IS NOT NULL THEN 1 END)::int as "activeReachable"
    FROM "Builder"
  `);

  // Recent campaigns
  const recent: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, name, type, status, subject, "targetSegment",
      "recipientCount", "sentCount", "openCount", "clickCount", "convertCount",
      "scheduledAt", "sentAt", "createdAt"
    FROM "MarketingCampaign"
    ORDER BY "createdAt" DESC
    LIMIT 10
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    stats: campaignStats[0] || {},
    reachability: reachability[0] || {},
    recentCampaigns: recent,
  });
}

async function getCampaigns() {
  const campaigns: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      mc.id, mc.name, mc.type, mc.status, mc.subject, mc."targetSegment",
      mc."recipientCount", mc."sentCount", mc."openCount", mc."clickCount", mc."convertCount",
      mc."scheduledAt", mc."sentAt", mc."createdAt",
      CASE WHEN mc."sentCount" > 0
        THEN ROUND(mc."openCount"::numeric / mc."sentCount"::numeric * 100, 1) ELSE 0
      END as "openRate",
      CASE WHEN mc."openCount" > 0
        THEN ROUND(mc."clickCount"::numeric / mc."openCount"::numeric * 100, 1) ELSE 0
      END as "clickRate",
      CASE WHEN mc."sentCount" > 0
        THEN ROUND(mc."convertCount"::numeric / mc."sentCount"::numeric * 100, 1) ELSE 0
      END as "conversionRate"
    FROM "MarketingCampaign" mc
    ORDER BY mc."createdAt" DESC
  `);

  return safeJson({
    report: 'campaigns',
    generatedAt: new Date().toISOString(),
    campaigns,
  });
}

async function getBuilderSegments() {
  // Pre-built marketing segments
  const segments: any[] = [];

  // High-value active
  const highValue: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", b.email, b."contactName"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    WHERE b.status::text = 'ACTIVE' AND o.status::text != 'CANCELLED'
    GROUP BY b.id, b."companyName", b.email, b."contactName"
    HAVING SUM(o.total) >= 50000
  `);
  segments.push({ name: 'High-Value Accounts', description: '$50K+ lifetime spend', count: highValue.length, key: 'high-value', builders: highValue });

  // New builders (last 90 days)
  const newBuilders: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, "companyName", email, "contactName"
    FROM "Builder"
    WHERE "createdAt" > NOW() - INTERVAL '90 days' AND status::text = 'ACTIVE'
  `);
  segments.push({ name: 'New Builders (90d)', description: 'Signed up in last 90 days', count: newBuilders.length, key: 'new-90d', builders: newBuilders });

  // At risk (no order in 90+ days but had previous orders)
  const atRisk: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", b.email, b."contactName"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    WHERE b.status::text = 'ACTIVE' AND o.status::text != 'CANCELLED'
    GROUP BY b.id, b."companyName", b.email, b."contactName"
    HAVING MAX(o."createdAt") < NOW() - INTERVAL '90 days'
  `);
  segments.push({ name: 'At-Risk (90d Inactive)', description: 'Had orders but inactive 90+ days', count: atRisk.length, key: 'at-risk', builders: atRisk });

  // Never ordered
  const neverOrdered: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", b.email, b."contactName"
    FROM "Builder" b
    LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status::text != 'CANCELLED'
    WHERE b.status::text = 'ACTIVE' AND o.id IS NULL
  `);
  segments.push({ name: 'Never Ordered', description: 'Active but zero orders placed', count: neverOrdered.length, key: 'never-ordered', builders: neverOrdered });

  // Quote pending (have quotes but haven't converted)
  const quotePending: any[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT b.id, b."companyName", b.email, b."contactName"
    FROM "Builder" b
    JOIN "Project" p ON b.id = p."builderId"
    JOIN "Quote" q ON q."projectId" = p.id
    WHERE q.status::text IN ('SENT', 'DRAFT') AND b.status::text = 'ACTIVE'
    AND b.id NOT IN (
      SELECT DISTINCT "builderId" FROM "Order" WHERE status::text != 'CANCELLED'
      AND "createdAt" > NOW() - INTERVAL '60 days'
    )
  `);
  segments.push({ name: 'Quote Pending', description: 'Has open quotes, no recent orders', count: quotePending.length, key: 'quote-pending', builders: quotePending });

  return safeJson({
    report: 'segments',
    generatedAt: new Date().toISOString(),
    segments: segments.map(s => ({ ...s, builders: s.builders.slice(0, 20) })),
    totalReachable: highValue.length + newBuilders.length + atRisk.length + neverOrdered.length,
  });
}

async function getCampaignTemplates() {
  // Pre-built campaign templates for common scenarios
  const templates = [
    {
      id: 'welcome-series',
      name: 'Welcome Series',
      type: 'DRIP',
      description: 'Onboard new builders with a 3-email welcome sequence',
      targetSegment: 'new-90d',
      emails: [
        { day: 0, subject: 'Welcome to Abel Lumber — Your Account is Ready', preview: 'Introduction to ordering, catalog, and account features' },
        { day: 3, subject: 'Getting Started: Your First Quote in 5 Minutes', preview: 'How to request quotes and navigate the platform' },
        { day: 7, subject: 'Abel Lumber Pro Tips: Save Time on Every Order', preview: 'Bulk ordering, saved lists, delivery scheduling' },
      ],
    },
    {
      id: 'reactivation',
      name: 'Re-Activation Campaign',
      type: 'EMAIL',
      description: 'Win back inactive builders with a special offer',
      targetSegment: 'at-risk',
      emails: [
        { day: 0, subject: 'We Miss You — Here\'s What\'s New at Abel Lumber', preview: 'Product updates, new inventory, and seasonal deals' },
      ],
    },
    {
      id: 'quote-followup',
      name: 'Quote Follow-Up',
      type: 'DRIP',
      description: 'Nudge builders who have outstanding quotes',
      targetSegment: 'quote-pending',
      emails: [
        { day: 0, subject: 'Your Quote is Ready — Questions?', preview: 'Reminder about pending quote with team contact info' },
        { day: 5, subject: 'Last Chance: Quote Expiring Soon', preview: 'Urgency-driven reminder before quote expires' },
      ],
    },
    {
      id: 'cross-sell',
      name: 'Cross-Sell Campaign',
      type: 'EMAIL',
      description: 'Promote product categories builders haven\'t tried yet',
      targetSegment: 'high-value',
      emails: [
        { day: 0, subject: 'Expand Your Order: New Products You\'ll Love', preview: 'Category recommendations based on purchase history' },
      ],
    },
    {
      id: 'first-order-nudge',
      name: 'First Order Nudge',
      type: 'DRIP',
      description: 'Encourage first purchase from signed-up builders',
      targetSegment: 'never-ordered',
      emails: [
        { day: 0, subject: 'Ready to Place Your First Order?', preview: 'Getting started guide and catalog highlights' },
        { day: 7, subject: 'Abel Lumber: Quality Doors & Millwork at Builder Prices', preview: 'Product showcase with competitive pricing message' },
      ],
    },
  ];

  return safeJson({
    report: 'templates',
    generatedAt: new Date().toISOString(),
    templates,
  });
}

async function getCampaignPerformance() {
  // Performance metrics for sent campaigns
  const performance: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      mc.id, mc.name, mc.type, mc.status,
      mc."targetSegment", mc."sentAt",
      mc."recipientCount", mc."sentCount", mc."openCount", mc."clickCount", mc."convertCount",
      CASE WHEN mc."sentCount" > 0
        THEN ROUND(mc."openCount"::numeric / mc."sentCount"::numeric * 100, 1) ELSE 0
      END as "openRate",
      CASE WHEN mc."openCount" > 0
        THEN ROUND(mc."clickCount"::numeric / mc."openCount"::numeric * 100, 1) ELSE 0
      END as "clickRate",
      CASE WHEN mc."sentCount" > 0
        THEN ROUND(mc."convertCount"::numeric / mc."sentCount"::numeric * 100, 1) ELSE 0
      END as "conversionRate"
    FROM "MarketingCampaign" mc
    WHERE mc.status::text IN ('SENT', 'ACTIVE')
    ORDER BY mc."sentAt" DESC NULLS LAST
  `);

  // Aggregate performance by type
  const byType: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      type,
      COUNT(*)::int as "campaignCount",
      SUM("sentCount")::int as "totalSent",
      SUM("openCount")::int as "totalOpens",
      SUM("clickCount")::int as "totalClicks",
      SUM("convertCount")::int as "totalConversions",
      CASE WHEN SUM("sentCount") > 0
        THEN ROUND(SUM("openCount")::numeric / SUM("sentCount")::numeric * 100, 1) ELSE 0
      END as "avgOpenRate",
      CASE WHEN SUM("openCount") > 0
        THEN ROUND(SUM("clickCount")::numeric / SUM("openCount")::numeric * 100, 1) ELSE 0
      END as "avgClickRate"
    FROM "MarketingCampaign"
    WHERE status::text IN ('SENT', 'ACTIVE')
    GROUP BY type
  `);

  return safeJson({
    report: 'performance',
    generatedAt: new Date().toISOString(),
    campaigns: performance,
    byType,
  });
}

async function createCampaign(body: any) {
  const { name, type, subject, targetSegment, body: emailBody, scheduledAt } = body;
  const id = 'camp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "MarketingCampaign" (id, name, type, subject, body, "targetSegment", status, "scheduledAt")
    VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7)
  `, id, name || 'Untitled Campaign', type || 'EMAIL', subject || '', emailBody || '', targetSegment || '', scheduledAt || null);

  return safeJson({ success: true, campaignId: id });
}

async function updateCampaign(body: any) {
  const { campaignId, name, subject, status, body: emailBody } = body;
  if (!campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 });

  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (name) { updates.push(`name = $${idx++}`); values.push(name); }
  if (subject) { updates.push(`subject = $${idx++}`); values.push(subject); }
  if (status) { updates.push(`status = $${idx++}`); values.push(status); }
  if (emailBody) { updates.push(`body = $${idx++}`); values.push(emailBody); }
  updates.push(`"updatedAt" = NOW()`);

  if (updates.length > 1) {
    values.push(campaignId);
    await prisma.$executeRawUnsafe(
      `UPDATE "MarketingCampaign" SET ${updates.join(', ')} WHERE id = $${idx}`,
      ...values
    );
  }

  return safeJson({ success: true });
}

async function populateRecipients(body: any) {
  const { campaignId, segment } = body;
  if (!campaignId || !segment) return NextResponse.json({ error: 'campaignId and segment required' }, { status: 400 });

  let query = '';
  switch (segment) {
    case 'high-value':
      query = `SELECT b.id FROM "Builder" b JOIN "Order" o ON b.id = o."builderId" WHERE b.status::text = 'ACTIVE' AND o.status::text != 'CANCELLED' GROUP BY b.id HAVING SUM(o.total) >= 50000`;
      break;
    case 'new-90d':
      query = `SELECT id FROM "Builder" WHERE "createdAt" > NOW() - INTERVAL '90 days' AND status::text = 'ACTIVE'`;
      break;
    case 'at-risk':
      query = `SELECT b.id FROM "Builder" b JOIN "Order" o ON b.id = o."builderId" WHERE b.status::text = 'ACTIVE' AND o.status::text != 'CANCELLED' GROUP BY b.id HAVING MAX(o."createdAt") < NOW() - INTERVAL '90 days'`;
      break;
    case 'never-ordered':
      query = `SELECT b.id FROM "Builder" b LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status::text != 'CANCELLED' WHERE b.status::text = 'ACTIVE' AND o.id IS NULL`;
      break;
    case 'quote-pending':
      query = `SELECT DISTINCT b.id FROM "Builder" b JOIN "Project" p ON b.id = p."builderId" JOIN "Quote" q ON q."projectId" = p.id WHERE q.status::text IN ('SENT', 'DRAFT') AND b.status::text = 'ACTIVE'`;
      break;
    default:
      query = `SELECT id FROM "Builder" WHERE status::text = 'ACTIVE' AND email IS NOT NULL`;
  }

  const builders: any[] = await prisma.$queryRawUnsafe(query);

  // Insert recipients
  for (const b of builders) {
    const recipId = 'cr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CampaignRecipient" (id, "campaignId", "builderId", status) VALUES ($1, $2, $3, 'QUEUED') ON CONFLICT DO NOTHING`,
      recipId, campaignId, b.id
    );
  }

  // Update recipient count
  await prisma.$executeRawUnsafe(
    `UPDATE "MarketingCampaign" SET "recipientCount" = (SELECT COUNT(*) FROM "CampaignRecipient" WHERE "campaignId" = $1) WHERE id = $1`,
    campaignId
  );

  return safeJson({ success: true, recipientCount: builders.length });
}
