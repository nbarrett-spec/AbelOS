export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { parseRoles } from '@/lib/permissions'

// ──────────────────────────────────────────────────────────────────────────
// PM MATERIAL STATUS DASHBOARD — GET
// ──────────────────────────────────────────────────────────────────────────
// Returns the PM's active jobs with material allocation status, shortfalls,
// and BoM detail inline (dashboard is a daily tool — avoid extra click).
//
// Query params:
//   ?pmId=<staffId>            Target PM (default = session staff)
//   ?dateRange=7|30|all        Horizon for scheduledDate filter (default all)
//   ?status=red|amber|green|all  Material health filter (default all)
//
// Auth:
//   - PROJECT_MANAGER → can only view own jobs (pmId MUST = session staffId)
//   - ADMIN | MANAGER → can view any PM via pmId
// ──────────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = [
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

type MaterialStatus = 'GREEN' | 'AMBER' | 'RED' | 'NO_BOM'

interface BomLine {
  productId: string
  sku: string
  name: string
  required: number
  allocated: number
  onHand: number
  available: number // onHand - committed
  inboundQty: number
  inboundDate: string | null
  shortfall: number // required - (allocated + inbound) — capped at 0
  status: MaterialStatus
  critical: boolean
}

interface JobSummary {
  id: string
  jobNumber: string
  jobAddress: string | null
  community: string | null
  builderName: string
  status: string
  scheduledDate: string | null
  daysToDelivery: number | null
  orderId: string | null
  assignedPMId: string | null
  materialStatus: MaterialStatus
  totalSkus: number
  shortSkus: number
  criticalSkus: number
  summary: string
  bom: BomLine[]
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const sessionStaffId = request.headers.get('x-staff-id') || ''
  const staffRole = request.headers.get('x-staff-role') || ''
  const staffRolesStr = request.headers.get('x-staff-roles') || staffRole
  const allRoles = parseRoles(staffRolesStr)
  const isPrivileged = allRoles.includes('ADMIN') || allRoles.includes('MANAGER')

  const url = request.nextUrl
  const pmIdParam = url.searchParams.get('pmId') || ''
  const dateRange = (url.searchParams.get('dateRange') || 'all').toLowerCase()
  const statusFilter = (url.searchParams.get('status') || 'all').toLowerCase()

  // Resolve target PM. If no pmId provided, default to session staff.
  const targetPmId = pmIdParam || sessionStaffId

  // Authorization: PROJECT_MANAGER can only view own jobs.
  if (!isPrivileged && targetPmId !== sessionStaffId) {
    return NextResponse.json(
      { error: 'Project Managers can only view their own jobs' },
      { status: 403 }
    )
  }

  try {
    // Build scheduledDate horizon clause
    let horizonClause = ''
    if (dateRange === '7') {
      horizonClause = ` AND j."scheduledDate" <= NOW() + INTERVAL '7 days'`
    } else if (dateRange === '30') {
      horizonClause = ` AND j."scheduledDate" <= NOW() + INTERVAL '30 days'`
    }
    // dateRange === 'all' → no horizon clause

    // ── Single CTE: jobs + order items + BOM expand + inventory + inbound POs ──
    const rows = await prisma.$queryRawUnsafe<Array<{
      jobId: string
      jobNumber: string
      jobAddress: string | null
      community: string | null
      builderName: string
      jobStatus: string
      scheduledDate: Date | null
      orderId: string | null
      assignedPMId: string | null
      productId: string | null
      sku: string | null
      productName: string | null
      required: number | null
      onHand: number | null
      committed: number | null
      inboundQty: number | null
      inboundDate: Date | null
    }>>(
      `
      WITH RECURSIVE
      target_jobs AS (
        SELECT
          j."id"            AS job_id,
          j."jobNumber"     AS job_number,
          j."jobAddress"    AS job_address,
          j."community"     AS community,
          j."builderName"   AS builder_name,
          j."status"::text  AS job_status,
          j."scheduledDate" AS scheduled_date,
          j."orderId"       AS order_id,
          j."assignedPMId"  AS assigned_pm_id
        FROM "Job" j
        WHERE j."assignedPMId" = $1
          AND j."status"::text = ANY($2::text[])
          ${horizonClause}
      ),
      job_top_demand AS (
        SELECT
          tj.job_id,
          oi."productId"         AS parent_product_id,
          oi."quantity"::float   AS parent_qty
        FROM target_jobs tj
        LEFT JOIN "OrderItem" oi ON oi."orderId" = tj.order_id
        WHERE tj.order_id IS NOT NULL
      ),
      bom_expansion AS (
        SELECT
          jtd.job_id,
          jtd.parent_product_id AS product_id,
          jtd.parent_qty        AS qty,
          0 AS depth
        FROM job_top_demand jtd
        WHERE jtd.parent_product_id IS NOT NULL

        UNION ALL

        SELECT
          be.job_id,
          b."componentId" AS product_id,
          be.qty * b."quantity" AS qty,
          be.depth + 1
        FROM bom_expansion be
        JOIN "BomEntry" b ON b."parentId" = be.product_id
        WHERE be.depth < 4
      ),
      has_children AS (
        SELECT DISTINCT "parentId" AS product_id FROM "BomEntry"
      ),
      job_demand AS (
        -- Keep leaves (no BOM children) OR any expanded row (depth > 0).
        -- Aggregate so each (job, product) shows up once.
        SELECT
          be.job_id,
          be.product_id,
          SUM(be.qty)::float AS required
        FROM bom_expansion be
        LEFT JOIN has_children hc ON hc.product_id = be.product_id
        WHERE (hc.product_id IS NULL OR be.depth > 0)
          AND be.product_id IS NOT NULL
        GROUP BY be.job_id, be.product_id
      ),
      inbound_agg AS (
        SELECT
          poi."productId" AS product_id,
          SUM(GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0))::float AS inbound_qty,
          MIN(
            COALESCE(
              po."expectedDate"::date,
              (po."orderedAt"::date + INTERVAL '14 days')::date,
              (CURRENT_DATE + INTERVAL '14 days')::date
            )
          ) AS inbound_date
        FROM "PurchaseOrderItem" poi
        JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
        WHERE po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
          AND poi."productId" IS NOT NULL
          AND (poi."quantity" - COALESCE(poi."receivedQty", 0)) > 0
        GROUP BY poi."productId"
      )
      SELECT
        tj.job_id                                     AS "jobId",
        tj.job_number                                 AS "jobNumber",
        tj.job_address                                AS "jobAddress",
        tj.community                                  AS "community",
        tj.builder_name                               AS "builderName",
        tj.job_status                                 AS "jobStatus",
        tj.scheduled_date                             AS "scheduledDate",
        tj.order_id                                   AS "orderId",
        tj.assigned_pm_id                             AS "assignedPMId",
        jd.product_id                                 AS "productId",
        p."sku"                                       AS "sku",
        p."name"                                      AS "productName",
        jd.required                                   AS "required",
        COALESCE(i."onHand", 0)::int                  AS "onHand",
        COALESCE(i."committed", 0)::int               AS "committed",
        COALESCE(ia.inbound_qty, 0)::float            AS "inboundQty",
        ia.inbound_date                               AS "inboundDate"
      FROM target_jobs tj
      LEFT JOIN job_demand jd ON jd.job_id = tj.job_id
      LEFT JOIN "Product" p   ON p."id" = jd.product_id
      LEFT JOIN "InventoryItem" i ON i."productId" = jd.product_id
      LEFT JOIN inbound_agg ia  ON ia.product_id = jd.product_id
      ORDER BY tj.scheduled_date ASC NULLS LAST, tj.job_number ASC
      `,
      targetPmId,
      ACTIVE_STATUSES as unknown as string[]
    )

    // ── Group rows → per-job structure + compute material status ──
    const jobMap = new Map<string, JobSummary>()
    const now = Date.now()
    const MS_PER_DAY = 86400000

    for (const row of rows) {
      let job = jobMap.get(row.jobId)
      if (!job) {
        const scheduled = row.scheduledDate ? new Date(row.scheduledDate) : null
        const daysToDelivery = scheduled
          ? Math.floor((scheduled.getTime() - now) / MS_PER_DAY)
          : null
        job = {
          id: row.jobId,
          jobNumber: row.jobNumber,
          jobAddress: row.jobAddress,
          community: row.community,
          builderName: row.builderName,
          status: row.jobStatus,
          scheduledDate: scheduled ? scheduled.toISOString() : null,
          daysToDelivery,
          orderId: row.orderId,
          assignedPMId: row.assignedPMId,
          materialStatus: 'NO_BOM',
          totalSkus: 0,
          shortSkus: 0,
          criticalSkus: 0,
          summary: '',
          bom: [],
        }
        jobMap.set(row.jobId, job)
      }

      // Skip null product rows (happens when job has no orderId or empty BOM)
      if (!row.productId) continue

      const required = Number(row.required || 0)
      const onHand = Number(row.onHand || 0)
      const committed = Number(row.committed || 0)
      const available = Math.max(onHand - committed, 0)
      const inboundQty = Number(row.inboundQty || 0)

      // Allocation heuristic: what's currently set aside against this job.
      // We don't have a per-job Allocation table yet (sibling agent), so we
      // approximate: allocated = min(required, available).
      const allocated = Math.min(required, available)

      // Shortfall: unmet demand after considering allocation AND in-flight POs.
      const netCoverage = allocated + inboundQty
      const shortfall = Math.max(required - netCoverage, 0)

      // Per-line status
      let lineStatus: MaterialStatus = 'GREEN'
      if (allocated >= required) {
        lineStatus = 'GREEN'
      } else if (netCoverage >= required) {
        lineStatus = 'AMBER' // PO covers the gap
      } else {
        lineStatus = 'RED'
      }

      // Critical flag: RED AND delivery is within 7 days
      const critical =
        lineStatus === 'RED' &&
        job.daysToDelivery !== null &&
        job.daysToDelivery <= 7

      job.bom.push({
        productId: row.productId,
        sku: row.sku || '',
        name: row.productName || '',
        required,
        allocated,
        onHand,
        available,
        inboundQty,
        inboundDate: row.inboundDate ? new Date(row.inboundDate).toISOString() : null,
        shortfall,
        status: lineStatus,
        critical,
      })
    }

    // Roll up per-job status from BOM lines
    const jobs: JobSummary[] = []
    for (const job of jobMap.values()) {
      if (job.bom.length === 0) {
        job.materialStatus = 'NO_BOM'
        job.summary = 'No BoM — check order mapping'
        jobs.push(job)
        continue
      }

      const totalSkus = job.bom.length
      const redLines = job.bom.filter(b => b.status === 'RED')
      const amberLines = job.bom.filter(b => b.status === 'AMBER')
      const criticalLines = job.bom.filter(b => b.critical)

      job.totalSkus = totalSkus
      job.shortSkus = redLines.length + amberLines.length
      job.criticalSkus = criticalLines.length

      if (redLines.length > 0) {
        job.materialStatus = 'RED'
        job.summary = `${redLines.length + amberLines.length} of ${totalSkus} SKUs short — ${criticalLines.length} critical`
      } else if (amberLines.length > 0) {
        job.materialStatus = 'AMBER'
        job.summary = `${amberLines.length} of ${totalSkus} SKUs covered by incoming PO`
      } else {
        job.materialStatus = 'GREEN'
        job.summary = 'All allocated'
      }

      // Sort BOM within the job: critical first, then shortfall desc
      job.bom.sort((a, b) => {
        if (a.critical !== b.critical) return a.critical ? -1 : 1
        if (a.status !== b.status) {
          const order: Record<MaterialStatus, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_BOM: 3 }
          return order[a.status] - order[b.status]
        }
        return b.shortfall - a.shortfall
      })

      jobs.push(job)
    }

    // ── Apply status filter ──
    let filteredJobs = jobs
    if (statusFilter === 'red') {
      filteredJobs = jobs.filter(j => j.materialStatus === 'RED')
    } else if (statusFilter === 'amber') {
      filteredJobs = jobs.filter(j => j.materialStatus === 'AMBER')
    } else if (statusFilter === 'green') {
      filteredJobs = jobs.filter(j => j.materialStatus === 'GREEN')
    }

    // Sort globally by scheduledDate ASC (already from SQL, but re-apply for safety)
    filteredJobs.sort((a, b) => {
      if (!a.scheduledDate && !b.scheduledDate) return 0
      if (!a.scheduledDate) return 1
      if (!b.scheduledDate) return -1
      return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    })

    // Counts for KPI cards (based on unfiltered set — the filter is a view filter)
    const counts = {
      active: jobs.length,
      green: jobs.filter(j => j.materialStatus === 'GREEN').length,
      amber: jobs.filter(j => j.materialStatus === 'AMBER').length,
      red: jobs.filter(j => j.materialStatus === 'RED').length,
      noBom: jobs.filter(j => j.materialStatus === 'NO_BOM').length,
    }

    // Builder list for the filter dropdown
    const builders = Array.from(new Set(jobs.map(j => j.builderName))).sort()

    // If the caller is privileged, hand back the PM roster so the UI picker
    // doesn't need a separate round-trip.
    let pmRoster: Array<{ id: string; firstName: string; lastName: string; email: string }> = []
    if (isPrivileged) {
      pmRoster = await prisma.$queryRawUnsafe<typeof pmRoster>(
        `
        SELECT s."id", s."firstName", s."lastName", s."email"
        FROM "Staff" s
        WHERE s."active" = true
          AND (s."role"::text = 'PROJECT_MANAGER'
               OR COALESCE(s."roles", '') LIKE '%PROJECT_MANAGER%')
        ORDER BY s."firstName" ASC, s."lastName" ASC
        `
      )
    }

    return safeJson({
      pmId: targetPmId,
      sessionStaffId,
      isPrivileged,
      counts,
      builders,
      jobs: filteredJobs,
      pmRoster,
      filters: { dateRange, status: statusFilter },
      asOf: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[pm/material] GET failed', err)
    return NextResponse.json(
      { error: 'Failed to load material status', detail: String(err?.message || err) },
      { status: 500 }
    )
  }
}
