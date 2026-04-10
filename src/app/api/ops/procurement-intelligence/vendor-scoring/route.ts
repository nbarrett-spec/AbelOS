export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';

// Vendor Intelligence Dashboard & Scorecard Recalculation
// Comprehensive vendor performance analytics, scoring algorithms, and risk assessment

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendorId');
    const includePerformance = searchParams.get('includePerformance') !== 'false';

    // Get all active vendors
    const vendorsResult: any[] = vendorId
      ? await prisma.$queryRawUnsafe(`
          SELECT v."id", v."name", v."code", v."avgLeadDays", v."onTimeRate", v."riskScore"
          FROM "Vendor" v WHERE v."active" = true AND v."id" = $1 ORDER BY v."name"
        `, vendorId)
      : await prisma.$queryRawUnsafe(`
          SELECT v."id", v."name", v."code", v."avgLeadDays", v."onTimeRate", v."riskScore"
          FROM "Vendor" v WHERE v."active" = true ORDER BY v."name"
        `);

    // Build vendor data with scorecard information
    const vendorData: any[] = [];

    for (const vendor of vendorsResult) {
      // Get scorecard
      const scorecardResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          "overallScore",
          "deliveryScore",
          "qualityScore",
          "costScore",
          "communicationScore",
          "avgLeadTimeDays",
          "leadTimeStdDev",
          "onTimeRate",
          "earlyRate",
          "lateRate",
          "avgFillRate",
          "avgDamageRate",
          "totalPOs",
          "totalSpend",
          "avgPOValue",
          "costTrend",
          "riskLevel"
        FROM "VendorScorecard"
        WHERE "vendorId" = $1
      `, vendor.id);

      const scorecard = scorecardResult[0] || {
        overallScore: 0,
        deliveryScore: 0,
        qualityScore: 0,
        costScore: 0,
        avgLeadTimeDays: vendor.avgLeadDays || 0,
        onTimeRate: vendor.onTimeRate || 0,
        totalPOs: 0,
        totalSpend: 0,
        riskLevel: 'UNKNOWN',
        costTrend: 'UNKNOWN',
      };

      // Get recent performance logs (last 30 days)
      const recentPerformanceResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          "id",
          "orderedAt",
          "actualDeliveryAt",
          "leadTimeDays",
          "daysLateOrEarly",
          "fillRate",
          "qualityScore"
        FROM "VendorPerformanceLog"
        WHERE "vendorId" = $1
        AND "actualDeliveryAt" >= NOW() - INTERVAL '30 days'
        ORDER BY "actualDeliveryAt" DESC
        LIMIT 10
      `, vendor.id);

      // Get lead time statistics
      const leadTimeResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(AVG("leadTimeDays")::float, 0) as avg,
          COALESCE(MIN("leadTimeDays"), 0) as min,
          COALESCE(MAX("leadTimeDays"), 0) as max,
          CASE
            WHEN COUNT(*) >= 2 THEN 'IMPROVING'
            ELSE 'STABLE'
          END as trend
        FROM "VendorPerformanceLog"
        WHERE "vendorId" = $1
      `, vendor.id);

      const leadTimes = leadTimeResult[0] || {
        avg: scorecard.avgLeadTimeDays || 0,
        min: 0,
        max: 0,
        trend: 'STABLE',
      };

      // Count active POs
      const activePOsResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count
        FROM "PurchaseOrder"
        WHERE "vendorId" = $1
        AND "status" IN ($2::"POStatus", $3::"POStatus")
      `, vendor.id, 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED');

      const activePOs = Number(activePOsResult[0]?.count || 0);

      // Count pending deliveries
      const pendingDeliveriesResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count
        FROM "PurchaseOrder"
        WHERE "vendorId" = $1
        AND "status" NOT IN ($2::"POStatus", $3::"POStatus", $4::"POStatus")
        AND "expectedDate" IS NOT NULL
      `, vendor.id, 'RECEIVED', 'CANCELLED', 'DRAFT');

      const pendingDeliveries = Number(pendingDeliveriesResult[0]?.count || 0);

      vendorData.push({
        id: vendor.id,
        name: vendor.name,
        code: vendor.code,
        scorecard: {
          overallScore: Math.round(scorecard.overallScore * 100) / 100,
          deliveryScore: Math.round(scorecard.deliveryScore * 100) / 100,
          qualityScore: Math.round(scorecard.qualityScore * 100) / 100,
          costScore: Math.round(scorecard.costScore * 100) / 100,
          avgLeadTimeDays: Math.round(scorecard.avgLeadTimeDays * 10) / 10,
          onTimeRate: Math.round(scorecard.onTimeRate * 10000) / 10000,
          totalPOs: scorecard.totalPOs,
          totalSpend: Math.round(scorecard.totalSpend * 100) / 100,
          riskLevel: scorecard.riskLevel,
          costTrend: scorecard.costTrend,
        },
        recentPerformance: includePerformance ? recentPerformanceResult : [],
        leadTimes: {
          avg: Math.round(leadTimes.avg * 10) / 10,
          min: leadTimes.min,
          max: leadTimes.max,
          trend: leadTimes.trend,
        },
        activePOs,
        pendingDeliveries,
      });
    }

    // Calculate summary
    const totalVendorsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count FROM "Vendor" WHERE "active" = true
    `);
    const totalVendors = Number(totalVendorsResult[0]?.count || 0);

    // Calculate average metrics
    const avgMetricsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(AVG("onTimeRate")::float, 0) as avgOnTimeRate,
        COUNT(*)::int as totalScorecards
      FROM "VendorScorecard"
    `);

    const avgMetrics = avgMetricsResult[0] || { avgOnTimeRate: 0, totalScorecards: 0 };

    // Count open POs
    const openPOsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "PurchaseOrder"
      WHERE "status" IN ($1::"POStatus", $2::"POStatus", $3::"POStatus")
    `, 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR');

    const totalOpenPOs = Number(openPOsResult[0]?.count || 0);

    // Calculate pending value
    const pendingValueResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM("total")::float, 0) as total
      FROM "PurchaseOrder"
      WHERE "status" IN ($1::"POStatus", $2::"POStatus")
      AND "receivedAt" IS NULL
    `, 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED');

    const totalPendingValue = pendingValueResult[0]?.total || 0;

    // Find top performer
    const topPerformerResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT v."name"
      FROM "VendorScorecard" vs
      JOIN "Vendor" v ON v."id" = vs."vendorId"
      ORDER BY vs."overallScore" DESC
      LIMIT 1
    `);

    const topPerformer = topPerformerResult[0]?.name || 'N/A';

    // Find risk alerts (onTimeRate < 0.80 or avgDamageRate > 0.05)
    const riskAlertsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        v."name" as vendor,
        vs."onTimeRate",
        vs."avgDamageRate",
        CASE
          WHEN vs."onTimeRate" < 0.70 THEN 'CRITICAL'
          WHEN vs."avgDamageRate" > 0.10 THEN 'CRITICAL'
          WHEN vs."onTimeRate" < 0.80 THEN 'HIGH'
          WHEN vs."avgDamageRate" > 0.05 THEN 'HIGH'
          ELSE 'MEDIUM'
        END as severity,
        CASE
          WHEN vs."onTimeRate" < 0.70 THEN 'On-time rate critically low'
          WHEN vs."avgDamageRate" > 0.10 THEN 'Damage rate critically high'
          WHEN vs."onTimeRate" < 0.80 THEN 'On-time rate below target'
          ELSE 'Damage rate elevated'
        END as issue
      FROM "VendorScorecard" vs
      JOIN "Vendor" v ON v."id" = vs."vendorId"
      WHERE vs."onTimeRate" < 0.80 OR vs."avgDamageRate" > 0.05
      ORDER BY severity DESC
    `);

    return safeJson({
      vendors: vendorData,
      summary: {
        totalVendors,
        avgOnTimeRate: Math.round(avgMetrics.avgOnTimeRate * 10000) / 10000,
        totalOpenPOs,
        totalPendingValue: Math.round(totalPendingValue * 100) / 100,
        topPerformer,
        riskAlerts: riskAlertsResult.map((alert: any) => ({
          vendor: alert.vendor,
          issue: alert.issue,
          severity: alert.severity,
        })),
      },
    });
  } catch (error: any) {
    console.error('Vendor scoring GET error:', error);
    return safeJson(
      {
        error: 'Failed to fetch vendor intelligence',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    let action = 'recalculate-scores';
    try {
      const body = await request.json();
      action = body.action || 'recalculate-scores';
    } catch {
      // No body or invalid JSON — default to recalculate-scores
    }

    let vendorsScored = 0;
    let seededFromPOs = 0;

    // Get all active vendors
    const vendorsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "name" FROM "Vendor" WHERE "active" = true
    `);

    for (const vendor of vendorsResult) {
      const vendorId = vendor.id;

      // Check if we have any performance logs for this vendor
      const logCountResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count FROM "VendorPerformanceLog" WHERE "vendorId" = $1
      `, vendorId);

      const logCount = Number(logCountResult[0]?.count || 0);

      // If no logs, seed from received POs
      if (logCount === 0) {
        const receivedPOsResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            po."id",
            po."vendorId",
            po."orderedAt",
            po."receivedAt",
            poi."quantity" as "quantityOrdered",
            poi."receivedQty",
            poi."damagedQty",
            poi."unitCost"
          FROM "PurchaseOrder" po
          LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
          WHERE po."vendorId" = $1
          AND po."status" = $2::"POStatus"
          AND po."orderedAt" IS NOT NULL
          AND po."receivedAt" IS NOT NULL
        `, vendorId, 'RECEIVED');

        for (const po of receivedPOsResult) {
          const leadTimeDays = Math.ceil(
            (new Date(po.receivedAt).getTime() - new Date(po.orderedAt).getTime()) /
            (1000 * 60 * 60 * 24)
          );

          const fillRate =
            po.quantityOrdered > 0
              ? (po.receivedQty || 0) / po.quantityOrdered
              : 1.0;

          const damageRate =
            (po.receivedQty || 0) > 0
              ? (po.damagedQty || 0) / (po.receivedQty || 1)
              : 0;

          await prisma.$executeRawUnsafe(`
            INSERT INTO "VendorPerformanceLog" (
              "id", "vendorId", "purchaseOrderId", "orderedAt",
              "actualDeliveryAt", "leadTimeDays", "daysLateOrEarly",
              "quantityOrdered", "quantityReceived", "quantityDamaged",
              "fillRate", "qualityScore", "unitCostAtOrder", "createdAt"
            ) VALUES (
              gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11, $12, NOW()
            )
          `,
          vendorId,
          po.id,
          po.orderedAt,
          po.receivedAt,
          leadTimeDays,
          0,
          po.quantityOrdered,
          po.receivedQty || 0,
          po.damagedQty || 0,
          fillRate,
          1.0 - damageRate,
          po.unitCost
          );

          seededFromPOs++;
        }
      }

      // Now calculate scores from all performance logs
      const metricsResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(AVG("leadTimeDays")::float, 0) as avgLeadTimeDays,
          COALESCE(STDDEV("leadTimeDays")::float, 0) as leadTimeStdDev,
          COUNT(CASE WHEN "daysLateOrEarly" <= 0 THEN 1 END)::float / NULLIF(COUNT(*)::float, 0) as onTimeRate,
          COUNT(CASE WHEN "daysLateOrEarly" < 0 THEN 1 END)::float / NULLIF(COUNT(*)::float, 0) as earlyRate,
          COUNT(CASE WHEN "daysLateOrEarly" > 0 THEN 1 END)::float / NULLIF(COUNT(*)::float, 0) as lateRate,
          COALESCE(AVG("fillRate")::float, 1.0) as avgFillRate,
          COALESCE(AVG("quantityDamaged"::float / NULLIF("quantityReceived", 0)), 0) as avgDamageRate,
          COUNT(DISTINCT "purchaseOrderId")::int as totalPOs,
          COALESCE(SUM("unitCostAtOrder" * "quantityOrdered")::float, 0) as totalSpend
        FROM "VendorPerformanceLog"
        WHERE "vendorId" = $1
      `, vendorId);

      const metrics = metricsResult[0] || {
        avgLeadTimeDays: 0,
        leadTimeStdDev: 0,
        onTimeRate: 0,
        earlyRate: 0,
        lateRate: 0,
        avgFillRate: 1.0,
        avgDamageRate: 0,
        totalPOs: 0,
        totalSpend: 0,
      };

      // Calculate composite scores
      const avgLeadDays = metrics.avgLeadTimeDays || 1;
      const leadTimeVariability =
        avgLeadDays > 0
          ? Math.min(metrics.leadTimeStdDev / avgLeadDays, 1)
          : 0;

      const deliveryScore =
        (metrics.onTimeRate || 0) * 70 +
        (1 - leadTimeVariability) * 30;

      const qualityScore =
        ((metrics.avgFillRate || 1.0) * 60 +
          (1 - (metrics.avgDamageRate || 0)) * 40) *
        (100 / 100);

      // Placeholder cost score (0-100)
      const costScore = 75;

      // Placeholder communication score (0-100)
      const communicationScore = 80;

      const overallScore =
        deliveryScore * 0.35 +
        qualityScore * 0.3 +
        costScore * 0.25 +
        communicationScore * 0.1;

      // Determine risk level
      let riskLevel = 'LOW';
      if (
        (metrics.onTimeRate || 0) < 0.7 ||
        (metrics.avgDamageRate || 0) > 0.1
      ) {
        riskLevel = 'HIGH';
      } else if (
        (metrics.onTimeRate || 0) < 0.85 ||
        (metrics.avgDamageRate || 0) > 0.05
      ) {
        riskLevel = 'MEDIUM';
      }

      // Determine cost trend (placeholder)
      const costTrend = 'STABLE';

      // UPSERT VendorScorecard
      await prisma.$executeRawUnsafe(`
        INSERT INTO "VendorScorecard" (
          "id", "vendorId", "overallScore", "deliveryScore", "qualityScore",
          "costScore", "communicationScore", "avgLeadTimeDays", "leadTimeStdDev",
          "onTimeRate", "earlyRate", "lateRate", "avgFillRate", "avgDamageRate",
          "totalPOs", "totalSpend", "costTrend", "riskLevel", "lastEvaluatedAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW()
        )
        ON CONFLICT ("vendorId") DO UPDATE SET
          "overallScore" = EXCLUDED."overallScore",
          "deliveryScore" = EXCLUDED."deliveryScore",
          "qualityScore" = EXCLUDED."qualityScore",
          "costScore" = EXCLUDED."costScore",
          "communicationScore" = EXCLUDED."communicationScore",
          "avgLeadTimeDays" = EXCLUDED."avgLeadTimeDays",
          "leadTimeStdDev" = EXCLUDED."leadTimeStdDev",
          "onTimeRate" = EXCLUDED."onTimeRate",
          "earlyRate" = EXCLUDED."earlyRate",
          "lateRate" = EXCLUDED."lateRate",
          "avgFillRate" = EXCLUDED."avgFillRate",
          "avgDamageRate" = EXCLUDED."avgDamageRate",
          "totalPOs" = EXCLUDED."totalPOs",
          "totalSpend" = EXCLUDED."totalSpend",
          "costTrend" = EXCLUDED."costTrend",
          "riskLevel" = EXCLUDED."riskLevel",
          "lastEvaluatedAt" = NOW(),
          "updatedAt" = NOW()
      `,
      vendorId,
      overallScore,
      deliveryScore,
      qualityScore,
      costScore,
      communicationScore,
      metrics.avgLeadTimeDays,
      metrics.leadTimeStdDev,
      metrics.onTimeRate,
      metrics.earlyRate,
      metrics.lateRate,
      metrics.avgFillRate,
      metrics.avgDamageRate,
      metrics.totalPOs,
      metrics.totalSpend,
      costTrend,
      riskLevel
      );

      // Update Vendor table
      await prisma.$executeRawUnsafe(`
        UPDATE "Vendor"
        SET
          "avgLeadDays" = $2,
          "onTimeRate" = $3,
          "riskScore" = $4,
          "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      vendorId,
      Math.round(metrics.avgLeadTimeDays),
      metrics.onTimeRate,
      riskLevel === 'HIGH' ? 0.75 : riskLevel === 'MEDIUM' ? 0.5 : 0.25
      );

      vendorsScored++;
    }

    return safeJson({
      success: true,
      vendorsScored,
      seededFromPOs,
      message: `Recalculated scores for ${vendorsScored} vendors`,
    });
  } catch (error: any) {
    console.error('Vendor scoring POST error:', error);
    return safeJson(
      {
        error: 'Failed to recalculate vendor scores',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
