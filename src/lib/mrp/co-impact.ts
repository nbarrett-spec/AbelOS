/**
 * Change-Order Impact Preview.
 *
 * Given a Job and a proposed set of CO line deltas (ADD / REMOVE / SUBSTITUTE),
 * compute the material impact BEFORE the CO is accepted:
 *
 *   - For each ADD: can we fulfill from current ATP? If not, how many days
 *     until an incoming PO covers it (or would we need to place a new PO)?
 *   - For each REMOVE: verify this job has allocations large enough to release;
 *     the release frees committed inventory, good.
 *   - For each SUBSTITUTE: treat as a paired REMOVE(original) + ADD(substitute).
 *
 * Reuses `computeJobMaterialStatus()` as the ATP baseline — we do NOT mutate
 * state; we overlay the proposed lines on top of the existing material picture.
 *
 * Classification of overall impact:
 *   - NONE            — every ADD line is already covered by available-on-hand
 *                       (net of other commits) and every REMOVE is valid.
 *   - DELAYED_BUT_OK  — ADD lines require incoming PO arrivals that still land
 *                       on or before scheduledDate, so we *can* make it but
 *                       there's slack eaten up.
 *   - AT_RISK         — ADD lines need a new PO or an incoming PO that arrives
 *                       AFTER scheduledDate but within vendor lead-time; the
 *                       original date becomes stretched.
 *   - WILL_MISS       — required qty can't be met by scheduledDate under
 *                       reasonable vendor lead time assumptions.
 *
 * Note: this engine is read-only. It never writes to InventoryAllocation,
 * PurchaseOrder, or the Job row. Actually accepting the CO is a separate
 * flow that runs /api/ops/change-orders POST — this module just previews.
 */

import { prisma } from '@/lib/prisma'
import { computeJobMaterialStatus, type MaterialStatusLine } from './atp'

// ─── Types ──────────────────────────────────────────────────────────────

export type CoLineType = 'ADD' | 'REMOVE' | 'SUBSTITUTE'

/**
 * Input line. For SUBSTITUTE, `productId` is the original being replaced and
 * `substituteProductId` is what goes in. `qty` is the quantity being swapped.
 */
export interface CoLineInput {
  productId: string
  qty: number
  type: CoLineType
  substituteProductId?: string
  note?: string
}

export type CoLineImpactStatus =
  | 'OK_FROM_STOCK'           // ADD covered by available-on-hand now
  | 'OK_FROM_INCOMING'        // ADD covered by an incoming PO that lands in time
  | 'DELAYED_INCOMING'        // ADD covered by an incoming PO, but it lands after target
  | 'NEEDS_NEW_PO'            // ADD needs a brand-new PO; uses vendor lead time
  | 'AT_RISK'                 // ADD needs a new PO; arrives within 1 week of target
  | 'UNFULFILLABLE'           // ADD can't realistically land before target
  | 'RELEASE_OK'              // REMOVE: we have allocation; release frees committed
  | 'RELEASE_PARTIAL'         // REMOVE: less allocated than the remove qty — still releases what exists
  | 'RELEASE_NOT_FOUND'       // REMOVE: no allocation on this job for the product
  | 'SUBSTITUTE_OK'           // SUBSTITUTE: both halves look fine
  | 'SUBSTITUTE_SHORT'        // SUBSTITUTE: substitute side has a shortage
  | 'MISSING_PRODUCT'         // Product lookup failed — bad input or stale catalog

export interface CoLineImpact {
  // Mirrors CoLineInput so the client can match lines 1:1.
  input: CoLineInput

  // Product metadata (resolved from Product table).
  productId: string
  sku: string | null
  productName: string | null

  // For SUBSTITUTE: the replacement product details.
  substitute?: {
    productId: string
    sku: string | null
    productName: string | null
  }

  // Numeric picture for this line.
  qty: number
  onHand: number
  committedToOthers: number
  available: number
  existingAllocation: number // current allocation on THIS job
  incomingBeforeDue: number
  projectedATP: number
  unitCost: number

  // ADD-specific — how we think we'll source this line.
  sourcing: {
    fromStock: number        // pulled from current available
    fromIncoming: number     // pulled from in-flight POs arriving before due
    fromNewPO: number        // shortfall that needs a new PO
  }

  // Days-to-shelf for the worst-case unit on this line. null = sourced from
  // stock (zero delay). Integer >= 0. For NEEDS_NEW_PO we use the preferred-
  // vendor lead-time; for OK_FROM_INCOMING we use (earliest arrival - today).
  daysToShelf: number | null

  // The best-guess arrival date for whatever portion of the line isn't on
  // the shelf today. Used to build the "new completion date" banner.
  arrivalDate: Date | null

  // Estimated net cost delta (positive for ADD, negative for REMOVE, combined
  // for SUBSTITUTE). Uses Product.cost when available.
  costDelta: number

  status: CoLineImpactStatus
  reason: string | null // plain-English detail for UIs
}

export type CoOverallImpact = 'NONE' | 'DELAYED_BUT_OK' | 'AT_RISK' | 'WILL_MISS'

export interface CoImpactResult {
  jobId: string
  jobNumber: string | null
  scheduledDate: Date | null
  overallImpact: CoOverallImpact
  lines: CoLineImpact[]
  /** The date we think the job can now deliver. Null if unknown. */
  newCompletionDate: Date | null
  /** Whole-$ net cost change across every line in the CO. */
  totalNewValue: number
  /** Days between current scheduledDate and newCompletionDate. >= 0. */
  daysShifted: number
  /** Short human summary. */
  summary: string
  computedAt: Date
}

// ─── Internals ──────────────────────────────────────────────────────────

interface ProductRow {
  id: string
  sku: string | null
  name: string | null
  cost: number | null
}

interface ExistingAllocRow {
  productId: string
  qty: number
}

interface ProductInventoryView {
  productId: string
  sku: string | null
  productName: string | null
  onHand: number
  committedToOthers: number // excludes this job
  available: number         // onHand - committedToOthers
  existingAllocation: number // on this job
  incomingBeforeDue: number // units in flight arriving on/before job.scheduledDate
  earliestIncoming: Date | null // arrival date of earliest in-flight PO
  unitCost: number
  preferredLeadDays: number | null
}

/**
 * Resolve inventory + incoming PO picture for a bag of productIds, scoped
 * to a single Job (scheduledDate drives the "arrives in time" cutoff, and we
 * exclude this job's own allocation from `committedToOthers`).
 */
async function loadProductViews(
  jobId: string,
  scheduledDate: Date | null,
  productIds: string[]
): Promise<Map<string, ProductInventoryView>> {
  const out = new Map<string, ProductInventoryView>()
  if (productIds.length === 0) return out

  // Deduplicate — DB doesn't care but we do downstream.
  const unique = Array.from(new Set(productIds))

  // One query pulls Product + InventoryItem + preferred vendor + all-jobs
  // committed + this-job committed. No incoming here — that's a second pass
  // because "before due date" depends on job.scheduledDate.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `
    WITH
      this_job_alloc AS (
        SELECT "productId", SUM("quantity")::float AS q
        FROM "InventoryAllocation"
        WHERE "jobId" = $1 AND "status" = 'RESERVED'
        GROUP BY "productId"
      ),
      other_commit AS (
        SELECT "productId", SUM("quantity")::float AS q
        FROM "InventoryAllocation"
        WHERE "status" = 'RESERVED' AND ("jobId" IS NULL OR "jobId" <> $1)
        GROUP BY "productId"
      ),
      preferred_vendor AS (
        SELECT DISTINCT ON (vp."productId")
          vp."productId",
          vp."leadTimeDays"
        FROM "VendorProduct" vp
        JOIN "Vendor" v ON v."id" = vp."vendorId" AND v."active" = true
        ORDER BY vp."productId", vp."preferred" DESC NULLS LAST, vp."vendorCost" ASC NULLS LAST
      )
    SELECT
      p."id" AS "productId",
      p."sku",
      p."name" AS "productName",
      COALESCE(i."onHand", 0)::int AS "onHand",
      COALESCE(oc.q, 0)::float AS "committedToOthers",
      COALESCE(tja.q, 0)::float AS "existingAllocation",
      COALESCE(i."unitCost", p."cost", 0)::float AS "unitCost",
      pv."leadTimeDays"::int AS "preferredLeadDays"
    FROM "Product" p
    LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
    LEFT JOIN this_job_alloc tja ON tja."productId" = p."id"
    LEFT JOIN other_commit oc ON oc."productId" = p."id"
    LEFT JOIN preferred_vendor pv ON pv."productId" = p."id"
    WHERE p."id" = ANY($2::text[])
    `,
    jobId,
    unique
  )

  // Incoming POs for these products. If scheduledDate is null we still
  // collect them — UI can show "incoming" even without a hard due date.
  const incoming: any[] = await prisma.$queryRawUnsafe(
    `
    SELECT
      poi."productId" AS "productId",
      COALESCE(
        po."expectedDate",
        po."orderedAt" + INTERVAL '14 days',
        NOW() + INTERVAL '30 days'
      )::timestamp AS "expectedDate",
      GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)::float AS "qty"
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
    WHERE po."status" IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED')
      AND poi."productId" = ANY($1::text[])
      AND GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0) > 0
    `,
    unique
  )

  // Bucket incoming by product; sum qty for "before due", track earliest.
  const incomingByProduct = new Map<string, { qty: number; earliest: Date | null }>()
  for (const i of incoming) {
    const pid: string = i.productId
    const expectedDate = new Date(i.expectedDate)
    const qty = Number(i.qty)
    const cutoff = scheduledDate ? scheduledDate.getTime() : Infinity
    const bucket = incomingByProduct.get(pid) || { qty: 0, earliest: null }
    if (expectedDate.getTime() <= cutoff) {
      bucket.qty += qty
    }
    if (!bucket.earliest || expectedDate < bucket.earliest) {
      bucket.earliest = expectedDate
    }
    incomingByProduct.set(pid, bucket)
  }

  for (const r of rows) {
    const pid: string = r.productId
    const onHand = Number(r.onHand)
    const committedToOthers = Number(r.committedToOthers)
    const existingAllocation = Number(r.existingAllocation)
    const available = Math.max(0, onHand - committedToOthers)
    const bucket = incomingByProduct.get(pid)
    out.set(pid, {
      productId: pid,
      sku: r.sku,
      productName: r.productName,
      onHand,
      committedToOthers,
      available,
      existingAllocation,
      incomingBeforeDue: bucket?.qty ?? 0,
      earliestIncoming: bucket?.earliest ?? null,
      unitCost: Number(r.unitCost) || 0,
      preferredLeadDays: r.preferredLeadDays == null ? null : Number(r.preferredLeadDays),
    })
  }

  return out
}

/** Days between two dates, rounded up, never negative. */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  if (ms <= 0) return 0
  return Math.ceil(ms / 86400000)
}

/**
 * Classify a single ADD line given its inventory picture.
 * Returns sourcing breakdown + arrival date + status.
 */
function classifyAdd(
  view: ProductInventoryView,
  scheduledDate: Date | null,
  qty: number
): {
  status: CoLineImpactStatus
  sourcing: CoLineImpact['sourcing']
  arrivalDate: Date | null
  daysToShelf: number | null
  reason: string
} {
  const now = new Date()
  // FALLBACK_LEAD_DAYS — used when a product has no VendorProduct.leadTimeDays
  // (fresh SKUs the buyer hasn't negotiated yet). 14d matches the default
  // used in ATP's incoming CTE (po."orderedAt" + INTERVAL '14 days').
  const FALLBACK_LEAD_DAYS = 14

  const fromStock = Math.min(view.available, qty)
  let remaining = qty - fromStock

  const fromIncoming = Math.min(view.incomingBeforeDue, remaining)
  remaining = remaining - fromIncoming

  const fromNewPO = remaining

  const sourcing = { fromStock, fromIncoming, fromNewPO }

  // Determine arrival date of the worst-case unit.
  let arrival: Date | null = null
  let status: CoLineImpactStatus
  let reason: string

  if (fromStock === qty) {
    status = 'OK_FROM_STOCK'
    reason = 'Fully covered from stock on hand.'
    arrival = null
  } else if (fromNewPO === 0 && fromIncoming > 0) {
    // All covered by incoming, no new PO needed
    arrival = view.earliestIncoming
    status = 'OK_FROM_INCOMING'
    reason = `Covered by incoming PO${arrival ? ` arriving ${arrival.toLocaleDateString()}` : ''}.`
  } else if (fromNewPO > 0) {
    // Need a new PO — project arrival as today + lead time.
    const lead = view.preferredLeadDays ?? FALLBACK_LEAD_DAYS
    arrival = new Date(now.getTime() + lead * 86400000)

    if (scheduledDate && arrival <= scheduledDate) {
      status = 'OK_FROM_INCOMING' // new PO will land in time
      reason = `${fromNewPO} unit(s) need a new PO; ${lead}-day lead lands before due.`
    } else if (scheduledDate && arrival > scheduledDate) {
      // Would miss — but is the lead time still within a reasonable window?
      const daysLate = daysBetween(scheduledDate, arrival)
      if (daysLate <= 7) {
        status = 'AT_RISK'
        reason = `${fromNewPO} unit(s) need a new PO; ${lead}-day lead pushes delivery out ${daysLate} day(s).`
      } else {
        status = 'UNFULFILLABLE'
        reason = `${fromNewPO} unit(s) need a new PO with ${lead}-day lead time — pushes delivery ${daysLate} day(s) past target.`
      }
    } else {
      // No scheduled date; treat as needs-new-PO, surface the date for UI.
      status = 'NEEDS_NEW_PO'
      reason = `${fromNewPO} unit(s) need a new PO; ${lead}-day lead time.`
    }
  } else {
    // Edge case: qty === 0
    status = 'OK_FROM_STOCK'
    reason = 'No quantity on this line.'
    arrival = null
  }

  // Override status when sourcing arrival lands after scheduledDate even from
  // existing POs.
  if (
    status === 'OK_FROM_INCOMING' &&
    scheduledDate &&
    arrival &&
    arrival > scheduledDate
  ) {
    const daysLate = daysBetween(scheduledDate, arrival)
    status = daysLate <= 7 ? 'DELAYED_INCOMING' : 'UNFULFILLABLE'
    reason = `Incoming PO arrives ${daysLate} day(s) after target delivery.`
  }

  const daysToShelf = arrival ? daysBetween(now, arrival) : null

  return { status, sourcing, arrivalDate: arrival, daysToShelf, reason }
}

/**
 * Roll up per-line statuses into an overall verdict.
 */
function rollupOverall(lines: CoLineImpact[]): CoOverallImpact {
  if (lines.length === 0) return 'NONE'
  let anyDelayed = false
  let anyAtRisk = false
  let anyMiss = false
  for (const l of lines) {
    switch (l.status) {
      case 'UNFULFILLABLE':
        anyMiss = true
        break
      case 'AT_RISK':
      case 'SUBSTITUTE_SHORT':
      case 'RELEASE_NOT_FOUND':
        anyAtRisk = true
        break
      case 'DELAYED_INCOMING':
      case 'NEEDS_NEW_PO':
        anyDelayed = true
        break
      case 'MISSING_PRODUCT':
        // Treat unresolved product IDs as at-risk — the caller should see it.
        anyAtRisk = true
        break
      default:
        break
    }
  }
  if (anyMiss) return 'WILL_MISS'
  if (anyAtRisk) return 'AT_RISK'
  if (anyDelayed) return 'DELAYED_BUT_OK'
  return 'NONE'
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface ComputeCoImpactOptions {
  /** Skip the ATP baseline call (used when caller already has it). */
  skipBaseline?: boolean
}

/**
 * Compute the material impact of applying `coLines` to a given Job.
 * Never mutates state. Safe to call repeatedly as the user tweaks lines.
 */
export async function computeCoImpact(
  jobId: string,
  coLines: CoLineInput[],
  opts: ComputeCoImpactOptions = {}
): Promise<CoImpactResult> {
  const now = new Date()

  // Fetch Job header for scheduledDate.
  const jobRows: Array<{
    id: string
    jobNumber: string | null
    scheduledDate: Date | null
  }> = await prisma.$queryRawUnsafe(
    `SELECT "id", "jobNumber", "scheduledDate" FROM "Job" WHERE "id" = $1 LIMIT 1`,
    jobId
  )
  if (jobRows.length === 0) {
    throw new Error(`Job not found: ${jobId}`)
  }
  const job = jobRows[0]
  const scheduledDate = job.scheduledDate ? new Date(job.scheduledDate) : null

  // Optional: run baseline ATP for downstream callers that want it — we don't
  // actually need it to produce the per-line impact (we rebuild the view in
  // loadProductViews). Keep this behind an option so we don't pay for it when
  // the caller doesn't need it.
  let baseline: MaterialStatusLine[] | null = null
  if (!opts.skipBaseline) {
    try {
      const status = await computeJobMaterialStatus(jobId, { shortagesOnly: false })
      baseline = status.lines
    } catch {
      baseline = null
    }
  }

  // Collect every product ID referenced in the CO — original + substitute.
  const pidSet = new Set<string>()
  for (const l of coLines) {
    if (l.productId) pidSet.add(l.productId)
    if (l.substituteProductId) pidSet.add(l.substituteProductId)
  }
  const views = await loadProductViews(jobId, scheduledDate, Array.from(pidSet))

  const resultLines: CoLineImpact[] = []
  let totalNewValue = 0
  let worstArrival: Date | null = null

  for (const line of coLines) {
    const qty = Number(line.qty) || 0

    // Normalize negative/zero inputs — we don't crash, we just mark them.
    if (qty <= 0) {
      const view = views.get(line.productId)
      resultLines.push({
        input: line,
        productId: line.productId,
        sku: view?.sku ?? null,
        productName: view?.productName ?? null,
        qty,
        onHand: view?.onHand ?? 0,
        committedToOthers: view?.committedToOthers ?? 0,
        available: view?.available ?? 0,
        existingAllocation: view?.existingAllocation ?? 0,
        incomingBeforeDue: view?.incomingBeforeDue ?? 0,
        projectedATP: (view?.available ?? 0) + (view?.incomingBeforeDue ?? 0),
        unitCost: view?.unitCost ?? 0,
        sourcing: { fromStock: 0, fromIncoming: 0, fromNewPO: 0 },
        daysToShelf: null,
        arrivalDate: null,
        costDelta: 0,
        status: view ? 'OK_FROM_STOCK' : 'MISSING_PRODUCT',
        reason: view ? 'Zero-qty line; no impact.' : 'Product not found in catalog.',
      })
      continue
    }

    const view = views.get(line.productId)
    if (!view) {
      resultLines.push({
        input: line,
        productId: line.productId,
        sku: null,
        productName: null,
        qty,
        onHand: 0,
        committedToOthers: 0,
        available: 0,
        existingAllocation: 0,
        incomingBeforeDue: 0,
        projectedATP: 0,
        unitCost: 0,
        sourcing: { fromStock: 0, fromIncoming: 0, fromNewPO: qty },
        daysToShelf: null,
        arrivalDate: null,
        costDelta: 0,
        status: 'MISSING_PRODUCT',
        reason: `Product ${line.productId} not found in catalog.`,
      })
      continue
    }

    if (line.type === 'ADD') {
      const c = classifyAdd(view, scheduledDate, qty)
      const costDelta = qty * view.unitCost
      totalNewValue += costDelta
      if (c.arrivalDate && (!worstArrival || c.arrivalDate > worstArrival)) {
        worstArrival = c.arrivalDate
      }
      resultLines.push({
        input: line,
        productId: view.productId,
        sku: view.sku,
        productName: view.productName,
        qty,
        onHand: view.onHand,
        committedToOthers: view.committedToOthers,
        available: view.available,
        existingAllocation: view.existingAllocation,
        incomingBeforeDue: view.incomingBeforeDue,
        projectedATP: view.available + view.incomingBeforeDue,
        unitCost: view.unitCost,
        sourcing: c.sourcing,
        daysToShelf: c.daysToShelf,
        arrivalDate: c.arrivalDate,
        costDelta,
        status: c.status,
        reason: c.reason,
      })
    } else if (line.type === 'REMOVE') {
      const existingAlloc = view.existingAllocation
      let status: CoLineImpactStatus
      let reason: string
      if (existingAlloc >= qty) {
        status = 'RELEASE_OK'
        reason = `Releases ${qty} unit(s) back to available stock.`
      } else if (existingAlloc > 0) {
        status = 'RELEASE_PARTIAL'
        reason = `Only ${existingAlloc} unit(s) currently allocated to this job — release returns those; the remaining ${qty - existingAlloc} were never on the job.`
      } else {
        status = 'RELEASE_NOT_FOUND'
        reason = `No active allocation for this product on this job — nothing to release.`
      }
      const costDelta = -qty * view.unitCost
      totalNewValue += costDelta
      resultLines.push({
        input: line,
        productId: view.productId,
        sku: view.sku,
        productName: view.productName,
        qty,
        onHand: view.onHand,
        committedToOthers: view.committedToOthers,
        available: view.available,
        existingAllocation: existingAlloc,
        incomingBeforeDue: view.incomingBeforeDue,
        projectedATP: view.available + view.incomingBeforeDue,
        unitCost: view.unitCost,
        sourcing: { fromStock: 0, fromIncoming: 0, fromNewPO: 0 },
        daysToShelf: null,
        arrivalDate: null,
        costDelta,
        status,
        reason,
      })
    } else if (line.type === 'SUBSTITUTE') {
      const subPid = line.substituteProductId
      const subView = subPid ? views.get(subPid) : undefined
      if (!subPid || !subView) {
        resultLines.push({
          input: line,
          productId: view.productId,
          sku: view.sku,
          productName: view.productName,
          qty,
          onHand: view.onHand,
          committedToOthers: view.committedToOthers,
          available: view.available,
          existingAllocation: view.existingAllocation,
          incomingBeforeDue: view.incomingBeforeDue,
          projectedATP: view.available + view.incomingBeforeDue,
          unitCost: view.unitCost,
          sourcing: { fromStock: 0, fromIncoming: 0, fromNewPO: qty },
          daysToShelf: null,
          arrivalDate: null,
          costDelta: 0,
          status: 'MISSING_PRODUCT',
          reason: 'Substitute product not resolved — add `substituteProductId` to this line.',
        })
        continue
      }
      // Score the ADD half against the substitute.
      const addResult = classifyAdd(subView, scheduledDate, qty)
      // Cost delta = new cost - old cost (removed from job)
      const costDelta = qty * (subView.unitCost - view.unitCost)
      totalNewValue += costDelta
      if (addResult.arrivalDate && (!worstArrival || addResult.arrivalDate > worstArrival)) {
        worstArrival = addResult.arrivalDate
      }
      let status: CoLineImpactStatus = 'SUBSTITUTE_OK'
      let reason: string = `Swap to ${subView.sku ?? subPid}. ${addResult.reason}`
      if (['AT_RISK', 'UNFULFILLABLE', 'DELAYED_INCOMING'].includes(addResult.status)) {
        status = 'SUBSTITUTE_SHORT'
      }
      resultLines.push({
        input: line,
        productId: view.productId,
        sku: view.sku,
        productName: view.productName,
        substitute: {
          productId: subView.productId,
          sku: subView.sku,
          productName: subView.productName,
        },
        qty,
        onHand: subView.onHand,
        committedToOthers: subView.committedToOthers,
        available: subView.available,
        existingAllocation: view.existingAllocation,
        incomingBeforeDue: subView.incomingBeforeDue,
        projectedATP: subView.available + subView.incomingBeforeDue,
        unitCost: subView.unitCost,
        sourcing: addResult.sourcing,
        daysToShelf: addResult.daysToShelf,
        arrivalDate: addResult.arrivalDate,
        costDelta,
        status,
        reason,
      })
    }
  }

  // Baseline may have independent shortages already — if so and overall picks
  // up nothing from the CO, still flag DELAYED_BUT_OK so the UI reminds the PM
  // the job was already tight.
  const overallImpact = rollupOverall(resultLines)

  // Compute newCompletionDate. If CO doesn't push anything beyond scheduled,
  // we keep scheduledDate. Otherwise we push to the worst arrival.
  let newCompletionDate: Date | null = scheduledDate
  let daysShifted = 0
  if (worstArrival && scheduledDate && worstArrival > scheduledDate) {
    newCompletionDate = worstArrival
    daysShifted = daysBetween(scheduledDate, worstArrival)
  } else if (worstArrival && !scheduledDate) {
    newCompletionDate = worstArrival
    daysShifted = 0
  }

  // Fold in baseline RED lines — if the job was already missing material
  // independent of the CO, note it in the summary so the PM isn't surprised.
  const preExistingRed = baseline
    ? baseline.filter((l) => l.status === 'RED').length
    : 0

  const summary = buildSummary(overallImpact, daysShifted, resultLines.length, preExistingRed)

  return {
    jobId,
    jobNumber: job.jobNumber,
    scheduledDate,
    overallImpact,
    lines: resultLines,
    newCompletionDate,
    totalNewValue,
    daysShifted,
    summary,
    computedAt: now,
  }
}

function buildSummary(
  overall: CoOverallImpact,
  daysShifted: number,
  lineCount: number,
  preExistingRed: number
): string {
  const baseNote =
    preExistingRed > 0
      ? ` Note: job already has ${preExistingRed} short line(s) before this CO.`
      : ''
  switch (overall) {
    case 'NONE':
      return `No delivery impact. All ${lineCount} line(s) fit current inventory.${baseNote}`
    case 'DELAYED_BUT_OK':
      return `Fits the window, but eats the buffer. A PO needs to land before the due date.${baseNote}`
    case 'AT_RISK':
      return daysShifted > 0
        ? `Delivery shifts out ${daysShifted} day(s). New PO or incoming arrival runs past target.${baseNote}`
        : `At risk — one or more lines need a new PO with tight timing.${baseNote}`
    case 'WILL_MISS':
      return daysShifted > 0
        ? `Will miss target by ${daysShifted} day(s) — vendor lead time exceeds the gap.${baseNote}`
        : `Will miss target — cannot source inside vendor lead time.${baseNote}`
  }
}
