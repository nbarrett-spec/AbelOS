export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Delivery Route Optimization & Fleet Intelligence API
// Route analysis, delivery performance, fleet utilization, cost attribution

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'performance': return await getDeliveryPerformance();
      case 'crew-utilization': return await getCrewUtilization();
      case 'route-analysis': return await getRouteAnalysis();
      case 'cost-attribution': return await getCostAttribution();
      default: return safeJson({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error) {
    console.error('Delivery optimization error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  const deliveryStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalDeliveries",
      COUNT(CASE WHEN status = 'SCHEDULED' THEN 1 END)::int as "scheduled",
      COUNT(CASE WHEN status = 'IN_TRANSIT' THEN 1 END)::int as "inTransit",
      COUNT(CASE WHEN status = 'COMPLETE' THEN 1 END)::int as "completed",
      COUNT(CASE WHEN status = 'RESCHEDULED' THEN 1 END)::int as "cancelled",
      COUNT(CASE WHEN "completedAt" IS NOT NULL AND "completedAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "completedThisWeek",
      COUNT(CASE WHEN "completedAt" IS NOT NULL AND "completedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "completedThisMonth"
    FROM "Delivery"
  `);

  const crewStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalCrews",
      COUNT(CASE WHEN active = true THEN 1 END)::int as "activeCrews",
      COUNT(CASE WHEN "crewType" = 'DELIVERY' THEN 1 END)::int as "deliveryCrews",
      COUNT(CASE WHEN "crewType" = 'INSTALLATION' THEN 1 END)::int as "installCrews"
    FROM "Crew"
  `);

  const scheduleStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "scheduledDate" >= CURRENT_DATE AND "scheduledDate" < CURRENT_DATE + INTERVAL '1 day' THEN 1 END)::int as "today",
      COUNT(CASE WHEN "scheduledDate" >= CURRENT_DATE AND "scheduledDate" < CURRENT_DATE + INTERVAL '7 days' THEN 1 END)::int as "thisWeek",
      COUNT(CASE WHEN status = 'TENTATIVE' THEN 1 END)::int as "tentative",
      COUNT(CASE WHEN status = 'FIRM' THEN 1 END)::int as "confirmed"
    FROM "ScheduleEntry"
    WHERE "entryType" = 'DELIVERY'
  `);

  // On-time delivery rate
  const onTime: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "total",
      COUNT(CASE WHEN d."completedAt" IS NOT NULL
        AND se."scheduledDate" IS NOT NULL
        AND d."completedAt"::date <= se."scheduledDate"::date
        THEN 1 END)::int as "onTime",
      ROUND(
        CASE WHEN COUNT(*) > 0
        THEN COUNT(CASE WHEN d."completedAt" IS NOT NULL
          AND se."scheduledDate" IS NOT NULL
          AND d."completedAt"::date <= se."scheduledDate"::date
          THEN 1 END)::numeric / COUNT(*)::numeric * 100
        ELSE 0 END, 1
      ) as "onTimePct"
    FROM "Delivery" d
    JOIN "Job" j ON d."jobId" = j.id
    LEFT JOIN "ScheduleEntry" se ON j.id = se."jobId" AND se."entryType" = 'DELIVERY'
    WHERE d."completedAt" IS NOT NULL
    AND d."completedAt" > NOW() - INTERVAL '90 days'
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    deliveries: deliveryStats[0] || {},
    crews: crewStats[0] || {},
    schedule: scheduleStats[0] || {},
    onTimeRate: onTime[0] || {},
  });
}

async function getDeliveryPerformance() {
  // Delivery performance by crew
  const crewPerformance: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      c.id, c.name, c."crewType", c."vehicleId", c."vehiclePlate",
      COUNT(d.id)::int as "totalDeliveries",
      COUNT(CASE WHEN d.status = 'COMPLETE' THEN 1 END)::int as "completed",
      COUNT(CASE WHEN d.status = 'SCHEDULED' THEN 1 END)::int as "pending",
      ROUND(AVG(CASE WHEN d."completedAt" IS NOT NULL AND d."departedAt" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (d."completedAt" - d."departedAt")) / 3600.0
        END)::numeric, 1) as "avgHoursPerDelivery",
      MAX(d."completedAt") as "lastDeliveryDate"
    FROM "Crew" c
    LEFT JOIN "Delivery" d ON c.id = d."crewId"
    WHERE c.active = true
    GROUP BY c.id, c.name, c."crewType", c."vehicleId", c."vehiclePlate"
    ORDER BY "totalDeliveries" DESC NULLS LAST
  `);

  // Weekly delivery volume
  const weeklyVolume: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('week', "completedAt") as "week",
      COUNT(*)::int as "deliveries"
    FROM "Delivery"
    WHERE "completedAt" IS NOT NULL AND "completedAt" > NOW() - INTERVAL '12 weeks'
    GROUP BY DATE_TRUNC('week', "completedAt")
    ORDER BY "week" DESC
  `);

  return safeJson({
    report: 'performance',
    generatedAt: new Date().toISOString(),
    crewPerformance,
    weeklyVolume,
  });
}

async function getCrewUtilization() {
  // Schedule density per crew (how busy is each crew?)
  const utilization: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      c.id, c.name, c."crewType", c."vehiclePlate",
      COUNT(CASE WHEN se."scheduledDate" >= CURRENT_DATE AND se."scheduledDate" < CURRENT_DATE + INTERVAL '7 days' THEN 1 END)::int as "scheduledThisWeek",
      COUNT(CASE WHEN se."scheduledDate" >= CURRENT_DATE AND se."scheduledDate" < CURRENT_DATE + INTERVAL '30 days' THEN 1 END)::int as "scheduledThisMonth",
      COUNT(CASE WHEN se.status = 'COMPLETED' AND se."completedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "completedThisMonth",
      COUNT(CASE WHEN d.status = 'SCHEDULED' THEN 1 END)::int as "pendingDeliveries"
    FROM "Crew" c
    LEFT JOIN "ScheduleEntry" se ON c.id = se."crewId"
    LEFT JOIN "Delivery" d ON c.id = d."crewId" AND d.status IN ('SCHEDULED', 'IN_TRANSIT')
    WHERE c.active = true
    GROUP BY c.id, c.name, c."crewType", c."vehiclePlate"
    ORDER BY "scheduledThisWeek" DESC
  `);

  return safeJson({
    report: 'crew-utilization',
    generatedAt: new Date().toISOString(),
    crews: utilization,
  });
}

async function getRouteAnalysis() {
  // Delivery addresses and clustering for route optimization
  const deliveryAddresses: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d.id, d.address, d.status, d."routeOrder",
      d."departedAt", d."arrivedAt", d."completedAt",
      c.name as "crewName",
      j.id as "jobId",
      CASE WHEN d."arrivedAt" IS NOT NULL AND d."departedAt" IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (d."arrivedAt" - d."departedAt")) / 60.0)
        ELSE NULL
      END as "transitMinutes",
      CASE WHEN d."completedAt" IS NOT NULL AND d."arrivedAt" IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (d."completedAt" - d."arrivedAt")) / 60.0)
        ELSE NULL
      END as "onSiteMinutes"
    FROM "Delivery" d
    LEFT JOIN "Crew" c ON d."crewId" = c.id
    JOIN "Job" j ON d."jobId" = j.id
    WHERE d."completedAt" > NOW() - INTERVAL '90 days'
    ORDER BY d."completedAt" DESC
    LIMIT 100
  `);

  // Average delivery metrics
  const avgMetrics: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(AVG(CASE WHEN d."arrivedAt" IS NOT NULL AND d."departedAt" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (d."arrivedAt" - d."departedAt")) / 60.0 END)::numeric, 0) as "avgTransitMin",
      ROUND(AVG(CASE WHEN d."completedAt" IS NOT NULL AND d."arrivedAt" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (d."completedAt" - d."arrivedAt")) / 60.0 END)::numeric, 0) as "avgOnSiteMin",
      ROUND(AVG(CASE WHEN d."completedAt" IS NOT NULL AND d."departedAt" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (d."completedAt" - d."departedAt")) / 60.0 END)::numeric, 0) as "avgTotalMin"
    FROM "Delivery" d
    WHERE d."completedAt" > NOW() - INTERVAL '90 days'
  `);

  return safeJson({
    report: 'route-analysis',
    generatedAt: new Date().toISOString(),
    deliveries: deliveryAddresses,
    metrics: avgMetrics[0] || {},
  });
}

async function getCostAttribution() {
  // Estimate delivery cost per order (placeholder - will be enhanced with actual fuel/labor data)
  const costByBuilder: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id as "builderId", b."companyName",
      COUNT(DISTINCT d.id) as "deliveryCount",
      COUNT(DISTINCT j.id) as "jobCount",
      ROUND(AVG(CASE WHEN d."completedAt" IS NOT NULL AND d."departedAt" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (d."completedAt" - d."departedAt")) / 3600.0 END)::numeric, 1) as "avgHoursPerDelivery"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    JOIN "Job" j ON o.id = j."orderId"
    JOIN "Delivery" d ON j.id = d."jobId"
    WHERE d."completedAt" IS NOT NULL
    GROUP BY b.id, b."companyName"
    ORDER BY "deliveryCount" DESC
  `);

  return safeJson({
    report: 'cost-attribution',
    generatedAt: new Date().toISOString(),
    byBuilder: costByBuilder,
  });
}
