/**
 * Available-To-Promise (ATP) shortage forecast.
 *
 * Given a Job (or all active Jobs), figure out what BoM-required products
 * are at risk of short-shipping relative to Job.scheduledDate.
 *
 *   required       = BoM(expansion) × OrderItem.qty  for every leaf component
 *   allocated      = SUM(InventoryAllocation.quantity) on this Job, status RESERVED
 *   committedOther = SUM(InventoryAllocation.quantity) on OTHER jobs
 *   available      = InventoryItem.onHand - committedOther
 *   incoming       = Open PurchaseOrder lines where expectedDate <= Job.scheduledDate
 *   projectedATP   = available + incoming
 *   shortfall      = max(0, required - allocated - projectedATP)
 *
 * Status flags:
 *   GREEN   — required ≤ allocated (already reserved, we're safe)
 *   AMBER   — shortfall > 0 BUT projectedATP ≥ shortfall (incoming PO will cover)
 *   RED     — projectedATP < shortfall (true stockout risk)
 *
 * Recommendation:
 *   NEW_PO     — RED line, need to fire a PO against the preferred vendor
 *   EXPEDITE   — AMBER line where the incoming PO expectedDate is within 3 days
 *                of the Job's scheduledDate (too tight, we need to push the vendor)
 *   SUBSTITUTE — placeholder; future work, only emitted when UpgradePath exists
 *                (for now: we never emit this, stays NONE)
 *   NONE       — GREEN
 *
 * Performance:
 * One big CTE does the heavy lifting for `computeAllActiveJobsMaterialStatus()`;
 * single-job reads call the same CTE with a jobId filter.
 *
 * Defensive: InventoryAllocation may be empty (sibling agent populates it) —
 * in that case `allocated = 0` for every line, which just means everything looks
 * like a shortage. That's the correct fallback — we'd rather overflag early.
 */

import { prisma } from '@/lib/prisma'

// ─── Types ──────────────────────────────────────────────────────────────

export type MaterialStatus = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN'
export type LineStatus = 'GREEN' | 'AMBER' | 'RED'
export type Recommendation = 'NONE' | 'EXPEDITE' | 'NEW_PO' | 'SUBSTITUTE'

export interface IncomingPO {
  poNumber: string
  vendor: string
  expectedDate: Date
  qty: number
}

export interface MaterialStatusLine {
  productId: string
  sku: string
  productName: string
  required: number
  allocated: number
  onHand: number
  committedToOthers: number
  available: number
  incomingBeforeDueDate: IncomingPO[]
  totalIncomingBeforeDueDate: number
  projectedATP: number
  shortfall: number
  status: LineStatus
  recommendation: Recommendation
  estShortageValue: number // unit cost × shortfall
  preferredVendorId: string | null
  preferredVendorName: string | null
  preferredVendorLeadDays: number | null
  preferredVendorCost: number | null
  reorderQty: number
}

export interface JobMaterialStatus {
  jobId: string
  jobNumber: string | null
  builderName: string | null
  community: string | null
  scheduledDate: Date | null
  overallStatus: MaterialStatus
  lines: MaterialStatusLine[]
  totalShortageValue: number
}

export interface ComputeOptions {
  /** Max depth of BoM expansion. Default 4. */
  bomMaxDepth?: number
  /** Only include RED+AMBER lines in `lines[]`. Default false. */
  shortagesOnly?: boolean
}

// ─── Raw CTE row shape ──────────────────────────────────────────────────

interface CteRow {
  jobId: string
  jobNumber: string | null
  builderName: string | null
  community: string | null
  scheduledDate: Date | null
  productId: string
  sku: string | null
  productName: string | null
  required: number
  allocated: number
  onHand: number
  committedToOthers: number
  totalIncoming: number
  unitCost: number | null
  preferredVendorId: string | null
  preferredVendorName: string | null
  preferredLeadDays: number | null
  preferredVendorCost: number | null
  reorderQty: number
}

interface IncomingRow {
  jobId: string
  productId: string
  poNumber: string
  vendor: string
  expectedDate: Date
  qty: number
}

// ─── SQL — single CTE driver ────────────────────────────────────────────

// We run two queries:
//  (1) The main CTE: job × product × required × allocated × incoming-total.
//  (2) A small follow-up to fetch per-PO incoming detail rows for the
//      UI. We don't pack PO detail into the main CTE because the
//      Postgres aggregate would need array_agg of a composite type and
//      that fights with Prisma's $queryRawUnsafe decoder.

function coreCte(jobFilter: boolean) {
  return `
    WITH RECURSIVE
    -- active jobs with a real delivery date and an order
    active_jobs AS (
      SELECT j."id" AS job_id,
             j."jobNumber",
             j."builderName",
             j."community",
             j."scheduledDate",
             j."orderId"
      FROM "Job" j
      WHERE j."status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
        AND j."scheduledDate" IS NOT NULL
        AND j."orderId" IS NOT NULL
        ${jobFilter ? `AND j."id" = $1` : ''}
    ),
    -- top-level required products: walk OrderItems for each active job
    job_top AS (
      SELECT aj.job_id,
             aj."scheduledDate",
             oi."productId" AS parent_id,
             oi."quantity"::float AS parent_qty
      FROM active_jobs aj
      JOIN "OrderItem" oi ON oi."orderId" = aj."orderId"
    ),
    -- recursive BoM expansion: start at depth 0 (product itself), then
    -- walk BomEntry relations down to the leaves.
    bom_expansion AS (
      SELECT jt.job_id,
             jt."scheduledDate",
             jt.parent_id AS product_id,
             jt.parent_qty AS qty,
             0 AS depth
      FROM job_top jt
      UNION ALL
      SELECT be.job_id,
             be."scheduledDate",
             b."componentId" AS product_id,
             be.qty * b."quantity" AS qty,
             be.depth + 1
      FROM bom_expansion be
      JOIN "BomEntry" b ON b."parentId" = be.product_id
      WHERE be.depth < ${jobFilter ? `$2` : `$1`}::int
    ),
    has_children AS (
      SELECT DISTINCT "parentId" AS product_id FROM "BomEntry"
    ),
    -- total required per (job, product). Keep a row only if it's a terminal
    -- product (no BomEntry children) OR depth > 0 (was expanded).
    required_qty AS (
      SELECT be.job_id,
             be.product_id,
             SUM(be.qty)::float AS required
      FROM bom_expansion be
      LEFT JOIN has_children hc ON hc.product_id = be.product_id
      WHERE hc.product_id IS NULL OR be.depth > 0
      GROUP BY be.job_id, be.product_id
    ),
    -- already allocated to THIS job
    this_job_alloc AS (
      SELECT ia."jobId" AS job_id,
             ia."productId" AS product_id,
             SUM(ia."quantity")::float AS allocated
      FROM "InventoryAllocation" ia
      WHERE ia."status" = 'RESERVED' AND ia."jobId" IS NOT NULL
      GROUP BY ia."jobId", ia."productId"
    ),
    -- committed to OTHER active jobs (per product) — global number, not keyed to job
    other_commit AS (
      SELECT ia."productId" AS product_id,
             SUM(ia."quantity")::float AS committed_to_others
      FROM "InventoryAllocation" ia
      WHERE ia."status" = 'RESERVED'
      GROUP BY ia."productId"
    ),
    -- incoming total per (job, product): open-PO receipts where expectedDate
    -- is on or before Job.scheduledDate. Missing expectedDate: treated as
    -- orderedAt+14d, then ignored if that'd still miss the window.
    incoming_total AS (
      SELECT rq.job_id,
             rq.product_id,
             COALESCE(SUM(
               GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)
             ), 0)::float AS total_incoming
      FROM required_qty rq
      LEFT JOIN active_jobs aj ON aj.job_id = rq.job_id
      LEFT JOIN "PurchaseOrderItem" poi ON poi."productId" = rq.product_id
      LEFT JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
        AND po."status" IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED')
        AND COALESCE(
              po."expectedDate",
              po."orderedAt" + INTERVAL '14 days',
              NOW() + INTERVAL '30 days'
            ) <= aj."scheduledDate"
      WHERE po."id" IS NOT NULL
      GROUP BY rq.job_id, rq.product_id
    ),
    preferred_vendor AS (
      SELECT DISTINCT ON (vp."productId")
        vp."productId" AS product_id,
        vp."vendorId",
        v."name" AS vendor_name,
        vp."leadTimeDays",
        vp."vendorCost"
      FROM "VendorProduct" vp
      JOIN "Vendor" v ON v."id" = vp."vendorId" AND v."active" = true
      ORDER BY vp."productId", vp."preferred" DESC NULLS LAST, vp."vendorCost" ASC NULLS LAST
    )
    SELECT
      rq.job_id AS "jobId",
      aj."jobNumber",
      aj."builderName",
      aj."community",
      aj."scheduledDate",
      rq.product_id AS "productId",
      p."sku",
      p."name" AS "productName",
      rq.required::float AS required,
      COALESCE(tja.allocated, 0)::float AS allocated,
      COALESCE(i."onHand", 0)::int AS "onHand",
      COALESCE(oc.committed_to_others, 0)::float AS "committedToOthers",
      COALESCE(it.total_incoming, 0)::float AS "totalIncoming",
      COALESCE(i."unitCost", p."cost", 0)::float AS "unitCost",
      pv."vendorId" AS "preferredVendorId",
      pv.vendor_name AS "preferredVendorName",
      pv."leadTimeDays" AS "preferredLeadDays",
      pv."vendorCost" AS "preferredVendorCost",
      COALESCE(i."reorderQty", 0)::int AS "reorderQty"
    FROM required_qty rq
    LEFT JOIN active_jobs aj ON aj.job_id = rq.job_id
    LEFT JOIN this_job_alloc tja ON tja.job_id = rq.job_id AND tja.product_id = rq.product_id
    LEFT JOIN other_commit oc ON oc.product_id = rq.product_id
    LEFT JOIN incoming_total it ON it.job_id = rq.job_id AND it.product_id = rq.product_id
    LEFT JOIN "Product" p ON p."id" = rq.product_id
    LEFT JOIN "InventoryItem" i ON i."productId" = rq.product_id
    LEFT JOIN preferred_vendor pv ON pv.product_id = rq.product_id
    WHERE rq.required > 0
  `
}

// Per-PO incoming-detail query (for UI display).
const INCOMING_DETAIL_SQL = `
  SELECT
    aj."job_id" AS "jobId",
    poi."productId" AS "productId",
    po."poNumber" AS "poNumber",
    v."name" AS "vendor",
    COALESCE(
      po."expectedDate",
      po."orderedAt" + INTERVAL '14 days',
      NOW() + INTERVAL '30 days'
    )::timestamp AS "expectedDate",
    GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)::float AS qty
  FROM (
    SELECT j."id" AS job_id, j."scheduledDate"
    FROM "Job" j
    WHERE j."status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
      AND j."scheduledDate" IS NOT NULL
      AND j."orderId" IS NOT NULL
      __JOB_FILTER__
  ) aj
  CROSS JOIN "PurchaseOrderItem" poi
  JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
  JOIN "Vendor" v ON v."id" = po."vendorId"
  WHERE po."status" IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED')
    AND COALESCE(
          po."expectedDate",
          po."orderedAt" + INTERVAL '14 days',
          NOW() + INTERVAL '30 days'
        ) <= aj."scheduledDate"
    AND GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0) > 0
    AND poi."productId" IN (
      SELECT rq_product_id FROM (__PRODUCT_SUBQUERY__) prods(rq_product_id)
    )
`

// ─── Status & recommendation logic ──────────────────────────────────────

function classifyLine(
  required: number,
  allocated: number,
  projectedATP: number,
  incoming: IncomingPO[],
  scheduledDate: Date | null
): { status: LineStatus; shortfall: number; recommendation: Recommendation } {
  // Already fully reserved.
  if (required <= allocated) {
    return { status: 'GREEN', shortfall: 0, recommendation: 'NONE' }
  }
  const shortfall = Math.max(0, required - allocated - projectedATP)

  if (shortfall === 0) {
    // AMBER: incoming PO covers; check if expedite needed
    if (scheduledDate && incoming.length > 0) {
      const bufferMs = 3 * 86400000 // 3 days
      const due = scheduledDate.getTime()
      // If ANY incoming PO lands within 3d of scheduledDate, flag expedite.
      const tight = incoming.some((po) => due - new Date(po.expectedDate).getTime() <= bufferMs)
      return {
        status: 'AMBER',
        shortfall: 0,
        recommendation: tight ? 'EXPEDITE' : 'NONE',
      }
    }
    return { status: 'AMBER', shortfall: 0, recommendation: 'NONE' }
  }

  // RED
  return { status: 'RED', shortfall, recommendation: 'NEW_PO' }
}

function worstStatus(lines: MaterialStatusLine[]): MaterialStatus {
  if (lines.length === 0) return 'UNKNOWN'
  if (lines.some((l) => l.status === 'RED')) return 'RED'
  if (lines.some((l) => l.status === 'AMBER')) return 'AMBER'
  return 'GREEN'
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Compute material status for a single Job.
 * Returns UNKNOWN if the job doesn't exist, has no scheduledDate, has no
 * order, or is already completed.
 */
export async function computeJobMaterialStatus(
  jobId: string,
  opts: ComputeOptions = {}
): Promise<JobMaterialStatus> {
  const bomMaxDepth = Math.max(1, Math.min(8, opts.bomMaxDepth ?? 4))

  const rows = await prisma.$queryRawUnsafe<CteRow[]>(coreCte(true), jobId, bomMaxDepth)

  // If the job returns no rows at all, fetch its header just so we can
  // include a real shape in the response.
  if (rows.length === 0) {
    const header = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        jobNumber: string | null
        builderName: string | null
        community: string | null
        scheduledDate: Date | null
      }>
    >(
      `SELECT "id", "jobNumber", "builderName", "community", "scheduledDate"
       FROM "Job" WHERE "id" = $1 LIMIT 1`,
      jobId
    )
    const h = header[0]
    return {
      jobId,
      jobNumber: h?.jobNumber ?? null,
      builderName: h?.builderName ?? null,
      community: h?.community ?? null,
      scheduledDate: h?.scheduledDate ?? null,
      overallStatus: 'UNKNOWN',
      lines: [],
      totalShortageValue: 0,
    }
  }

  // Fetch per-PO incoming detail for just this job's products.
  const productIds = rows.map((r) => r.productId)
  const incoming = productIds.length
    ? await prisma.$queryRawUnsafe<IncomingRow[]>(
        `
        SELECT
          $1::text AS "jobId",
          poi."productId" AS "productId",
          po."poNumber" AS "poNumber",
          v."name" AS vendor,
          COALESCE(
            po."expectedDate",
            po."orderedAt" + INTERVAL '14 days',
            NOW() + INTERVAL '30 days'
          )::timestamp AS "expectedDate",
          GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)::float AS qty
        FROM "PurchaseOrderItem" poi
        JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
        JOIN "Vendor" v ON v."id" = po."vendorId"
        JOIN "Job" j ON j."id" = $1
        WHERE po."status" IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED')
          AND COALESCE(
                po."expectedDate",
                po."orderedAt" + INTERVAL '14 days',
                NOW() + INTERVAL '30 days'
              ) <= j."scheduledDate"
          AND GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0) > 0
          AND poi."productId" = ANY($2::text[])
        `,
        jobId,
        productIds
      )
    : []

  return rowsToJobStatus(rows, incoming, opts)
}

/**
 * Compute material status for every active Job in one pass.
 * Returns a map keyed by jobId for fast lookup.
 */
export async function computeAllActiveJobsMaterialStatus(
  opts: ComputeOptions = {}
): Promise<JobMaterialStatus[]> {
  const bomMaxDepth = Math.max(1, Math.min(8, opts.bomMaxDepth ?? 4))

  const rows = await prisma.$queryRawUnsafe<CteRow[]>(coreCte(false), bomMaxDepth)
  if (rows.length === 0) return []

  // Pull all incoming-detail rows across every active job.
  const incoming = await prisma.$queryRawUnsafe<IncomingRow[]>(
    `
    WITH active_jobs AS (
      SELECT j."id" AS job_id, j."scheduledDate"
      FROM "Job" j
      WHERE j."status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
        AND j."scheduledDate" IS NOT NULL
        AND j."orderId" IS NOT NULL
    )
    SELECT
      aj.job_id AS "jobId",
      poi."productId" AS "productId",
      po."poNumber" AS "poNumber",
      v."name" AS vendor,
      COALESCE(
        po."expectedDate",
        po."orderedAt" + INTERVAL '14 days',
        NOW() + INTERVAL '30 days'
      )::timestamp AS "expectedDate",
      GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)::float AS qty
    FROM active_jobs aj
    CROSS JOIN "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
    JOIN "Vendor" v ON v."id" = po."vendorId"
    WHERE po."status" IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED')
      AND COALESCE(
            po."expectedDate",
            po."orderedAt" + INTERVAL '14 days',
            NOW() + INTERVAL '30 days'
          ) <= aj."scheduledDate"
      AND GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0) > 0
    `
  )

  // Group rows by jobId
  const byJob = new Map<string, CteRow[]>()
  for (const r of rows) {
    const arr = byJob.get(r.jobId) || []
    arr.push(r)
    byJob.set(r.jobId, arr)
  }

  const out: JobMaterialStatus[] = []
  for (const [, jobRows] of byJob) {
    const incomingForJob = incoming.filter((i) => i.jobId === jobRows[0].jobId)
    out.push(rowsToJobStatus(jobRows, incomingForJob, opts))
  }
  return out
}

function rowsToJobStatus(
  rows: CteRow[],
  incoming: IncomingRow[],
  opts: ComputeOptions
): JobMaterialStatus {
  const head = rows[0]
  const lines: MaterialStatusLine[] = []
  let totalShortageValue = 0

  // bucket incoming by product
  const incomingByProduct = new Map<string, IncomingPO[]>()
  for (const i of incoming) {
    const arr = incomingByProduct.get(i.productId) || []
    arr.push({
      poNumber: i.poNumber,
      vendor: i.vendor,
      expectedDate: new Date(i.expectedDate),
      qty: Number(i.qty),
    })
    incomingByProduct.set(i.productId, arr)
  }

  for (const r of rows) {
    const required = Number(r.required)
    const allocated = Number(r.allocated)
    const onHand = Number(r.onHand)
    const committedToOthers = Number(r.committedToOthers)
    const available = Math.max(0, onHand - committedToOthers)
    const productIncoming = incomingByProduct.get(r.productId) || []
    const totalIncomingBeforeDueDate = Number(r.totalIncoming)
    const projectedATP = available + totalIncomingBeforeDueDate
    const { status, shortfall, recommendation } = classifyLine(
      required,
      allocated,
      projectedATP,
      productIncoming,
      r.scheduledDate ? new Date(r.scheduledDate) : null
    )
    const unitCost = Number(r.unitCost) || 0
    const estShortageValue = shortfall * unitCost
    totalShortageValue += estShortageValue

    if (opts.shortagesOnly && status === 'GREEN') continue

    lines.push({
      productId: r.productId,
      sku: r.sku || '',
      productName: r.productName || '',
      required,
      allocated,
      onHand,
      committedToOthers,
      available,
      incomingBeforeDueDate: productIncoming,
      totalIncomingBeforeDueDate,
      projectedATP,
      shortfall,
      status,
      recommendation,
      estShortageValue,
      preferredVendorId: r.preferredVendorId,
      preferredVendorName: r.preferredVendorName,
      preferredVendorLeadDays: r.preferredLeadDays,
      preferredVendorCost: r.preferredVendorCost == null ? null : Number(r.preferredVendorCost),
      reorderQty: Number(r.reorderQty) || 0,
    })
  }

  return {
    jobId: head.jobId,
    jobNumber: head.jobNumber,
    builderName: head.builderName,
    community: head.community,
    scheduledDate: head.scheduledDate ? new Date(head.scheduledDate) : null,
    overallStatus: worstStatus(lines),
    lines,
    totalShortageValue,
  }
}

/**
 * Summary counts across the whole yard. Cheap enough to put on /ops/admin.
 */
export interface ShortageSummary {
  activeRed: number
  activeAmber: number
  activeGreen: number
  totalShortageValue: number
  jobsAtRisk: number
}

export async function computeShortageSummary(): Promise<ShortageSummary> {
  const statuses = await computeAllActiveJobsMaterialStatus({ shortagesOnly: false })
  let red = 0
  let amber = 0
  let green = 0
  let value = 0
  let atRisk = 0
  for (const s of statuses) {
    for (const l of s.lines) {
      if (l.status === 'RED') red++
      else if (l.status === 'AMBER') amber++
      else green++
      value += l.estShortageValue
    }
    if (s.overallStatus === 'RED' || s.overallStatus === 'AMBER') atRisk++
  }
  return {
    activeRed: red,
    activeAmber: amber,
    activeGreen: green,
    totalShortageValue: value,
    jobsAtRisk: atRisk,
  }
}
