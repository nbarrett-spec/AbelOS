export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';

// Builder Lifetime Value Intelligence
// Analyzes all builders and returns comprehensive value profiles

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BuilderValueProfile" (
      id TEXT PRIMARY KEY,
      "builderId" TEXT NOT NULL UNIQUE,
      "lifetimeRevenue" NUMERIC(15, 2),
      "lifetimeOrders" INT,
      "avgOrderValue" NUMERIC(15, 2),
      "quoteToOrderRate" NUMERIC(5, 4),
      "daysSinceLastOrder" INT,
      "lastOrderDate" TIMESTAMP WITH TIME ZONE,
      "lifetimeValueScore" INT,
      "churnRisk" TEXT,
      "growthTrend" TEXT,
      "segmentTag" TEXT,
      "predictedAnnualRevenue" NUMERIC(15, 2),
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_builder_value_profile_builderId" ON "BuilderValueProfile"("builderId")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RetentionAction" (
      id TEXT PRIMARY KEY,
      "builderId" TEXT NOT NULL,
      "triggerType" TEXT NOT NULL,
      urgency TEXT DEFAULT 'MEDIUM',
      description TEXT,
      "isActive" BOOLEAN DEFAULT TRUE,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_retention_action_builderId" ON "RetentionAction"("builderId")
  `);
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    await ensureTables();

    // Get all active builders with comprehensive value data
    const builders: any[] = await prisma.$queryRawUnsafe(`
      WITH builder_metrics AS (
        SELECT
          b.id,
          b."companyName",
          b.email,
          COUNT(o.id)::int as "orderCount",
          COALESCE(SUM(o.total), 0)::numeric as "lifetimeRevenue",
          COALESCE(AVG(o.total), 0)::numeric as "avgOrderValue",
          MAX(o."createdAt") as "lastOrderDate",
          EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(o."createdAt"), b."createdAt")))::int as "daysSinceLastOrder",
          COUNT(q.id)::int as "quoteCount"
        FROM "Builder" b
        LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'::"OrderStatus"
        LEFT JOIN "Quote" q ON b.id = (SELECT o2."builderId" FROM "Order" o2 WHERE o2."quoteId" = q.id LIMIT 1)
        WHERE b.status = 'ACTIVE'::"AccountStatus"
        GROUP BY b.id, b."companyName", b.email
      ),
      recent_periods AS (
        SELECT
          bm.id,
          COALESCE(SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '6 months' THEN o.total ELSE 0 END), 0)::numeric as "recentRevenue",
          COALESCE(SUM(CASE WHEN o."createdAt" BETWEEN NOW() - INTERVAL '12 months' AND NOW() - INTERVAL '6 months' THEN o.total ELSE 0 END), 0)::numeric as "priorRevenue"
        FROM builder_metrics bm
        LEFT JOIN "Order" o ON bm.id = o."builderId" AND o.status != 'CANCELLED'::"OrderStatus"
        GROUP BY bm.id
      )
      SELECT
        bm.id,
        bm."companyName",
        bm.email,
        bm."lifetimeRevenue",
        bm."orderCount",
        bm."avgOrderValue",
        CASE WHEN bm."quoteCount" > 0 THEN (bm."orderCount"::numeric / bm."quoteCount") ELSE 0 END::numeric(5,4) as "quoteToOrderRate",
        bm."daysSinceLastOrder",
        bm."lastOrderDate",
        -- Lifetime Value Score (0-100)
        CASE
          WHEN bm."orderCount" = 0 THEN 0
          ELSE LEAST(100, GREATEST(0,
            -- Revenue (40%)
            CASE
              WHEN bm."lifetimeRevenue" >= 500000 THEN 40
              WHEN bm."lifetimeRevenue" >= 250000 THEN 35
              WHEN bm."lifetimeRevenue" >= 100000 THEN 30
              WHEN bm."lifetimeRevenue" >= 50000 THEN 20
              ELSE 10
            END +
            -- Frequency (20%)
            LEAST(20, (bm."orderCount" * 2)::int) +
            -- Order Value (20%)
            CASE
              WHEN bm."avgOrderValue" >= 50000 THEN 20
              WHEN bm."avgOrderValue" >= 25000 THEN 15
              WHEN bm."avgOrderValue" >= 10000 THEN 10
              ELSE 5
            END +
            -- Conversion Rate (10%)
            CASE
              WHEN bm."quoteCount" = 0 THEN 0
              WHEN (bm."orderCount"::numeric / bm."quoteCount") >= 0.7 THEN 10
              WHEN (bm."orderCount"::numeric / bm."quoteCount") >= 0.5 THEN 8
              WHEN (bm."orderCount"::numeric / bm."quoteCount") >= 0.3 THEN 5
              ELSE 2
            END +
            -- Recency (10%)
            CASE
              WHEN bm."daysSinceLastOrder" <= 30 THEN 10
              WHEN bm."daysSinceLastOrder" <= 60 THEN 7
              WHEN bm."daysSinceLastOrder" <= 120 THEN 4
              ELSE 0
            END
          ))
        END as "lifetimeValueScore",
        -- Churn Risk
        CASE
          WHEN bm."daysSinceLastOrder" > 90 THEN 'HIGH'
          WHEN bm."daysSinceLastOrder" > 45 THEN 'MEDIUM'
          ELSE 'LOW'
        END as "churnRisk",
        -- Growth Trend
        CASE
          WHEN rp."recentRevenue" > rp."priorRevenue" AND rp."priorRevenue" > 0 THEN 'GROWING'
          WHEN rp."recentRevenue" < rp."priorRevenue" * 0.8 AND rp."priorRevenue" > 0 THEN 'DECLINING'
          ELSE 'STABLE'
        END as "growthTrend",
        -- Predicted Annual Revenue
        CASE
          WHEN bm."orderCount" > 0 AND bm."lastOrderDate" > NOW() - INTERVAL '90 days'
          THEN (rp."recentRevenue" / 0.5)::numeric
          ELSE bm."lifetimeRevenue" / (EXTRACT(DAY FROM AGE(NOW(), b."createdAt")) / 365.25 + 0.1)
        END as "predictedAnnualRevenue"
      FROM builder_metrics bm
      JOIN recent_periods rp ON bm.id = rp.id
      JOIN "Builder" b ON bm.id = b.id
      ORDER BY bm."lifetimeRevenue" DESC
    `);

    // Calculate segments (top 10%, 25%, 50%)
    const totalRevenue = builders.reduce((sum, b) => sum + Number(b.lifetimeRevenue || 0), 0);
    let cumulativeRevenue = 0;
    const buildersWithSegment = builders.map((b) => {
      cumulativeRevenue += Number(b.lifetimeRevenue || 0);
      const percentOfTotal = totalRevenue > 0 ? cumulativeRevenue / totalRevenue : 0;
      let segment = 'STANDARD';
      if (percentOfTotal <= 0.1) segment = 'PLATINUM';
      else if (percentOfTotal <= 0.25) segment = 'GOLD';
      else if (percentOfTotal <= 0.5) segment = 'SILVER';
      return { ...b, segmentTag: segment };
    });

    // Segment summary
    const segments = {
      PLATINUM: {
        count: buildersWithSegment.filter((b) => b.segmentTag === 'PLATINUM').length,
        totalRevenue: buildersWithSegment
          .filter((b) => b.segmentTag === 'PLATINUM')
          .reduce((sum, b) => sum + Number(b.lifetimeRevenue || 0), 0),
        avgLTV: 0 as number,
      },
      GOLD: {
        count: buildersWithSegment.filter((b) => b.segmentTag === 'GOLD').length,
        totalRevenue: buildersWithSegment
          .filter((b) => b.segmentTag === 'GOLD')
          .reduce((sum, b) => sum + Number(b.lifetimeRevenue || 0), 0),
        avgLTV: 0 as number,
      },
      SILVER: {
        count: buildersWithSegment.filter((b) => b.segmentTag === 'SILVER').length,
        totalRevenue: buildersWithSegment
          .filter((b) => b.segmentTag === 'SILVER')
          .reduce((sum, b) => sum + Number(b.lifetimeRevenue || 0), 0),
        avgLTV: 0 as number,
      },
      STANDARD: {
        count: buildersWithSegment.filter((b) => b.segmentTag === 'STANDARD').length,
        totalRevenue: buildersWithSegment
          .filter((b) => b.segmentTag === 'STANDARD')
          .reduce((sum, b) => sum + Number(b.lifetimeRevenue || 0), 0),
        avgLTV: 0 as number,
      },
    };

    // Calculate average LTV per segment
    for (const segment of Object.keys(segments)) {
      const segmentBuilders = buildersWithSegment.filter((b) => b.segmentTag === segment);
      if (segmentBuilders.length > 0) {
        segments[segment as keyof typeof segments].avgLTV = Math.round(
          segments[segment as keyof typeof segments].totalRevenue / segmentBuilders.length
        );
      }
    }

    // Retention analysis
    const atRiskBuilders = buildersWithSegment.filter((b) => b.churnRisk === 'HIGH');
    const revenueAtRisk = atRiskBuilders.reduce((sum, b) => sum + Number(b.lifetimeRevenue || 0), 0);

    // Calculate summary
    const summary = {
      totalActiveBuilders: buildersWithSegment.length,
      totalRevenue: totalRevenue,
      avgLTV: buildersWithSegment.length > 0 ? Math.round(totalRevenue / buildersWithSegment.length) : 0,
      topBuilderRevenue: buildersWithSegment.length > 0 ? Number(buildersWithSegment[0].lifetimeRevenue) : 0,
      avgChurnRisk: atRiskBuilders.length > 0 ? Number((atRiskBuilders.length / buildersWithSegment.length).toFixed(2)) : 0,
    };

    return safeJson({
      builders: buildersWithSegment,
      segments,
      retention: {
        atRiskBuilders: atRiskBuilders.length,
        revenueAtRisk: revenueAtRisk,
        recentChurned: 0, // Would need historical data
        churnedRevenue: 0,
      },
      summary,
    });
  } catch (error: any) {
    console.error('Builder value intelligence error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    await ensureTables();
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = { action: 'recalculate' };
    }
    const { action } = body;

    if (action !== 'recalculate') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    let analyzedCount = 0;
    let actionsCreated = 0;

    // Get all active builders
    const builders: any[] = await prisma.$queryRawUnsafe(`
      SELECT b.id, b."companyName"
      FROM "Builder" b
      WHERE b.status = 'ACTIVE'::"AccountStatus"
    `);

    // Analyze each builder and store profile
    for (const builder of builders) {
      const metrics: any[] = await prisma.$queryRawUnsafe(
        `
        WITH metrics AS (
          SELECT
            COUNT(o.id)::int as "orderCount",
            COALESCE(SUM(o.total), 0)::numeric as "lifetimeRevenue",
            COALESCE(AVG(o.total), 0)::numeric as "avgOrderValue",
            MAX(o."createdAt") as "lastOrderDate",
            EXTRACT(DAY FROM AGE(NOW(), COALESCE(MAX(o."createdAt"), (SELECT "createdAt" FROM "Builder" WHERE id = $1))))::int as "daysSinceLastOrder",
            COUNT(q.id)::int as "quoteCount"
          FROM "Order" o
          LEFT JOIN "Quote" q ON EXISTS (SELECT 1 FROM "Order" o2 WHERE o2."quoteId" = q.id AND o2.id = o.id)
          WHERE o."builderId" = $1 AND o.status != 'CANCELLED'::"OrderStatus"
        ),
        recent_periods AS (
          SELECT
            COALESCE(SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '6 months' THEN o.total ELSE 0 END), 0)::numeric as "recentRevenue",
            COALESCE(SUM(CASE WHEN o."createdAt" BETWEEN NOW() - INTERVAL '12 months' AND NOW() - INTERVAL '6 months' THEN o.total ELSE 0 END), 0)::numeric as "priorRevenue"
          FROM "Order" o
          WHERE o."builderId" = $1 AND o.status != 'CANCELLED'::"OrderStatus"
        )
        SELECT
          m."orderCount",
          m."lifetimeRevenue",
          m."avgOrderValue",
          m."lastOrderDate",
          m."daysSinceLastOrder",
          CASE WHEN m."quoteCount" > 0 THEN (m."orderCount"::numeric / m."quoteCount") ELSE 0 END::numeric(5,4) as "quoteToOrderRate",
          rp."recentRevenue",
          rp."priorRevenue"
        FROM metrics m
        CROSS JOIN recent_periods rp
        `,
        builder.id
      );

      if (metrics.length === 0) continue;

      const metric = metrics[0];
      const quoteToOrderRate = Number(metric.quoteToOrderRate || 0);
      const daysSinceLastOrder = metric.daysSinceLastOrder || 999;
      const recentRevenue = Number(metric.recentRevenue || 0);
      const priorRevenue = Number(metric.priorRevenue || 0);

      // Calculate lifetime value score
      const orderCount = metric.orderCount || 0;
      let score = 0;
      if (orderCount > 0) {
        const lifetimeRevenue = Number(metric.lifetimeRevenue || 0);
        const avgOrderValue = Number(metric.avgOrderValue || 0);

        score = Math.min(100, Math.max(0,
          (lifetimeRevenue >= 500000 ? 40 : lifetimeRevenue >= 250000 ? 35 : lifetimeRevenue >= 100000 ? 30 : lifetimeRevenue >= 50000 ? 20 : 10) +
          Math.min(20, orderCount * 2) +
          (avgOrderValue >= 50000 ? 20 : avgOrderValue >= 25000 ? 15 : avgOrderValue >= 10000 ? 10 : 5) +
          (quoteToOrderRate >= 0.7 ? 10 : quoteToOrderRate >= 0.5 ? 8 : quoteToOrderRate >= 0.3 ? 5 : 2) +
          (daysSinceLastOrder <= 30 ? 10 : daysSinceLastOrder <= 60 ? 7 : daysSinceLastOrder <= 120 ? 4 : 0)
        ));
      }

      // Determine churn risk
      const churnRisk = daysSinceLastOrder > 90 ? 'HIGH' : daysSinceLastOrder > 45 ? 'MEDIUM' : 'LOW';

      // Determine growth trend
      const growthTrend = recentRevenue > priorRevenue ? 'GROWING' : recentRevenue < priorRevenue * 0.8 && priorRevenue > 0 ? 'DECLINING' : 'STABLE';

      // Predict annual revenue
      const predictedAnnual = orderCount > 0 && daysSinceLastOrder <= 90 ? Math.round(recentRevenue / 0.5) : 0;

      // Insert or update profile
      const profileId = 'bvp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "BuilderValueProfile" (
          id, "builderId", "lifetimeRevenue", "lifetimeOrders", "avgOrderValue",
          "quoteToOrderRate", "daysSinceLastOrder", "lastOrderDate", "lifetimeValueScore",
          "churnRisk", "growthTrend", "predictedAnnualRevenue"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT ("builderId") DO UPDATE SET
          "lifetimeRevenue" = $3,
          "lifetimeOrders" = $4,
          "avgOrderValue" = $5,
          "quoteToOrderRate" = $6,
          "daysSinceLastOrder" = $7,
          "lastOrderDate" = $8,
          "lifetimeValueScore" = $9,
          "churnRisk" = $10,
          "growthTrend" = $11,
          "predictedAnnualRevenue" = $12,
          "updatedAt" = NOW()
        `,
        profileId,
        builder.id,
        metric.lifetimeRevenue,
        metric.orderCount,
        metric.avgOrderValue,
        quoteToOrderRate,
        daysSinceLastOrder,
        metric.lastOrderDate,
        score,
        churnRisk,
        growthTrend,
        predictedAnnual
      );

      analyzedCount++;

      // Create retention actions for at-risk builders
      if (daysSinceLastOrder > 60 && (metric.orderCount || 0) >= 3) {
        const actionId = 'ra_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const urgency = Number(metric.lifetimeRevenue || 0) > 100000 ? 'HIGH' : 'MEDIUM';

        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "RetentionAction" (id, "builderId", "triggerType", urgency, description)
          SELECT $1, $2, 'INACTIVITY', $3, $4
          WHERE NOT EXISTS (
            SELECT 1 FROM "RetentionAction"
            WHERE "builderId" = $2 AND "triggerType" = 'INACTIVITY' AND "isActive" = TRUE
          )
          `,
          actionId,
          builder.id,
          urgency,
          `No orders for ${daysSinceLastOrder} days (was a regular customer)`
        );
        actionsCreated++;
      }

      if (growthTrend === 'DECLINING' && priorRevenue > 0) {
        const actionId = 'ra_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "RetentionAction" (id, "builderId", "triggerType", urgency, description)
          SELECT $1, $2, 'DECLINING_SPEND', 'MEDIUM', $3
          WHERE NOT EXISTS (
            SELECT 1 FROM "RetentionAction"
            WHERE "builderId" = $2 AND "triggerType" = 'DECLINING_SPEND' AND "isActive" = TRUE
          )
          `,
          actionId,
          builder.id,
          `Spending declined from $${Math.round(priorRevenue)} to $${Math.round(recentRevenue)} (last 6 months)`
        );
        actionsCreated++;
      }
    }

    return safeJson({
      success: true,
      buildersAnalyzed: analyzedCount,
      retentionActionsCreated: actionsCreated,
    });
  } catch (error: any) {
    console.error('Builder value recalculation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
