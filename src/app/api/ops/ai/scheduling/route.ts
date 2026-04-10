export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// AI Scheduling Optimizer
// Intelligent crew scheduling, workload balancing, delivery window optimization,
// conflict detection, and capacity planning

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'workload': return await getWorkloadBalance();
      case 'conflicts': return await getConflicts();
      case 'capacity': return await getCapacityPlanning();
      case 'optimization': return await getOptimizationSuggestions();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Scheduling optimizer error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Current schedule overview
  const scheduleOverview: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalEntries",
      COUNT(CASE WHEN "scheduledDate" = CURRENT_DATE THEN 1 END)::int as "todayEntries",
      COUNT(CASE WHEN "scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days' THEN 1 END)::int as "thisWeekEntries",
      COUNT(CASE WHEN status = 'COMPLETED' AND "scheduledDate" >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END)::int as "completedThisWeek",
      COUNT(CASE WHEN status::text IN ('TENTATIVE', 'FIRM') AND "scheduledDate" < CURRENT_DATE THEN 1 END)::int as "overdueEntries",
      COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END)::int as "inProgress"
    FROM "ScheduleEntry"
  `);

  // Crew availability
  const crewStatus: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      c.id, c.name, c."crewType", c.active,
      COUNT(CASE WHEN se."scheduledDate" = CURRENT_DATE AND se.status != 'COMPLETED' THEN 1 END)::int as "todayJobs",
      COUNT(CASE WHEN se."scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days' AND se.status != 'COMPLETED' THEN 1 END)::int as "weekJobs",
      COUNT(CASE WHEN se.status = 'IN_PROGRESS' THEN 1 END)::int as "activeNow"
    FROM "Crew" c
    LEFT JOIN "ScheduleEntry" se ON c.id = se."crewId"
    WHERE c.active = true
    GROUP BY c.id, c.name, c."crewType", c.active
    ORDER BY "todayJobs" DESC
  `);

  // Delivery pipeline
  const deliveryPipeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalDeliveries",
      COUNT(CASE WHEN status = 'SCHEDULED' THEN 1 END)::int as scheduled,
      COUNT(CASE WHEN status = 'IN_TRANSIT' THEN 1 END)::int as "inTransit",
      COUNT(CASE WHEN status = 'COMPLETE' AND "completedAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "deliveredThisWeek",
      COUNT(CASE WHEN status = 'REFUSED' THEN 1 END)::int as failed
    FROM "Delivery"
  `);

  // Schedule entry types breakdown
  const entryTypes: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      "entryType",
      COUNT(*)::int as count,
      COUNT(CASE WHEN "scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days' THEN 1 END)::int as "thisWeek"
    FROM "ScheduleEntry"
    WHERE "scheduledDate" >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY "entryType"
    ORDER BY count DESC
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    overview: scheduleOverview[0] || {},
    crewStatus,
    deliveryPipeline: deliveryPipeline[0] || {},
    entryTypes,
  });
}

async function getWorkloadBalance() {
  // Per-crew workload analysis
  const crewWorkload: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      c.id, c.name, c."crewType", c."vehiclePlate",
      -- This week
      COUNT(CASE WHEN se."scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days' THEN 1 END)::int as "thisWeekJobs",
      -- Next week
      COUNT(CASE WHEN se."scheduledDate" BETWEEN CURRENT_DATE + INTERVAL '7 days' AND CURRENT_DATE + INTERVAL '13 days' THEN 1 END)::int as "nextWeekJobs",
      -- This month
      COUNT(CASE WHEN se."scheduledDate" >= DATE_TRUNC('month', CURRENT_DATE) AND se."scheduledDate" < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' THEN 1 END)::int as "thisMonthJobs",
      -- Completion rate (last 30 days)
      CASE
        WHEN COUNT(CASE WHEN se."scheduledDate" >= CURRENT_DATE - INTERVAL '30 days' AND se."scheduledDate" < CURRENT_DATE THEN 1 END) > 0
        THEN ROUND(
          COUNT(CASE WHEN se.status = 'COMPLETED' AND se."scheduledDate" >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END)::numeric /
          COUNT(CASE WHEN se."scheduledDate" >= CURRENT_DATE - INTERVAL '30 days' AND se."scheduledDate" < CURRENT_DATE THEN 1 END)::numeric * 100
        , 1)
        ELSE 100
      END as "completionRate",
      -- Avg per day this week
      ROUND(
        COUNT(CASE WHEN se."scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days' THEN 1 END)::numeric / 5
      , 1) as "avgPerDay"
    FROM "Crew" c
    LEFT JOIN "ScheduleEntry" se ON c.id = se."crewId"
    WHERE c.active = true
    GROUP BY c.id, c.name, c."crewType", c."vehiclePlate"
    ORDER BY "thisWeekJobs" DESC
  `);

  // Daily distribution for the current week
  const dailyDist: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      se."scheduledDate"::date as date,
      TO_CHAR(se."scheduledDate", 'Day') as "dayName",
      COUNT(*)::int as "totalJobs",
      COUNT(DISTINCT se."crewId")::int as "crewsActive",
      json_agg(json_build_object(
        'crewId', c.id,
        'crewName', c.name,
        'jobs', 1
      )) as "crewBreakdown"
    FROM "ScheduleEntry" se
    LEFT JOIN "Crew" c ON se."crewId" = c.id
    WHERE se."scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days'
    GROUP BY se."scheduledDate"::date, TO_CHAR(se."scheduledDate", 'Day')
    ORDER BY date ASC
  `);

  // Identify imbalances
  const avgWeekJobs = crewWorkload.length > 0
    ? crewWorkload.reduce((s, c) => s + Number(c.thisWeekJobs || 0), 0) / crewWorkload.length
    : 0;

  const imbalances = crewWorkload.map(c => ({
    ...c,
    deviation: Number(c.thisWeekJobs || 0) - avgWeekJobs,
    status: Number(c.thisWeekJobs || 0) > avgWeekJobs * 1.5 ? 'OVERLOADED'
      : Number(c.thisWeekJobs || 0) < avgWeekJobs * 0.5 ? 'UNDERUTILIZED'
      : 'BALANCED',
  }));

  return safeJson({
    report: 'workload',
    generatedAt: new Date().toISOString(),
    crewWorkload: imbalances,
    dailyDistribution: dailyDist,
    avgWeeklyJobsPerCrew: Math.round(avgWeekJobs * 10) / 10,
  });
}

async function getConflicts() {
  // Double-booked crews (same crew, same date, overlapping times)
  const doubleBookings: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      se1.id as "entry1Id", se1.title as "entry1Title", se1."scheduledTime" as "entry1Time",
      se2.id as "entry2Id", se2.title as "entry2Title", se2."scheduledTime" as "entry2Time",
      se1."scheduledDate"::date as date,
      c.name as "crewName", c.id as "crewId"
    FROM "ScheduleEntry" se1
    JOIN "ScheduleEntry" se2 ON se1."crewId" = se2."crewId"
      AND se1."scheduledDate" = se2."scheduledDate"
      AND se1.id < se2.id
      AND se1."scheduledTime" = se2."scheduledTime"
    JOIN "Crew" c ON se1."crewId" = c.id
    WHERE se1."scheduledDate" >= CURRENT_DATE
      AND se1.status != 'COMPLETED' AND se2.status != 'COMPLETED'
    ORDER BY date ASC
    LIMIT 30
  `);

  // Overdue schedule entries
  const overdue: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      se.id, se.title, se."entryType", se."scheduledDate"::date as date, se."scheduledTime",
      se.status, c.name as "crewName",
      EXTRACT(DAY FROM AGE(CURRENT_DATE, se."scheduledDate"))::integer as "daysOverdue"
    FROM "ScheduleEntry" se
    LEFT JOIN "Crew" c ON se."crewId" = c.id
    WHERE se."scheduledDate" < CURRENT_DATE AND se.status::text IN ('TENTATIVE', 'FIRM')
    ORDER BY se."scheduledDate" ASC
    LIMIT 30
  `);

  // Unassigned entries (no crew)
  const unassigned: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      se.id, se.title, se."entryType", se."scheduledDate"::date as date, se."scheduledTime", se.status
    FROM "ScheduleEntry" se
    WHERE se."crewId" IS NULL
      AND se."scheduledDate" >= CURRENT_DATE
      AND se.status::text IN ('TENTATIVE', 'FIRM')
    ORDER BY se."scheduledDate" ASC
    LIMIT 30
  `);

  return safeJson({
    report: 'conflicts',
    generatedAt: new Date().toISOString(),
    doubleBookings,
    overdue,
    unassigned,
    summary: {
      doubleBookingCount: doubleBookings.length,
      overdueCount: overdue.length,
      unassignedCount: unassigned.length,
      totalIssues: doubleBookings.length + overdue.length + unassigned.length,
    },
  });
}

async function getCapacityPlanning() {
  // Crew capacity vs demand (next 4 weeks)
  const weeklyCapacity: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      week_start,
      COALESCE(demand.jobs, 0)::int as "scheduledJobs",
      (SELECT COUNT(*)::int FROM "Crew" WHERE active = true) * 5 as "weeklyCapacity",
      COALESCE(demand.jobs, 0)::numeric /
        NULLIF((SELECT COUNT(*)::int FROM "Crew" WHERE active = true) * 5, 0) * 100 as "utilizationPct"
    FROM (
      SELECT generate_series(
        DATE_TRUNC('week', CURRENT_DATE),
        DATE_TRUNC('week', CURRENT_DATE + INTERVAL '4 weeks'),
        '1 week'::interval
      ) as week_start
    ) weeks
    LEFT JOIN (
      SELECT
        DATE_TRUNC('week', "scheduledDate") as week,
        COUNT(*)::int as jobs
      FROM "ScheduleEntry"
      WHERE "scheduledDate" >= CURRENT_DATE AND "scheduledDate" <= CURRENT_DATE + INTERVAL '4 weeks'
      GROUP BY DATE_TRUNC('week', "scheduledDate")
    ) demand ON weeks.week_start = demand.week
    ORDER BY week_start ASC
  `);

  // Capacity by crew type
  const byType: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      c."crewType",
      COUNT(DISTINCT c.id)::int as "crewCount",
      COUNT(CASE WHEN se."scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '13 days' THEN 1 END)::int as "next2WeekJobs",
      COUNT(DISTINCT c.id)::int * 10 as "next2WeekCapacity"
    FROM "Crew" c
    LEFT JOIN "ScheduleEntry" se ON c.id = se."crewId"
    WHERE c.active = true
    GROUP BY c."crewType"
  `);

  // Upcoming job pipeline (orders needing scheduling)
  const pendingJobs: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN o."deliveryDate" IS NOT NULL AND o."deliveryDate" >= CURRENT_DATE THEN 1 END)::int as "ordersWithDeliveryDate",
      COUNT(CASE WHEN o."deliveryDate" IS NOT NULL AND o."deliveryDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' THEN 1 END)::int as "deliveriesThisWeek",
      COUNT(CASE WHEN o."deliveryDate" IS NOT NULL AND o."deliveryDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days' THEN 1 END)::int as "deliveriesNext2Weeks",
      COUNT(CASE WHEN o.status IN ('CONFIRMED', 'PROCESSING') THEN 1 END)::int as "activeOrders"
    FROM "Order" o
    WHERE o.status NOT IN ('CANCELLED', 'DELIVERED')
  `);

  return safeJson({
    report: 'capacity',
    generatedAt: new Date().toISOString(),
    weeklyCapacity,
    byType,
    pendingJobs: pendingJobs[0] || {},
  });
}

async function getOptimizationSuggestions() {
  // Generate AI-driven scheduling recommendations
  const suggestions: any[] = [];

  // 1. Check for overloaded crews
  const overloaded: any[] = await prisma.$queryRawUnsafe(`
    SELECT c.name, COUNT(se.id)::int as jobs
    FROM "Crew" c
    JOIN "ScheduleEntry" se ON c.id = se."crewId"
    WHERE se."scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days'
      AND se.status != 'COMPLETED'
    GROUP BY c.id, c.name
    HAVING COUNT(se.id) > 8
  `);
  for (const crew of overloaded) {
    suggestions.push({
      type: 'REBALANCE',
      priority: 'HIGH',
      title: `Crew "${crew.name}" is overloaded`,
      description: `${crew.jobs} jobs this week — consider redistributing to less busy crews.`,
      impact: 'Prevents delays and crew burnout',
    });
  }

  // 2. Check for underutilized crews
  const underutilized: any[] = await prisma.$queryRawUnsafe(`
    SELECT c.name, c.id,
      COALESCE(job_count.cnt, 0) as jobs
    FROM "Crew" c
    LEFT JOIN (
      SELECT "crewId", COUNT(*) as cnt
      FROM "ScheduleEntry"
      WHERE "scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days'
        AND status != 'COMPLETED'
      GROUP BY "crewId"
    ) job_count ON c.id = job_count."crewId"
    WHERE c.active = true AND COALESCE(job_count.cnt, 0) < 2
  `);
  if (underutilized.length > 0) {
    suggestions.push({
      type: 'UTILIZE',
      priority: 'MEDIUM',
      title: `${underutilized.length} crews underutilized this week`,
      description: `Crews with fewer than 2 jobs: ${underutilized.map(u => u.name).join(', ')}`,
      impact: 'Better resource utilization and faster fulfillment',
    });
  }

  // 3. Unscheduled deliveries
  const unscheduledDeliveries: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int as cnt
    FROM "Order"
    WHERE "deliveryDate" IS NOT NULL
      AND "deliveryDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      AND status IN ('CONFIRMED', 'PROCESSING')
      AND id NOT IN (SELECT DISTINCT "jobId" FROM "ScheduleEntry" WHERE "jobId" IS NOT NULL)
  `);
  const unschedCount = Number(unscheduledDeliveries[0]?.cnt || 0);
  if (unschedCount > 0) {
    suggestions.push({
      type: 'SCHEDULE',
      priority: 'HIGH',
      title: `${unschedCount} orders need delivery scheduling`,
      description: `Orders with delivery dates this week but no schedule entry.`,
      impact: 'Prevent missed deliveries and customer complaints',
    });
  }

  // 4. Same-area deliveries that could be batched
  const batchable: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d.address,
      COUNT(*)::int as "deliveryCount",
      ARRAY_AGG(DISTINCT d."crewId") as "crewIds"
    FROM "Delivery" d
    WHERE d.status = 'SCHEDULED'
    GROUP BY d.address
    HAVING COUNT(*) > 1
    LIMIT 10
  `);
  if (batchable.length > 0) {
    suggestions.push({
      type: 'BATCH',
      priority: 'MEDIUM',
      title: `${batchable.length} delivery addresses have multiple scheduled deliveries`,
      description: `Consider batching deliveries to the same address for efficiency.`,
      impact: 'Reduce fuel costs and delivery time',
    });
  }

  // 5. Weekend scheduling check
  const weekendJobs: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int as cnt
    FROM "ScheduleEntry"
    WHERE EXTRACT(DOW FROM "scheduledDate") IN (0, 6)
      AND "scheduledDate" >= CURRENT_DATE
      AND "scheduledDate" <= CURRENT_DATE + INTERVAL '14 days'
      AND status::text IN ('TENTATIVE', 'FIRM')
  `);
  if (Number(weekendJobs[0]?.cnt || 0) > 0) {
    suggestions.push({
      type: 'REVIEW',
      priority: 'LOW',
      title: `${weekendJobs[0].cnt} jobs scheduled on weekends`,
      description: `Verify these are intentional — weekend jobs may incur overtime costs.`,
      impact: 'Overtime cost control',
    });
  }

  return safeJson({
    report: 'optimization',
    generatedAt: new Date().toISOString(),
    suggestions,
    totalIssues: suggestions.length,
    highPriority: suggestions.filter(s => s.priority === 'HIGH').length,
  });
}
