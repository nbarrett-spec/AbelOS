export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/material-calendar
//
// Returns a list of jobs in [start, end] bucketed by scheduledDate, each
// with a materialStatus (GREEN | AMBER | RED | UNKNOWN) + shortfall rollup.
//
// Status is computed at the "required product" grain:
//   - required(productId, job) = SUM(OrderItem.quantity) for the job's Order,
//     rolled up across any BoM subcomponents (1-level explode; Abel's BoM
//     is shallow — parent product → bucket of trim/hardware components).
//   - allocated(productId, job) = SUM(InventoryAllocation.quantity WHERE
//     jobId = job AND status IN (RESERVED, PICKED)).
//   - shortfall = required - allocated.
//   - GREEN   → every required SKU has shortfall <= 0.
//   - AMBER   → shortfall exists BUT an incoming PO (expectedDate <=
//               scheduledDate, status IN (SENT, CONFIRMED, PARTIAL))
//               covers the gap for every short SKU.
//   - RED     → at least one short SKU has no matching incoming PO by
//               the scheduled date.
//   - UNKNOWN → no InventoryAllocation rows AT ALL for this job
//               (sibling ATP agent may not have populated yet).
//
// Query params:
//   ?start=YYYY-MM-DD   (required)
//   ?end=YYYY-MM-DD     (required)
//   ?pad=<int>          (optional; days to extend the window on each side,
//                         default 0. Page sends 14 to prefetch ±2 weeks
//                         around the visible range so flipping months
//                         feels instant.)
//   ?includeUnscheduled=1 (optional; default 0. Unscheduled jobs aren't
//                         tied to the date window, so pulling them fights
//                         the windowing optimization. Page asks for them
//                         explicitly when it wants the unscheduled section.)
//   ?view=day|week|month (optional; informational only, server returns flat
//                         array, client buckets by day)
//   ?builder=...        (csv of builder name substrings)
//   ?pmId=...           (csv of staff IDs)
//   ?communityId=...    (csv)
//   ?status=...         (csv of materialStatus values to include)
// ──────────────────────────────────────────────────────────────────────────

type MaterialStatus = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN'

// Active job statuses we care about (scheduledDate driven material plan)
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

// Allocation statuses that count as "covered"
const COVERED_ALLOC_STATUSES = ['RESERVED', 'PICKED'] as const

// PO statuses that count as "on the way" (POStatus enum values)
const INCOMING_PO_STATUSES = ['APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED'] as const

interface CalendarJob {
  jobId: string
  jobNumber: string
  jobAddress: string | null
  builderName: string
  communityName: string | null
  assignedPMName: string | null
  assignedPMId: string | null
  scheduledDate: string | null // ISO, null when job is unscheduled
  jobStatus: string
  scopeType: string
  materialStatus: MaterialStatus
  shortfallSummary: {
    shortCount: number     // # of SKUs with shortfall > 0 (any color)
    criticalCount: number  // # of SKUs that are RED (no covering PO)
    amberCount: number     // # of SKUs short but covered by incoming PO
  }
  bwpPoNumber: string | null
  hyphenJobId: string | null
}

interface CalendarResponse {
  asOf: string
  windowStart: string
  windowEnd: string
  view: 'day' | 'week' | 'month'
  counts: {
    total: number
    green: number
    amber: number
    red: number
    unknown: number
  }
  jobs: CalendarJob[]
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const startStr = searchParams.get('start')
    const endStr = searchParams.get('end')
    const padStr = searchParams.get('pad') || '0'
    const includeUnscheduled = searchParams.get('includeUnscheduled') === '1'
    const view = (searchParams.get('view') || 'week') as 'day' | 'week' | 'month'
    const builderCsv = searchParams.get('builder') || ''
    const pmIdCsv = searchParams.get('pmId') || ''
    const communityIdCsv = searchParams.get('communityId') || ''
    const statusCsv = searchParams.get('status') || ''

    if (!startStr || !endStr) {
      return NextResponse.json(
        { error: 'start and end query params required (YYYY-MM-DD)' },
        { status: 400 }
      )
    }
    const windowStart = new Date(startStr)
    const windowEnd = new Date(endStr)
    if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
      return NextResponse.json(
        { error: 'invalid date format' },
        { status: 400 }
      )
    }
    // Cap pad at 60 days so a misconfigured client can't blow the budget.
    const padDays = Math.max(0, Math.min(60, parseInt(padStr, 10) || 0))
    if (padDays > 0) {
      windowStart.setUTCDate(windowStart.getUTCDate() - padDays)
      windowEnd.setUTCDate(windowEnd.getUTCDate() + padDays)
    }
    // Make end inclusive: roll to end-of-day
    windowEnd.setUTCHours(23, 59, 59, 999)

    const builderFilters = builderCsv.split(',').map(s => s.trim()).filter(Boolean)
    const pmIds = pmIdCsv.split(',').map(s => s.trim()).filter(Boolean)
    const communityIds = communityIdCsv.split(',').map(s => s.trim()).filter(Boolean)
    const statusFilter = statusCsv.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) as MaterialStatus[]

    // ── 1. Fetch in-window jobs with minimal joins ────────────────────────
    // NOTE: scheduledDate might be NULL for many jobs. By default we ONLY
    // fetch jobs with scheduledDate in the window — unscheduled jobs are
    // pulled separately and only when the page asks (?includeUnscheduled=1)
    // so the date-range filter does its job on first paint.
    const dateRangeOr = [
      { scheduledDate: { gte: windowStart, lte: windowEnd } as any },
      ...(includeUnscheduled ? [{ scheduledDate: null as any }] : []),
    ]
    const jobs = await prisma.job.findMany({
      where: {
        status: { in: ACTIVE_JOB_STATUSES as unknown as any[] },
        OR: dateRangeOr,
        ...(builderFilters.length > 0 && {
          builderName: { in: builderFilters },
        }),
        ...(pmIds.length > 0 && {
          assignedPMId: { in: pmIds },
        }),
        ...(communityIds.length > 0 && {
          communityId: { in: communityIds },
        }),
      },
      select: {
        id: true,
        jobNumber: true,
        jobAddress: true,
        builderName: true,
        community: true,
        communityId: true,
        assignedPMId: true,
        assignedPM: {
          select: { firstName: true, lastName: true },
        },
        scheduledDate: true,
        status: true,
        scopeType: true,
        bwpPoNumber: true,
        hyphenJobId: true,
        orderId: true,
      },
      orderBy: [{ scheduledDate: 'asc' }],
      // Hard cap as a belt-and-suspenders guard. With pad=14, a calendar
      // month + 4 weeks of buffer caps at ~58 days × ~30 jobs/day worst
      // case. 500 leaves plenty of headroom but fences off pathological
      // queries (e.g. a date range that somehow expanded to a year).
      take: 500,
    })

    if (jobs.length === 0) {
      const emptyResp: CalendarResponse = {
        asOf: new Date().toISOString(),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        view,
        counts: { total: 0, green: 0, amber: 0, red: 0, unknown: 0 },
        jobs: [],
      }
      return NextResponse.json(emptyResp)
    }

    const jobIds = jobs.map(j => j.id)
    const orderIds = jobs.map(j => j.orderId).filter((x): x is string => !!x)

    // ── 2. Aggregate "required per job × product" from OrderItem ──────────
    //
    //    required(job, productId) = SUM of OrderItem.quantity rolled up via
    //    1-level BoM explode. The top-level OrderItem.productId counts as
    //    "required" too — Abel tracks both finished doors AND their
    //    components in inventory, and we need to know if the unit itself
    //    is allocated.
    //
    //    This is intentionally two SQL queries (top-level + exploded) vs
    //    one recursive CTE so we stay on the Prisma query engine (Neon +
    //    pooling friendly) without hand-wrapping a $queryRawUnsafe.
    //
    //    Scale note: typical 30-day window = ~250-400 jobs × ~15 items ≈
    //    3-6k OrderItem rows. Single groupBy finishes in ~30-80ms on Neon.

    const orderItems = orderIds.length > 0
      ? await prisma.orderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: {
            orderId: true,
            productId: true,
            quantity: true,
          },
        })
      : []

    // orderId → jobId (one-to-one in practice via Order.jobs)
    const orderToJob = new Map<string, string>()
    for (const j of jobs) {
      if (j.orderId) orderToJob.set(j.orderId, j.id)
    }

    // Unique top-level product IDs for BoM explode
    const topLevelProductIds = Array.from(
      new Set(orderItems.map(oi => oi.productId).filter((id): id is string => id !== null))
    )

    const bomEntries = topLevelProductIds.length > 0
      ? await prisma.bomEntry.findMany({
          where: { parentId: { in: topLevelProductIds } },
          select: {
            parentId: true,
            componentId: true,
            quantity: true,
          },
        })
      : []

    // parentId → [{componentId, quantity}]
    const bomByParent = new Map<string, Array<{ componentId: string; quantity: number }>>()
    for (const be of bomEntries) {
      let arr = bomByParent.get(be.parentId)
      if (!arr) {
        arr = []
        bomByParent.set(be.parentId, arr)
      }
      arr.push({ componentId: be.componentId, quantity: be.quantity })
    }

    // Required map: jobId → productId → quantity
    const requiredByJob = new Map<string, Map<string, number>>()
    const addReq = (jobId: string, productId: string, qty: number) => {
      let m = requiredByJob.get(jobId)
      if (!m) {
        m = new Map()
        requiredByJob.set(jobId, m)
      }
      m.set(productId, (m.get(productId) ?? 0) + qty)
    }

    for (const oi of orderItems) {
      const jobId = orderToJob.get(oi.orderId)
      if (!jobId || !oi.productId) continue
      // Top-level required
      addReq(jobId, oi.productId, oi.quantity)
      // Explode BoM
      const kids = bomByParent.get(oi.productId)
      if (kids) {
        for (const k of kids) {
          addReq(jobId, k.componentId, k.quantity * oi.quantity)
        }
      }
    }

    // ── 3. Pull allocations for these jobs in one shot ────────────────────
    const allocations = await prisma.inventoryAllocation.findMany({
      where: {
        jobId: { in: jobIds },
        status: { in: COVERED_ALLOC_STATUSES as unknown as any[] },
      },
      select: {
        jobId: true,
        productId: true,
        quantity: true,
      },
    })

    // Also count ALL allocation rows per job (any status) so we can decide
    // UNKNOWN vs "really short". If a job has zero allocation rows total,
    // we mark UNKNOWN regardless of shortfall — the sibling agent hasn't
    // touched it yet.
    const allAllocCounts = await prisma.inventoryAllocation.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds } },
      _count: { _all: true },
    })
    const allocJobIds = new Set(allAllocCounts.map(a => a.jobId).filter((x): x is string => !!x))

    // Allocated map: jobId → productId → quantity
    const allocatedByJob = new Map<string, Map<string, number>>()
    for (const a of allocations) {
      if (!a.jobId || !a.productId) continue
      let m = allocatedByJob.get(a.jobId)
      if (!m) {
        m = new Map()
        allocatedByJob.set(a.jobId, m)
      }
      m.set(a.productId, (m.get(a.productId) ?? 0) + a.quantity)
    }

    // ── 4. Incoming POs for every relevant productId ──────────────────────
    // We pull one aggregated set and filter per-job by expectedDate.
    const allRequiredProducts = new Set<string>()
    for (const m of requiredByJob.values()) {
      for (const pid of m.keys()) allRequiredProducts.add(pid)
    }

    const incomingPoItems = allRequiredProducts.size > 0
      ? await prisma.purchaseOrderItem.findMany({
          where: {
            productId: { in: Array.from(allRequiredProducts) },
            purchaseOrder: {
              status: { in: INCOMING_PO_STATUSES as unknown as any[] },
              expectedDate: { not: null, lte: windowEnd },
            },
          },
          select: {
            productId: true,
            quantity: true,
            receivedQty: true,
            purchaseOrder: {
              select: {
                poNumber: true,
                expectedDate: true,
                vendor: { select: { name: true } },
              },
            },
          },
        })
      : []

    // productId → sorted list of incoming { expectedDate, remainingQty, poNumber, vendor }
    type IncomingLine = {
      productId: string
      expectedDate: Date
      remainingQty: number
      poNumber: string
      vendor: string
    }
    const incomingByProduct = new Map<string, IncomingLine[]>()
    for (const it of incomingPoItems) {
      if (!it.productId || !it.purchaseOrder?.expectedDate) continue
      const remaining = Math.max(0, it.quantity - it.receivedQty)
      if (remaining <= 0) continue
      const line: IncomingLine = {
        productId: it.productId,
        expectedDate: it.purchaseOrder.expectedDate,
        remainingQty: remaining,
        poNumber: it.purchaseOrder.poNumber,
        vendor: it.purchaseOrder.vendor?.name ?? 'Unknown',
      }
      let arr = incomingByProduct.get(it.productId)
      if (!arr) {
        arr = []
        incomingByProduct.set(it.productId, arr)
      }
      arr.push(line)
    }
    for (const arr of incomingByProduct.values()) {
      arr.sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime())
    }

    // ── 5. Compute status per job ─────────────────────────────────────────
    const out: CalendarJob[] = jobs.map(j => {
      const required = requiredByJob.get(j.id) ?? new Map<string, number>()
      const allocated = allocatedByJob.get(j.id) ?? new Map<string, number>()
      const hasAnyAlloc = allocJobIds.has(j.id)

      let shortCount = 0
      let criticalCount = 0
      let amberCount = 0

      for (const [pid, req] of required.entries()) {
        if (req <= 0) continue
        const got = allocated.get(pid) ?? 0
        const shortfall = req - got
        if (shortfall <= 0) continue
        shortCount++
        // Is there a PO arriving before scheduledDate that covers it?
        const incoming = incomingByProduct.get(pid) ?? []
        let coverQty = 0
        const scheduled = j.scheduledDate ?? windowEnd
        for (const inc of incoming) {
          if (inc.expectedDate.getTime() <= scheduled.getTime()) {
            coverQty += inc.remainingQty
            if (coverQty >= shortfall) break
          }
        }
        if (coverQty >= shortfall) {
          amberCount++
        } else {
          criticalCount++
        }
      }

      let materialStatus: MaterialStatus
      if (!hasAnyAlloc && required.size === 0) {
        // No BoM-required rows AND no allocations — we know nothing.
        materialStatus = 'UNKNOWN'
      } else if (!hasAnyAlloc) {
        // Required items exist but sibling ATP agent hasn't filled
        // InventoryAllocation yet. Treat as UNKNOWN, not RED — don't
        // panic the calendar during the race.
        materialStatus = 'UNKNOWN'
      } else if (criticalCount > 0) {
        materialStatus = 'RED'
      } else if (amberCount > 0) {
        materialStatus = 'AMBER'
      } else {
        materialStatus = 'GREEN'
      }

      const pmName = j.assignedPM
        ? `${j.assignedPM.firstName} ${j.assignedPM.lastName}`.trim()
        : null

      return {
        jobId: j.id,
        jobNumber: j.jobNumber,
        jobAddress: j.jobAddress,
        builderName: j.builderName,
        communityName: j.community,
        assignedPMName: pmName,
        assignedPMId: j.assignedPMId,
        scheduledDate: j.scheduledDate ? j.scheduledDate.toISOString() : null,
        jobStatus: String(j.status),
        scopeType: String(j.scopeType),
        materialStatus,
        shortfallSummary: { shortCount, criticalCount, amberCount },
        bwpPoNumber: j.bwpPoNumber,
        hyphenJobId: j.hyphenJobId,
      }
    })

    // Apply post-compute status filter
    const filtered = statusFilter.length > 0
      ? out.filter(j => statusFilter.includes(j.materialStatus))
      : out

    const counts = {
      total: filtered.length,
      green: filtered.filter(j => j.materialStatus === 'GREEN').length,
      amber: filtered.filter(j => j.materialStatus === 'AMBER').length,
      red: filtered.filter(j => j.materialStatus === 'RED').length,
      unknown: filtered.filter(j => j.materialStatus === 'UNKNOWN').length,
    }

    const resp: CalendarResponse = {
      asOf: new Date().toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      view,
      counts,
      jobs: filtered,
    }
    return NextResponse.json(resp)
  } catch (err: any) {
    console.error('[material-calendar] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to build material calendar' },
      { status: 500 }
    )
  }
}
