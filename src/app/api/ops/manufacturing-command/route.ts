export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const staffId = request.headers.get('x-staff-id');
    const staffRole = request.headers.get('x-staff-role');

    if (!staffId || !staffRole) {
      return NextResponse.json(
        { success: false, error: 'Missing authentication headers' },
        { status: 401 }
      );
    }

    // Get section parameter
    const section = request.nextUrl.searchParams.get('section') || 'overview';

    // Route to appropriate section handler
    let data = {};

    if (section === 'overview') {
      data = await getOverviewData();
    } else if (section === 'efficiency') {
      data = await getEfficiencyData();
    } else {
      return NextResponse.json(
        { success: false, error: `Unknown section: ${section}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      section,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Manufacturing Command Center API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String((error as any)?.message || error) },
      { status: 500 }
    );
  }
}

async function getOverviewData() {
  // Jobs by status count
  const jobsByStatus = await prisma.$queryRawUnsafe<any[]>(`
    SELECT status, COUNT(*) as count
    FROM jobs
    WHERE status IN ($1, $2, $3, $4, $5, $6)
    GROUP BY status
  `, 'CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED');

  const jobStatusMap: Record<string, number> = {
    CREATED: 0,
    READINESS_CHECK: 0,
    MATERIALS_LOCKED: 0,
    IN_PRODUCTION: 0,
    STAGED: 0,
    LOADED: 0,
  };

  jobsByStatus.forEach((row: any) => {
    jobStatusMap[row.status] = Number(row.count);
  });

  // Pick summary by status
  const pickSummary = await prisma.$queryRawUnsafe<any[]>(`
    SELECT status, COUNT(*) as count
    FROM picks
    WHERE status IN ($1, $2, $3, $4, $5)
    GROUP BY status
  `, 'PENDING', 'PICKING', 'PICKED', 'VERIFIED', 'SHORT');

  const pickStatusMap: Record<string, number> = {
    PENDING: 0,
    PICKING: 0,
    PICKED: 0,
    VERIFIED: 0,
    SHORT: 0,
  };

  pickSummary.forEach((row: any) => {
    pickStatusMap[row.status] = Number(row.count);
  });

  // QC pass rate and fail count (last 30 days)
  const qcStats = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN result = $1 THEN 1 ELSE 0 END) as pass_count
    FROM quality_checks
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `, 'PASS');

  const qcTotal = Number(qcStats[0]?.total || 0);
  const qcPassCount = Number(qcStats[0]?.pass_count || 0);
  const qcPassRate = qcTotal > 0 ? (qcPassCount / qcTotal) * 100 : 0;

  const qcFailCount = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) as fail_count
    FROM quality_checks
    WHERE result = $1 AND created_at >= NOW() - INTERVAL '30 days'
  `, 'FAIL');

  const failCount = Number(qcFailCount[0]?.fail_count || 0);

  // Units completed this week (jobs reaching STAGED or LOADED)
  const unitsThisWeek = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(DISTINCT id) as completed
    FROM jobs
    WHERE status IN ($1, $2)
      AND updated_at >= DATE_TRUNC('week', NOW())
  `, 'STAGED', 'LOADED');

  const unitsCompleted = Number(unitsThisWeek[0]?.completed || 0);

  // Top 5 jobs in production
  const topJobs = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      j.id,
      j.job_number as "jobNumber",
      j.builder_name as "builderName",
      j.community,
      j.scheduled_date as "scheduledDate",
      ROUND(
        COALESCE(
          (SELECT COUNT(*)::numeric FROM picks WHERE job_id = j.id AND status IN ($1, $2, $3, $4)) /
          NULLIF((SELECT COUNT(*)::numeric FROM picks WHERE job_id = j.id), 0),
          0
        ) * 100,
        2
      ) as pick_completion_pct
    FROM jobs j
    WHERE j.status = $5
    ORDER BY j.updated_at DESC
    LIMIT 5
  `, 'PICKED', 'VERIFIED', 'STAGED', 'LOADED', 'IN_PRODUCTION');

  const topJobsList = topJobs.map((row: any) => ({
    id: row.id,
    jobNumber: row.jobNumber,
    builderName: row.builderName,
    community: row.community,
    scheduledDate: row.scheduledDate,
    pickCompletionPct: Number(row.pick_completion_pct || 0),
  }));

  // Material shortage alerts
  const shortageAlerts = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      p.sku,
      SUM(p.short_quantity) as total_short_qty,
      COUNT(DISTINCT p.job_id) as affected_job_count
    FROM picks p
    WHERE p.status = $1
    GROUP BY p.sku
    ORDER BY total_short_qty DESC
  `, 'SHORT');

  const shortageList = shortageAlerts.map((row: any) => ({
    sku: row.sku,
    totalShortQty: Number(row.total_short_qty || 0),
    affectedJobCount: Number(row.affected_job_count || 0),
  }));

  return {
    jobsByStatus: jobStatusMap,
    pickSummary: pickStatusMap,
    qcPassRate: Number(qcPassRate.toFixed(2)),
    qcFailCount: failCount,
    unitsCompletedThisWeek: unitsCompleted,
    topJobsInProduction: topJobsList,
    materialShortageAlerts: shortageList,
  };
}

async function getEfficiencyData() {
  // Avg days from CREATED to STAGED (last 30 completed)
  const createdToStaged = await prisma.$queryRawUnsafe<any[]>(`
    SELECT AVG(EXTRACT(DAY FROM (staged_date - created_date))) as avg_days
    FROM (
      SELECT
        created_at as created_date,
        updated_at as staged_date
      FROM jobs
      WHERE status IN ($1, $2)
        AND updated_at >= NOW() - INTERVAL '30 days'
      ORDER BY updated_at DESC
      LIMIT 30
    ) subquery
  `, 'STAGED', 'LOADED');

  const avgCreatedToStaged = Number(createdToStaged[0]?.avg_days || 0);

  // Avg days IN_PRODUCTION to STAGED
  const inProductionToStaged = await prisma.$queryRawUnsafe<any[]>(`
    SELECT AVG(EXTRACT(DAY FROM (updated_at - created_at))) as avg_days
    FROM jobs
    WHERE status IN ($1, $2)
      AND created_at >= NOW() - INTERVAL '30 days'
  `, 'STAGED', 'LOADED');

  const avgInProductionToStaged = Number(inProductionToStaged[0]?.avg_days || 0);

  // Average picks per job
  const avgPicksPerJob = await prisma.$queryRawUnsafe<any[]>(`
    SELECT AVG(pick_count) as avg_picks
    FROM (
      SELECT COUNT(*) as pick_count
      FROM picks
      GROUP BY job_id
    ) subquery
  `);

  const avgPicks = Number(avgPicksPerJob[0]?.avg_picks || 0);

  // Jobs completed per week (last 8 weeks)
  const completionPerWeek = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      DATE_TRUNC('week', updated_at)::DATE as week,
      COUNT(*) as completed
    FROM jobs
    WHERE status IN ($1, $2)
      AND updated_at >= NOW() - INTERVAL '8 weeks'
    GROUP BY DATE_TRUNC('week', updated_at)
    ORDER BY week ASC
  `, 'STAGED', 'LOADED');

  const weeklyCompletion = completionPerWeek.map((row: any) => ({
    week: row.week,
    completed: Number(row.completed),
  }));

  // On-time rate (jobs staged by scheduledDate / total staged)
  const onTimeStats = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) as total_staged,
      SUM(CASE WHEN updated_at <= scheduled_date THEN 1 ELSE 0 END) as on_time_count
    FROM jobs
    WHERE status IN ($1, $2)
      AND scheduled_date IS NOT NULL
  `, 'STAGED', 'LOADED');

  const totalStaged = Number(onTimeStats[0]?.total_staged || 0);
  const onTimeCount = Number(onTimeStats[0]?.on_time_count || 0);
  const onTimeRate = totalStaged > 0 ? (onTimeCount / totalStaged) * 100 : 0;

  // This month vs last month throughput
  const monthThroughput = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      EXTRACT(MONTH FROM updated_at) as month,
      EXTRACT(YEAR FROM updated_at) as year,
      COUNT(*) as completed
    FROM jobs
    WHERE status IN ($1, $2)
      AND updated_at >= NOW() - INTERVAL '2 months'
    GROUP BY EXTRACT(MONTH FROM updated_at), EXTRACT(YEAR FROM updated_at)
    ORDER BY year DESC, month DESC
    LIMIT 2
  `, 'STAGED', 'LOADED');

  let thisMonthThroughput = 0;
  let lastMonthThroughput = 0;

  if (monthThroughput.length > 0) {
    thisMonthThroughput = Number(monthThroughput[0]?.completed || 0);
    if (monthThroughput.length > 1) {
      lastMonthThroughput = Number(monthThroughput[1]?.completed || 0);
    }
  }

  const throughputChange = lastMonthThroughput > 0
    ? (((thisMonthThroughput - lastMonthThroughput) / lastMonthThroughput) * 100)
    : 0;

  return {
    avgDaysCreatedToStaged: Number(avgCreatedToStaged.toFixed(2)),
    avgDaysInProductionToStaged: Number(avgInProductionToStaged.toFixed(2)),
    averagePicksPerJob: Number(avgPicks.toFixed(2)),
    jobsCompletedPerWeek: weeklyCompletion,
    onTimeRate: Number(onTimeRate.toFixed(2)),
    thisMonthThroughput,
    lastMonthThroughput,
    throughputChangePercent: Number(throughputChange.toFixed(2)),
  };
}
