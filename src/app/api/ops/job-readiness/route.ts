export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { computeJobMaterialStatus, type MaterialStatusLine } from '@/lib/mrp/atp'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/job-readiness
//
// Job Readiness Board: materials status for upcoming jobs within a look-ahead
// window, with ATP computation per job.
//
// Query params:
//   ?days=14        (look-ahead window in days; default 14)
//   ?pmId=xxx       (filter by assigned PM id)
//   ?status=RED     (filter by overall material status: RED, AMBER, GREEN, UNKNOWN)
//
// For each job, returns:
//   { jobId, jobNumber, builderName, community, lot, address, scheduledDate,
//     assignedPm, overallStatus, lines: [{ sku, productName, required,
//     allocated, available, incoming, shortfall, status, recommendation }],
//     actionNeeded }
//
// Sorted by: RED > AMBER > GREEN, then by scheduledDate ASC.
//
// NOTE: This is expensive (one ATP CTE per job). We cache aggressively and
// cap the result set to 50 jobs max to avoid query bloat.
// ──────────────────────────────────────────────────────────────────────────

type MaterialStatus = 'RED' | 'AMBER' | 'GREEN' | 'UNKNOWN'

interface MaterialLine {
  sku: string | null
  productName: string | null
  required: number
  allocated: number
  available: number
  incoming: number
  shortfall: number
  status: 'RED' | 'AMBER' | 'GREEN'
  recommendation: string
}

interface JobReadinessCard {
  jobId: string
  jobNumber: string
  builderName: string
  community: string | null
  lot: string | null
  address: string | null
  scheduledDate: string // ISO date
  daysUntilScheduled: number
  assignedPmId: string | null
  assignedPmName: string | null
  overallStatus: MaterialStatus
  lines: MaterialLine[]
  actionNeeded: string
}

interface JobReadinessResponse {
  asOf: string
  lookAheadDays: number
  windowStart: string
  windowEnd: string
  totalJobsInWindow: number
  totalJobsReturned: number
  filters: {
    pmId?: string
    status?: MaterialStatus
  }
  counts: {
    red: number
    amber: number
    green: number
    unknown: number
  }
  jobs: JobReadinessCard[]
}

const ACTIVE_JOB_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'INSTALLING',
  'PUNCH_LIST',
] as const

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const daysRaw = searchParams.get('days') || '14'
    const lookaheadDays = Math.max(1, Math.min(90, parseInt(daysRaw, 10) || 14))
    const pmIdFilter = searchParams.get('pmId') || null
    const statusFilter = (searchParams.get('status')?.toUpperCase() as MaterialStatus | null) || null

    const now = new Date()
    const windowStart = new Date(now)
    const windowEnd = new Date(now.getTime() + lookaheadDays * 86400000)

    // ── 1. Fetch jobs in the window, capped at 50 (expensive ATP per job) ────
    const jobRows = await prisma.job.findMany({
      where: {
        scheduledDate: {
          gte: windowStart,
          lte: windowEnd,
        },
        status: { in: ACTIVE_JOB_STATUSES as unknown as any[] },
        ...(pmIdFilter && { assignedPMId: pmIdFilter }),
      },
      select: {
        id: true,
        jobNumber: true,
        builderName: true,
        community: true,
        lotBlock: true,
        jobAddress: true,
        scheduledDate: true,
        assignedPMId: true,
      },
      orderBy: { scheduledDate: 'asc' },
      take: 50,
    })

    const totalInWindow = await prisma.job.count({
      where: {
        scheduledDate: {
          gte: windowStart,
          lte: windowEnd,
        },
        status: { in: ACTIVE_JOB_STATUSES as unknown as any[] },
        ...(pmIdFilter && { assignedPMId: pmIdFilter }),
      },
    })

    // ── 2. Compute ATP for each job (parallel batch) ────────────────────────
    const materialStatusMap = new Map<string, Awaited<ReturnType<typeof computeJobMaterialStatus>>>()

    // Compute in parallel; Prisma connections are pooled, so this is safe
    await Promise.all(
      jobRows.map(async (job) => {
        try {
          const status = await computeJobMaterialStatus(job.id)
          materialStatusMap.set(job.id, status)
        } catch (err: any) {
          // Fallback to UNKNOWN if ATP fails
          console.error(`ATP compute failed for job ${job.id}:`, err?.message)
          materialStatusMap.set(job.id, {
            jobId: job.id,
            jobNumber: job.jobNumber,
            builderName: job.builderName,
            community: job.community ?? null,
            scheduledDate: job.scheduledDate,
            overallStatus: 'UNKNOWN',
            lines: [],
            totalShortageValue: 0,
          })
        }
      })
    )

    // ── 3. Transform to card format and sort ────────────────────────────────
    const cards = jobRows
      .map((job) => {
        const material = materialStatusMap.get(job.id)
        if (!material) return null

        const pmName: string | null = null // PM name resolved on frontend if needed

        const daysUntil = Math.ceil(
          (new Date(job.scheduledDate!).getTime() - now.getTime()) / 86400000
        )

        // Build material lines: include all lines, color-coded by status
        const lines: MaterialLine[] = material.lines.map((line) => ({
          sku: line.sku,
          productName: line.productName,
          required: line.required,
          allocated: line.allocated,
          available: line.available,
          incoming: line.totalIncomingBeforeDueDate,
          shortfall: Math.max(0, line.required - line.allocated - line.projectedATP),
          status: line.status,
          recommendation: line.recommendation,
        }))

        // Action needed: summarize for RED lines
        const redLines = lines.filter((l) => l.status === 'RED')
        let actionNeeded = ''
        if (redLines.length > 0) {
          actionNeeded = `${redLines.length} material shortfall${redLines.length > 1 ? 's' : ''} — Create PO / Expedite`
        } else if (material.lines.some((l) => l.status === 'AMBER')) {
          actionNeeded = 'Monitor incoming POs'
        } else if (material.lines.length === 0) {
          actionNeeded = 'No BoM data — Check order'
        }

        return {
          jobId: job.id,
          jobNumber: job.jobNumber,
          builderName: job.builderName,
          community: job.community ?? null,
          lot: job.lotBlock,
          address: job.jobAddress,
          scheduledDate: job.scheduledDate!.toISOString().split('T')[0],
          daysUntilScheduled: daysUntil,
          assignedPmId: job.assignedPMId,
          assignedPmName: pmName,
          overallStatus: material.overallStatus,
          lines,
          actionNeeded,
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null) as JobReadinessCard[]

    // Apply status filter if provided
    let filtered = cards
    if (statusFilter) {
      filtered = cards.filter((c) => c.overallStatus === statusFilter)
    }

    // Sort: RED first, AMBER second, GREEN third, then by scheduledDate
    filtered.sort((a, b) => {
      const statusOrder: Record<MaterialStatus, number> = {
        RED: 0,
        AMBER: 1,
        GREEN: 2,
        UNKNOWN: 3,
      }
      const statusDiff = statusOrder[a.overallStatus] - statusOrder[b.overallStatus]
      if (statusDiff !== 0) return statusDiff
      // Within same status, sort by scheduled date
      return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    })

    // Count statuses in filtered set
    const counts = {
      red: filtered.filter((c) => c.overallStatus === 'RED').length,
      amber: filtered.filter((c) => c.overallStatus === 'AMBER').length,
      green: filtered.filter((c) => c.overallStatus === 'GREEN').length,
      unknown: filtered.filter((c) => c.overallStatus === 'UNKNOWN').length,
    }

    return NextResponse.json({
      asOf: new Date().toISOString(),
      lookAheadDays: lookaheadDays,
      windowStart: windowStart.toISOString().split('T')[0],
      windowEnd: windowEnd.toISOString().split('T')[0],
      totalJobsInWindow: totalInWindow,
      totalJobsReturned: filtered.length,
      filters: {
        ...(pmIdFilter && { pmId: pmIdFilter }),
        ...(statusFilter && { status: statusFilter }),
      },
      counts,
      jobs: filtered,
    } as JobReadinessResponse)
  } catch (error: any) {
    console.error('job-readiness API error:', error)
    return NextResponse.json(
      {
        error: error?.message ?? 'Internal server error',
      },
      { status: 500 }
    )
  }
}
