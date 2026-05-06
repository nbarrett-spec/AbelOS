/**
 * Material Requirements Planning (MRP) — shared engine
 *
 * Time-phased projection of inventory balance over a horizon, walking
 * Job → Order → OrderItem → BomEntry expansion to compute future demand,
 * then intersecting with on-hand + inbound POs.
 *
 * No new schema models — everything derives at query time. See docs/MRP_SPEC.md.
 */

import { prisma } from '@/lib/prisma'

// ─── Types ──────────────────────────────────────────────────────────────

export interface MrpDayBucket {
  date: string // ISO date (YYYY-MM-DD)
  demand: number
  inbound: number
  balance: number
}

export interface MrpProductProjection {
  productId: string
  sku: string
  name: string
  category: string | null
  onHand: number
  committed: number
  safetyStock: number
  reorderQty: number
  preferredVendor: {
    vendorId: string
    name: string
    code: string | null
    leadTimeDays: number | null
    vendorCost: number | null
    minOrderQty: number
  } | null
  // Effective vendor lead time used for poNeededBy math.
  // Resolution order: Product.leadTimeDays → VendorProduct.leadTimeDays
  // → Vendor.avgLeadDays → 14 (default).
  effectiveLeadDays: number
  // Source of effectiveLeadDays — for transparency in the UI/logs.
  leadTimeSource: 'product' | 'vendorProduct' | 'vendor' | 'default'
  totalDemand: number
  totalInbound: number
  endingBalance: number
  stockoutDate: string | null
  daysUntilStockout: number | null
  // Date by which the PO must be placed (= stockoutDate − effectiveLeadDays).
  // Null when stockoutDate is null.
  poNeededBy: string | null
  // True when poNeededBy is in the past — i.e. lead time eats the runway and
  // we're already late to order. Surfaces the "you have 5 days but vendor
  // takes 14, so you're already late" UX.
  alreadyLate: boolean
  // Days from `today` until poNeededBy. Negative = already late.
  // Null when stockoutDate is null.
  daysUntilPoNeededBy: number | null
  shortfallQty: number // qty needed beyond safetyStock at stockout point (positive number)
  schedule: MrpDayBucket[]
  drivingJobIds: string[]
}

export interface MrpProjectionResult {
  asOf: string
  horizonDays: number
  leadBufferDays: number
  unscheduledJobCount: number
  products: MrpProductProjection[]
}

export interface MrpOptions {
  horizonDays?: number // default 90
  leadBufferDays?: number // default 3 — material on hand N days before scheduledDate
  productIds?: string[]
  bomMaxDepth?: number // default 4
  includeQuiet?: boolean // default false — also include products with zero demand and zero inbound
}

// ─── Core projection ────────────────────────────────────────────────────

/**
 * Run the MRP projection. Heavy SQL; cache callers if you call this often.
 */
export async function runMrpProjection(opts: MrpOptions = {}): Promise<MrpProjectionResult> {
  const horizonDays = Math.max(7, Math.min(365, opts.horizonDays ?? 90))
  const leadBufferDays = Math.max(0, Math.min(30, opts.leadBufferDays ?? 3))
  const bomMaxDepth = Math.max(1, Math.min(8, opts.bomMaxDepth ?? 4))
  const productFilter = opts.productIds && opts.productIds.length > 0
  const includeQuiet = !!opts.includeQuiet

  // 1. Expand demand: walk active jobs → order items → BOM components recursively
  //
  // We use the demand date = scheduledDate - leadBufferDays so the material
  // is on-hand before install. Jobs with no scheduledDate are skipped and
  // surfaced as `unscheduledJobCount`.
  //
  // BOM expansion: a product with no BomEntry is its own terminal demand.
  const demandRows = await prisma.$queryRawUnsafe<
    Array<{
      productId: string
      demandDate: Date
      quantity: number
      jobId: string
    }>
  >(
    `
    WITH RECURSIVE
    active_jobs AS (
      SELECT j."id" as job_id, j."orderId", j."scheduledDate"
      FROM "Job" j
      WHERE j."status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
        AND j."scheduledDate" IS NOT NULL
        AND j."orderId" IS NOT NULL
        AND j."scheduledDate" <= NOW() + ($1::int || ' days')::interval
    ),
    job_top_demand AS (
      -- Top-level OrderItem demand keyed to the job
      SELECT
        aj.job_id,
        aj."scheduledDate",
        oi."productId" as parent_product_id,
        oi."quantity"::float as parent_qty
      FROM active_jobs aj
      JOIN "OrderItem" oi ON oi."orderId" = aj."orderId"
    ),
    bom_expansion AS (
      -- Recursive BOM walk: start with the parent product as depth 0,
      -- then for each BomEntry walk to the component.
      SELECT
        jtd.job_id,
        jtd."scheduledDate",
        jtd.parent_product_id as product_id,
        jtd.parent_qty as qty,
        0 as depth
      FROM job_top_demand jtd

      UNION ALL

      SELECT
        be.job_id,
        be."scheduledDate",
        b."componentId" as product_id,
        be.qty * b."quantity" as qty,
        be.depth + 1
      FROM bom_expansion be
      JOIN "BomEntry" b ON b."parentId" = be.product_id
      WHERE be.depth < $2::int
    ),
    -- A product is "terminal" (consumes itself) if it has no BomEntry rows as parent.
    -- Otherwise we use its components, not itself.
    has_children AS (
      SELECT DISTINCT "parentId" as product_id FROM "BomEntry"
    )
    SELECT
      be.product_id as "productId",
      (be."scheduledDate"::date - ($3::int || ' days')::interval)::date as "demandDate",
      SUM(be.qty)::float as quantity,
      MAX(be.job_id) as "jobId"
    FROM bom_expansion be
    LEFT JOIN has_children hc ON hc.product_id = be.product_id
    -- Keep a row only if it's a leaf (no children) OR depth > 0 (i.e. it WAS expanded from a parent)
    WHERE hc.product_id IS NULL OR be.depth > 0
    GROUP BY be.product_id, ("scheduledDate"::date - ($3::int || ' days')::interval)::date
    `,
    horizonDays,
    bomMaxDepth,
    leadBufferDays
  )

  // 2. Get current inventory snapshot
  const productIdSet = new Set<string>(demandRows.map((r) => r.productId))
  if (productFilter) {
    for (const id of opts.productIds!) productIdSet.add(id)
  }

  // Always include products with open inbound POs even if they have no demand,
  // because users will want to see their projected balance trajectory.
  const inboundRows = await prisma.$queryRawUnsafe<
    Array<{
      productId: string
      inboundDate: Date
      quantity: number
    }>
  >(
    `
    SELECT
      poi."productId" as "productId",
      COALESCE(po."expectedDate"::date, (po."orderedAt"::date + INTERVAL '14 days')::date, (CURRENT_DATE + INTERVAL '14 days')::date)::date as "inboundDate",
      GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)::float as quantity
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
    WHERE po."status" IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      AND poi."productId" IS NOT NULL
      AND (poi."quantity" - COALESCE(poi."receivedQty", 0)) > 0
    `
  )
  for (const r of inboundRows) productIdSet.add(r.productId)

  if (productIdSet.size === 0) {
    return {
      asOf: new Date().toISOString(),
      horizonDays,
      leadBufferDays,
      unscheduledJobCount: 0,
      products: [],
    }
  }

  const productIds = Array.from(productIdSet)

  // 3. Fetch product info + inventory + preferred vendor in one query.
  // Lead-time data is pulled from three layers so the projector can
  // resolve effectiveLeadDays without a second round-trip:
  //   Product.leadTimeDays  → per-product override (tightest signal)
  //   VendorProduct.leadTimeDays → vendor-product specific (current preference)
  //   Vendor.avgLeadDays    → vendor default
  const productInfo = await prisma.$queryRawUnsafe<
    Array<{
      productId: string
      sku: string
      name: string
      category: string | null
      onHand: number
      committed: number
      safetyStock: number
      reorderQty: number
      productLeadTimeDays: number | null
      vendorId: string | null
      vendorName: string | null
      vendorCode: string | null
      leadTimeDays: number | null
      vendorAvgLeadDays: number | null
      vendorCost: number | null
      minOrderQty: number | null
    }>
  >(
    `
    SELECT
      p."id" as "productId",
      p."sku" as sku,
      p."name" as name,
      p."category" as category,
      COALESCE(i."onHand", 0)::int as "onHand",
      COALESCE(i."committed", 0)::int as committed,
      COALESCE(i."safetyStock", 0)::int as "safetyStock",
      COALESCE(i."reorderQty", 0)::int as "reorderQty",
      p."leadTimeDays" as "productLeadTimeDays",
      vp."vendorId" as "vendorId",
      v."name" as "vendorName",
      v."code" as "vendorCode",
      vp."leadTimeDays" as "leadTimeDays",
      v."avgLeadDays" as "vendorAvgLeadDays",
      vp."vendorCost" as "vendorCost",
      vp."minOrderQty" as "minOrderQty"
    FROM "Product" p
    LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
    LEFT JOIN LATERAL (
      SELECT vp.*
      FROM "VendorProduct" vp
      WHERE vp."productId" = p."id"
      ORDER BY vp."preferred" DESC NULLS LAST, vp."vendorCost" ASC NULLS LAST
      LIMIT 1
    ) vp ON true
    LEFT JOIN "Vendor" v ON v."id" = vp."vendorId"
    WHERE p."id" = ANY($1::text[])
    `,
    productIds
  )

  // Count unscheduled jobs for the warning banner
  const unscheduledRow = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `
    SELECT COUNT(*)::int as count
    FROM "Job"
    WHERE "status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
      AND ("scheduledDate" IS NULL OR "orderId" IS NULL)
    `
  )
  const unscheduledJobCount = unscheduledRow[0]?.count ?? 0

  // 4. Build per-product projection
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Pre-bucket demand and inbound by productId → date string → qty
  const demandByProduct: Record<string, Record<string, number>> = {}
  const drivingJobsByProduct: Record<string, Set<string>> = {}
  for (const r of demandRows) {
    const pid = r.productId
    const day = isoDay(r.demandDate)
    if (!demandByProduct[pid]) demandByProduct[pid] = {}
    demandByProduct[pid][day] = (demandByProduct[pid][day] || 0) + Number(r.quantity)
    if (!drivingJobsByProduct[pid]) drivingJobsByProduct[pid] = new Set()
    if (r.jobId) drivingJobsByProduct[pid].add(r.jobId)
  }

  const inboundByProduct: Record<string, Record<string, number>> = {}
  for (const r of inboundRows) {
    const pid = r.productId
    const day = isoDay(r.inboundDate)
    if (!inboundByProduct[pid]) inboundByProduct[pid] = {}
    inboundByProduct[pid][day] = (inboundByProduct[pid][day] || 0) + Number(r.quantity)
  }

  // Build day labels for the horizon
  const dayLabels: string[] = []
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    dayLabels.push(isoDay(d))
  }

  const products: MrpProductProjection[] = []

  for (const info of productInfo) {
    if (productFilter && !opts.productIds!.includes(info.productId)) continue

    const productDemand = demandByProduct[info.productId] || {}
    const productInbound = inboundByProduct[info.productId] || {}

    const totalDemand = Object.values(productDemand).reduce((a, b) => a + b, 0)
    const totalInbound = Object.values(productInbound).reduce((a, b) => a + b, 0)

    if (!includeQuiet && totalDemand === 0 && totalInbound === 0) continue

    let balance = info.onHand
    let stockoutDate: string | null = null
    let shortfallQty = 0
    const schedule: MrpDayBucket[] = []

    for (const day of dayLabels) {
      const demand = productDemand[day] || 0
      const inbound = productInbound[day] || 0
      balance = balance + inbound - demand

      if (stockoutDate === null && balance < info.safetyStock) {
        stockoutDate = day
        shortfallQty = Math.max(info.safetyStock - balance, 0)
      } else if (stockoutDate !== null && balance < info.safetyStock) {
        const localShortfall = info.safetyStock - balance
        if (localShortfall > shortfallQty) shortfallQty = localShortfall
      }

      schedule.push({ date: day, demand, inbound, balance })
    }

    const daysUntilStockout = stockoutDate
      ? Math.max(0, Math.round((new Date(stockoutDate).getTime() - today.getTime()) / 86400000))
      : null

    // Resolve effective vendor lead time: Product → VendorProduct → Vendor → 14d default.
    // We treat 0 as "no signal" because most data has 0/null mixed in for unknown.
    let effectiveLeadDays = 14
    let leadTimeSource: 'product' | 'vendorProduct' | 'vendor' | 'default' = 'default'
    if (info.productLeadTimeDays && info.productLeadTimeDays > 0) {
      effectiveLeadDays = info.productLeadTimeDays
      leadTimeSource = 'product'
    } else if (info.leadTimeDays && info.leadTimeDays > 0) {
      effectiveLeadDays = info.leadTimeDays
      leadTimeSource = 'vendorProduct'
    } else if (info.vendorAvgLeadDays && info.vendorAvgLeadDays > 0) {
      effectiveLeadDays = info.vendorAvgLeadDays
      leadTimeSource = 'vendor'
    }

    // poNeededBy = stockoutDate − effectiveLeadDays. If the resulting date is
    // already in the past, we mark `alreadyLate` and let the UI shout.
    let poNeededBy: string | null = null
    let alreadyLate = false
    let daysUntilPoNeededBy: number | null = null
    if (stockoutDate) {
      const stockoutDt = new Date(stockoutDate)
      const needBy = new Date(stockoutDt)
      needBy.setDate(needBy.getDate() - effectiveLeadDays)
      poNeededBy = isoDay(needBy)
      const diffMs = needBy.getTime() - today.getTime()
      daysUntilPoNeededBy = Math.round(diffMs / 86400000)
      alreadyLate = diffMs < 0
    }

    products.push({
      productId: info.productId,
      sku: info.sku,
      name: info.name,
      category: info.category,
      onHand: info.onHand,
      committed: info.committed,
      safetyStock: info.safetyStock,
      reorderQty: info.reorderQty,
      preferredVendor: info.vendorId
        ? {
            vendorId: info.vendorId,
            name: info.vendorName ?? '',
            code: info.vendorCode,
            leadTimeDays: info.leadTimeDays,
            vendorCost: info.vendorCost,
            minOrderQty: info.minOrderQty ?? 1,
          }
        : null,
      effectiveLeadDays,
      leadTimeSource,
      totalDemand,
      totalInbound,
      endingBalance: balance,
      stockoutDate,
      daysUntilStockout,
      poNeededBy,
      alreadyLate,
      daysUntilPoNeededBy,
      shortfallQty,
      schedule,
      drivingJobIds: Array.from(drivingJobsByProduct[info.productId] || []),
    })
  }

  // Sort: alreadyLate stockouts first, then upcoming stockouts (closest first),
  // then by ending balance ascending. "Already late" floats to the top because
  // those need a phone call, not just a PO draft.
  products.sort((a, b) => {
    if (a.alreadyLate && !b.alreadyLate) return -1
    if (!a.alreadyLate && b.alreadyLate) return 1
    if (a.stockoutDate && !b.stockoutDate) return -1
    if (!a.stockoutDate && b.stockoutDate) return 1
    if (a.stockoutDate && b.stockoutDate) {
      return (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999)
    }
    return a.endingBalance - b.endingBalance
  })

  return {
    asOf: new Date().toISOString(),
    horizonDays,
    leadBufferDays,
    unscheduledJobCount,
    products,
  }
}

// ─── Helpers used by other routes ───────────────────────────────────────

/**
 * Recompute avgDailyUsage and daysOfSupply for a single product based on the
 * trailing 30 days of MaterialPick / OrderItem activity. Idempotent. Safe to call
 * from receiving routes and pick verification routes.
 */
export async function recomputeAvgDailyUsage(productId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `
      WITH usage AS (
        SELECT COALESCE(SUM(mp."quantity"), 0)::float as total_used
        FROM "MaterialPick" mp
        WHERE mp."productId" = $1
          AND mp."status" IN ('PICKED', 'VERIFIED')
          AND mp."pickedAt" >= NOW() - INTERVAL '30 days'
      )
      UPDATE "InventoryItem" i
      SET
        "avgDailyUsage" = (SELECT total_used / 30.0 FROM usage),
        "daysOfSupply" = CASE
          WHEN (SELECT total_used / 30.0 FROM usage) > 0
          THEN i."onHand" / (SELECT total_used / 30.0 FROM usage)
          ELSE 0
        END
      WHERE i."productId" = $1
      `,
      productId
    )
  } catch (err) {
    console.warn('[mrp] recomputeAvgDailyUsage failed for', productId, err)
  }
}

/**
 * If a PO has no expectedDate and is being marked SENT_TO_VENDOR, default it
 * to orderedAt + max(VendorProduct.leadTimeDays) for items on the PO, falling
 * back to 14 days if no lead time is known.
 */
export async function defaultExpectedDateForPO(poId: string): Promise<Date | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ leadDays: number | null; orderedAt: Date | null }>>(
      `
      SELECT
        MAX(vp."leadTimeDays") as "leadDays",
        po."orderedAt" as "orderedAt"
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      LEFT JOIN "VendorProduct" vp ON vp."productId" = poi."productId" AND vp."vendorId" = po."vendorId"
      WHERE po."id" = $1
      GROUP BY po."orderedAt"
      `,
      poId
    )
    const r = rows[0]
    if (!r) return null

    const base = r.orderedAt ? new Date(r.orderedAt) : new Date()
    const days = r.leadDays && r.leadDays > 0 ? r.leadDays : 14
    const expected = new Date(base)
    expected.setDate(expected.getDate() + days)

    await prisma.$executeRawUnsafe(
      `UPDATE "PurchaseOrder" SET "expectedDate" = $1 WHERE "id" = $2 AND "expectedDate" IS NULL`,
      expected,
      poId
    )
    return expected
  } catch (err) {
    console.warn('[mrp] defaultExpectedDateForPO failed for', poId, err)
    return null
  }
}

/**
 * Allocate (commit) inventory for a job entering MATERIALS_LOCKED. Walks
 * BOM-expanded demand for the job and increments InventoryItem.committed.
 * Idempotent: writes an Activity record so we don't double-commit.
 */
export async function allocateJobMaterials(jobId: string): Promise<{ allocated: number; skipped: boolean }> {
  // Check for existing allocation activity
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT "id" FROM "Activity"
    WHERE "jobId" = $1 AND "type" = 'MATERIALS_COMMITTED'
    LIMIT 1
    `,
    jobId
  )
  if (existing.length > 0) {
    return { allocated: 0, skipped: true }
  }

  // BOM-expand the job's demand
  const lines = await prisma.$queryRawUnsafe<
    Array<{ productId: string; quantity: number }>
  >(
    `
    WITH RECURSIVE
    job_demand AS (
      SELECT oi."productId" as product_id, oi."quantity"::float as qty, 0 as depth
      FROM "Job" j
      JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
      WHERE j."id" = $1

      UNION ALL

      SELECT b."componentId", jd.qty * b."quantity", jd.depth + 1
      FROM job_demand jd
      JOIN "BomEntry" b ON b."parentId" = jd.product_id
      WHERE jd.depth < 4
    ),
    has_children AS (
      SELECT DISTINCT "parentId" as product_id FROM "BomEntry"
    )
    SELECT
      jd.product_id as "productId",
      SUM(jd.qty)::int as quantity
    FROM job_demand jd
    LEFT JOIN has_children hc ON hc.product_id = jd.product_id
    WHERE hc.product_id IS NULL OR jd.depth > 0
    GROUP BY jd.product_id
    `,
    jobId
  )

  let allocated = 0
  for (const line of lines) {
    if (!line.productId || !line.quantity) continue
    await prisma.$executeRawUnsafe(
      `
      UPDATE "InventoryItem"
      SET "committed" = COALESCE("committed", 0) + $1,
          "available" = GREATEST(COALESCE("onHand", 0) - (COALESCE("committed", 0) + $1), 0)
      WHERE "productId" = $2
      `,
      line.quantity,
      line.productId
    )
    allocated++
  }

  // Write the activity record so we don't re-allocate. Wrapped in try/catch
  // because Activity table has schema drift and we don't want a logging miss
  // to roll back the allocation.
  const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Activity" ("id", "jobId", "type", "description", "metadata", "createdAt")
      VALUES ($1, $2, 'MATERIALS_COMMITTED', $3, $4::jsonb, NOW())
      `,
      activityId,
      jobId,
      `Allocated ${allocated} components for job materials lock`,
      JSON.stringify({ allocated, lines })
    )
  } catch (err) {
    console.warn('[mrp] failed to log MATERIALS_COMMITTED activity for', jobId, err)
  }

  return { allocated, skipped: false }
}

/**
 * Release allocations for a job entering a terminal state. Decrements
 * InventoryItem.committed by the snapshot we recorded at allocation time.
 */
export async function releaseJobMaterials(jobId: string): Promise<{ released: number; skipped: boolean }> {
  const existing = await prisma.$queryRawUnsafe<
    Array<{ id: string; metadata: any }>
  >(
    `
    SELECT "id", "metadata" FROM "Activity"
    WHERE "jobId" = $1 AND "type" = 'MATERIALS_COMMITTED'
    ORDER BY "createdAt" DESC
    LIMIT 1
    `,
    jobId
  )
  if (existing.length === 0) return { released: 0, skipped: true }

  // Check we haven't already released
  const released = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT "id" FROM "Activity"
    WHERE "jobId" = $1 AND "type" = 'MATERIALS_RELEASED'
    LIMIT 1
    `,
    jobId
  )
  if (released.length > 0) return { released: 0, skipped: true }

  const meta = existing[0].metadata
  const lines: Array<{ productId: string; quantity: number }> = (meta && meta.lines) || []

  let count = 0
  for (const line of lines) {
    if (!line.productId || !line.quantity) continue
    await prisma.$executeRawUnsafe(
      `
      UPDATE "InventoryItem"
      SET "committed" = GREATEST(COALESCE("committed", 0) - $1, 0),
          "available" = GREATEST(COALESCE("onHand", 0) - GREATEST(COALESCE("committed", 0) - $1, 0), 0)
      WHERE "productId" = $2
      `,
      line.quantity,
      line.productId
    )
    count++
  }

  const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Activity" ("id", "jobId", "type", "description", "metadata", "createdAt")
      VALUES ($1, $2, 'MATERIALS_RELEASED', $3, $4::jsonb, NOW())
      `,
      activityId,
      jobId,
      `Released ${count} component allocations`,
      JSON.stringify({ released: count })
    )
  } catch (err) {
    console.warn('[mrp] failed to log MATERIALS_RELEASED activity for', jobId, err)
  }

  return { released: count, skipped: false }
}

// ─── Internal ───────────────────────────────────────────────────────────

function isoDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
