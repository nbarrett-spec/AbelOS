export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface ScheduleJob {
  jobNumber: string
  builderName: string
  community: string
  lotBlock: string | null
  scheduledDate: string | null
  status: string
  createdAt: string
  updatedAt: string
  pickProgress: {
    total: number
    completed: number
    short: number
  }
  qcStatus: {
    result: string | null
    checkDate: string | null
  } | null
  daysInStatus: number
  pmName: string | null
}

interface ScheduleGroup {
  date: string | null
  dateLabel: string
  jobCount: number
  jobs: ScheduleJob[]
}

interface CapacityMetrics {
  avgJobsPerDay: number
  currentWIP: number
  backlog: number
  pipelineReady: number
  avgDaysInStatus: {
    created_to_readiness: number
    readiness_to_materials: number
    materials_to_production: number
    production_to_staged: number
  }
  bottleneckStatus: {
    status: string
    count: number
  }
}

interface WeeklyLoad {
  week: number
  startDate: string
  endDate: string
  jobCount: number
  capacity: number
  utilization: number
}

interface StatusPipeline {
  status: string
  count: number
  avgDays: number
}

interface ScheduleResponse {
  schedule: ScheduleGroup[]
  capacity: CapacityMetrics
  weeklyLoad: WeeklyLoad[]
  statusPipeline: StatusPipeline[]
  timestamp: string
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/manufacturing-command/schedule
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth check via headers
    const staffId = request.headers.get('x-staff-id')
    const staffRole = request.headers.get('x-staff-role')
    if (!staffId || !staffRole) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all active jobs for schedule view
    const jobsData: Array<{
      id: string
      jobNumber: string
      builderName: string
      community: string | null
      lotBlock: string | null
      scheduledDate: Date | null
      status: string
      createdAt: Date
      updatedAt: Date
      assignedPMId: string | null
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        id, jobNumber, builderName, community, lotBlock,
        "scheduledDate", status, "createdAt", "updatedAt", "assignedPMId"
      FROM "Job"
      WHERE status IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED')
      ORDER BY "scheduledDate" ASC, "createdAt" ASC
    `)

    // Fetch material pick progress for each job
    const pickProgress: Array<{
      jobId: string
      total: number
      completed: number
      short: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        "jobId",
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN status::text = 'PICKED' THEN 1 ELSE 0 END), 0)::int AS completed,
        COALESCE(SUM(CASE WHEN status::text = 'SHORT' THEN 1 ELSE 0 END), 0)::int AS short
      FROM "MaterialPick"
      GROUP BY "jobId"
    `)

    const pickMap = new Map(pickProgress.map((p: any) => [p.jobId, p]))

    // Fetch latest QC results for each job
    const qcResults: Array<{
      jobId: string | null
      result: string
      createdAt: Date
    }> = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON ("jobId") "jobId", result, "createdAt"
      FROM "QualityCheck"
      WHERE "jobId" IS NOT NULL
      ORDER BY "jobId", "createdAt" DESC
    `)

    const qcMap = new Map(
      qcResults.map((q: any) => [
        q.jobId,
        {
          result: q.result,
          checkDate: q.createdAt.toISOString(),
        },
      ])
    )

    // Fetch PM names
    const staffData: Array<{
      id: string
      firstName: string
      lastName: string
    }> = await prisma.$queryRawUnsafe(`
      SELECT id, "firstName", "lastName"
      FROM "Staff"
      WHERE role::text = 'PROJECT_MANAGER'
    `)

    const pmMap = new Map(staffData.map((s: any) => [s.id, `${s.firstName} ${s.lastName}`]))

    // Fetch job status transitions for time calculations
    const statusTimings: Array<{
      jobId: string
      status: string
      createdAt: Date
    }> = await prisma.$queryRawUnsafe(`
      SELECT "jobId", status, "createdAt"
      FROM "Job"
      WHERE status IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED')
      ORDER BY "jobId", "createdAt" ASC
    `)

    const statusMap = new Map(statusTimings.map((s: any) => [s.jobId, s]))

    // Build schedule jobs with enriched data
    const scheduleJobs: ScheduleJob[] = jobsData.map((job: any) => {
      const picks = pickMap.get(job.id) || { total: 0, completed: 0, short: 0 }
      const qc = qcMap.get(job.id) || null
      const pmId = job.assignedPMId
      const pmName = pmId ? pmMap.get(pmId) || null : null

      // Calculate days in current status
      const jobCreated = statusMap.get(job.id)
      const daysInStatus = jobCreated
        ? Math.floor((Date.now() - new Date(jobCreated.createdAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0

      return {
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        community: job.community || 'N/A',
        lotBlock: job.lotBlock,
        scheduledDate: job.scheduledDate ? job.scheduledDate.toISOString().split('T')[0] : null,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        pickProgress: picks,
        qcStatus: qc,
        daysInStatus,
        pmName,
      }
    })

    // Group by scheduled date (next 30 days)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const thirtyDaysFromNow = new Date(today)
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    const groupMap = new Map<string | null, ScheduleJob[]>()
    scheduleJobs.forEach((job: ScheduleJob) => {
      const key = job.scheduledDate
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
      }
      groupMap.get(key)!.push(job)
    })

    const schedule: ScheduleGroup[] = Array.from(groupMap.entries())
      .map(([date, jobs]) => {
        let dateLabel = 'Unscheduled'
        if (date) {
          const d = new Date(date + 'T00:00:00')
          const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
          const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          dateLabel = `${dayName} ${monthDay}`
        }
        return {
          date,
          dateLabel,
          jobCount: jobs.length,
          jobs,
        }
      })
      .sort((a: ScheduleGroup, b: ScheduleGroup) => {
        if (!a.date) return 1
        if (!b.date) return -1
        return new Date(a.date).getTime() - new Date(b.date).getTime()
      })

    // Capacity metrics - last 30 days completed
    const completedLast30: Array<{ count: number }> = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "Job"
      WHERE status = 'STAGED'
        AND "updatedAt" >= NOW() - INTERVAL '30 days'
    `)

    const avgJobsPerDay = Math.round((completedLast30[0]?.count || 0) / 30)

    // Current WIP
    const wipCount: Array<{ count: number }> = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "Job"
      WHERE status = 'IN_PRODUCTION'
    `)

    const currentWIP = wipCount[0]?.count || 0

    // Backlog
    const backlogCount: Array<{ count: number }> = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "Job"
      WHERE status IN ('CREATED', 'READINESS_CHECK')
    `)

    const backlog = backlogCount[0]?.count || 0

    // Pipeline ready
    const pipelineCount: Array<{ count: number }> = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "Job"
      WHERE status = 'MATERIALS_LOCKED'
    `)

    const pipelineReady = pipelineCount[0]?.count || 0

    // Average days in each status
    const avgDaysData: Array<{
      fromStatus: string
      toStatus: string
      avgDays: number
    }> = await prisma.$queryRawUnsafe(`
      WITH job_timings AS (
        SELECT
          j1."jobId", j1.status AS from_status,
          LAG(j1.status) OVER (PARTITION BY j1."jobId" ORDER BY j1."createdAt") AS to_status,
          EXTRACT(EPOCH FROM (j1."createdAt" - LAG(j1."createdAt") OVER (PARTITION BY j1."jobId" ORDER BY j1."createdAt"))) / 86400 AS days_diff
        FROM "Job" j1
        WHERE j1.status IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED')
      )
      SELECT
        from_status, to_status,
        ROUND(AVG(NULLIF(days_diff, 0))::numeric, 1)::float AS "avgDays"
      FROM job_timings
      WHERE to_status IS NOT NULL AND days_diff > 0
      GROUP BY from_status, to_status
    `)

    const avgDaysMap: any = {}
    avgDaysData.forEach((row: any) => {
      const key = `${row.toStatus}_to_${row.fromStatus}`.toLowerCase().replace(/_check/, '')
      avgDaysMap[key] = row.avgDays
    })

    // Bottleneck analysis
    const statusCounts: Array<{
      status: string
      count: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT status, COUNT(*)::int AS count
      FROM "Job"
      WHERE status IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED')
      GROUP BY status
      ORDER BY count DESC
      LIMIT 1
    `)

    const bottleneck = statusCounts[0] || { status: 'CREATED', count: 0 }

    // Weekly load for next 4 weeks
    const weeklyLoadData: Array<{
      weekNum: number
      jobCount: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        EXTRACT(WEEK FROM "scheduledDate")::int AS "weekNum",
        COUNT(*)::int AS "jobCount"
      FROM "Job"
      WHERE "scheduledDate" >= NOW()
        AND "scheduledDate" <= NOW() + INTERVAL '28 days'
        AND status IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED')
      GROUP BY EXTRACT(WEEK FROM "scheduledDate")
      ORDER BY "weekNum" ASC
    `)

    const weeklyLoad: WeeklyLoad[] = Array.from({ length: 4 }).map((_, i: number) => {
      const startDate = new Date(today)
      startDate.setDate(startDate.getDate() + i * 7)
      const endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() + 6)

      const weekData = weeklyLoadData.find(
        (w: any) =>
          w.weekNum ===
          parseInt(
            startDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })
          )
      )

      const jobCount = weekData?.jobCount || 0
      const capacity = avgJobsPerDay * 7
      const utilization = capacity > 0 ? Math.round((jobCount / capacity) * 100) : 0

      return {
        week: i + 1,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        jobCount,
        capacity,
        utilization,
      }
    })

    // Status pipeline
    const pipelineData: Array<{
      status: string
      count: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT status, COUNT(*)::int AS count
      FROM "Job"
      WHERE status IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED')
      GROUP BY status
      ORDER BY CASE status
        WHEN 'CREATED' THEN 1
        WHEN 'READINESS_CHECK' THEN 2
        WHEN 'MATERIALS_LOCKED' THEN 3
        WHEN 'IN_PRODUCTION' THEN 4
        WHEN 'STAGED' THEN 5
        ELSE 6
      END
    `)

    const statusPipeline: StatusPipeline[] = pipelineData.map((p: any) => ({
      status: p.status,
      count: p.count,
      avgDays: 0, // Will be populated from avgDaysMap if available
    }))

    const capacity: CapacityMetrics = {
      avgJobsPerDay,
      currentWIP,
      backlog,
      pipelineReady,
      avgDaysInStatus: {
        created_to_readiness:
          parseFloat(avgDaysMap['readiness_check_to_created']) || 0,
        readiness_to_materials:
          parseFloat(avgDaysMap['materials_locked_to_readiness_check']) || 0,
        materials_to_production:
          parseFloat(avgDaysMap['in_production_to_materials_locked']) || 0,
        production_to_staged:
          parseFloat(avgDaysMap['staged_to_in_production']) || 0,
      },
      bottleneckStatus: {
        status: bottleneck.status,
        count: bottleneck.count,
      },
    }

    const response: ScheduleResponse = {
      schedule,
      capacity,
      weeklyLoad,
      statusPipeline,
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error fetching manufacturing schedule:', error)
    return NextResponse.json(
      { error: 'Failed to load schedule data', details: String((error as any)?.message || error) },
      { status: 500 }
    )
  }
}
