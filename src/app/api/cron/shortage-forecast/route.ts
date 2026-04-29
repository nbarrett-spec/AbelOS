export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'
import {
  computeJobMaterialStatus,
  type MaterialStatusLine,
  type JobMaterialStatus,
} from '@/lib/mrp/atp'

// Leave 60s of headroom below Vercel's 300s hard-kill so finishCronRun()
// is guaranteed to commit. 2026-04-23 had 3 zombie rows because the body
// walked every active job in a single CTE and blew past 300s; per-job loop
// with this budget gets under consistently.
const TIME_BUDGET_MS = 240_000

// Per-run job cap. We sort active jobs by soonest scheduledDate first so
// urgent shortages always get covered; leftovers roll to the next 4-hour
// run. Set high enough that a healthy week clears the backlog and low
// enough that no single run can't finish scanning it.
const MAX_JOBS_PER_RUN = 200

interface ShortageForecastResult {
  asOf: string
  jobsScanned: number
  jobsTotalActive: number
  jobsRemainingNextRun: number
  redLines: number
  amberLines: number
  recommendationsCreated: number
  recommendationsUpdated: number
  recommendationsSkipped: number
  materialWatchUpserts: number
  inboxItemsCreated: number
  autoApprovedPOs: number
  totalShortageValue: number
  budgetExhausted: boolean
  durationMs: number
  errors: string[]
}

/**
 * GET /api/cron/shortage-forecast — cron trigger (CRON_SECRET)
 * POST /api/cron/shortage-forecast — manual trigger (staff auth)
 *
 * ATP shortage forecast + SmartPO auto-populate.
 *
 * Runs every 4 hours. For every active Job:
 *   1. Compute per-line ATP status (GREEN/AMBER/RED)
 *   2. For every RED line: upsert a PENDING SmartPORecommendation
 *      with type='ATP_SHORTAGE'. Idempotent on (vendorId, productId)
 *      within ±3 days of requiredBy.
 *   3. Write an InboxItem (type=MRP_SHORTAGE) for fresh RED lines.
 *   4. Upsert a MaterialWatch row tracking any chronic shortage SKU.
 *
 * Writes a CronRun entry. Registered in vercel.json with schedule 0 * / 4 * * *.
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runShortageForecast('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runShortageForecast('manual')
}

async function runShortageForecast(
  triggeredBy: 'schedule' | 'manual'
): Promise<NextResponse<ShortageForecastResult>> {
  const runId = await startCronRun('shortage-forecast', triggeredBy)
  const started = Date.now()
  const result: ShortageForecastResult = {
    asOf: new Date().toISOString(),
    jobsScanned: 0,
    jobsTotalActive: 0,
    jobsRemainingNextRun: 0,
    redLines: 0,
    amberLines: 0,
    recommendationsCreated: 0,
    recommendationsUpdated: 0,
    recommendationsSkipped: 0,
    materialWatchUpserts: 0,
    inboxItemsCreated: 0,
    autoApprovedPOs: 0,
    totalShortageValue: 0,
    budgetExhausted: false,
    durationMs: 0,
    errors: [],
  }

  try {
    // Pull the most urgent active jobs first (soonest scheduledDate).
    // Capped at MAX_JOBS_PER_RUN; anything past the cap rolls to the next
    // 4-hour run. Order is deterministic so the tail always gets its turn.
    const jobRows = await prisma.$queryRawUnsafe<Array<{ id: string; scheduledDate: Date | null }>>(
      `SELECT "id", "scheduledDate"
         FROM "Job"
        WHERE "status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
          AND "scheduledDate" IS NOT NULL
          AND "orderId" IS NOT NULL
        ORDER BY "scheduledDate" ASC
        LIMIT $1`,
      MAX_JOBS_PER_RUN + 1
    )

    // Separate totalActive count (for observability) by a cheap COUNT —
    // sending the full rowset back is enough for the current cap.
    const totalRow = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
      `SELECT COUNT(*)::bigint AS cnt
         FROM "Job"
        WHERE "status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
          AND "scheduledDate" IS NOT NULL
          AND "orderId" IS NOT NULL`
    )
    result.jobsTotalActive = Number(totalRow[0]?.cnt ?? 0)

    const hasOverflow = jobRows.length > MAX_JOBS_PER_RUN
    const jobsThisRun = hasOverflow ? jobRows.slice(0, MAX_JOBS_PER_RUN) : jobRows

    for (const jobRow of jobsThisRun) {
      // Time-budget check BEFORE the heavy per-job CTE runs. If we're past
      // the budget, stop cleanly so finishCronRun() has room to commit
      // instead of getting hard-killed by Vercel mid-write.
      if (Date.now() - started > TIME_BUDGET_MS) {
        result.budgetExhausted = true
        break
      }

      let job: JobMaterialStatus
      try {
        job = await computeJobMaterialStatus(jobRow.id)
      } catch (err: any) {
        result.errors.push(`job=${jobRow.id}: compute failed: ${err?.message || String(err)}`)
        continue
      }

      result.jobsScanned++
      result.totalShortageValue += job.totalShortageValue

      for (const line of job.lines) {
        if (line.status === 'AMBER') result.amberLines++
        else if (line.status === 'RED') result.redLines++

        // Only act on RED lines with a preferred vendor.
        if (line.status !== 'RED') continue
        if (!line.preferredVendorId) {
          result.errors.push(
            `job=${job.jobId} sku=${line.sku}: RED but no preferred vendor — cannot auto-PO`
          )
          continue
        }

        try {
          const recId = await upsertRecommendation(job, line, result)
          await upsertInboxItem(job, line, result)
          await upsertMaterialWatch(job, line, result)
          // After recommendation is created/updated, check if it qualifies for auto-approve
          if (recId) {
            await tryAutoApprovePO(recId, result)
          }
        } catch (err: any) {
          result.errors.push(
            `job=${job.jobId} sku=${line.sku}: ${err?.message || String(err)}`
          )
        }
      }
    }

    result.jobsRemainingNextRun = Math.max(
      0,
      result.jobsTotalActive - result.jobsScanned
    )
    result.durationMs = Date.now() - started

    // Partial coverage or per-job errors are still SUCCESS — SmartPO
    // inserts are idempotent and the next run picks up the rest.
    // Mark FAILURE only if EVERY job failed or the run itself threw.
    const isFailure =
      result.jobsScanned === 0 && jobsThisRun.length > 0 && result.errors.length > 0

    await finishCronRun(
      runId,
      isFailure ? 'FAILURE' : 'SUCCESS',
      result.durationMs,
      {
        result,
        error: result.errors.length > 0 ? result.errors.join('; ').slice(0, 3800) : undefined,
      }
    )
    return NextResponse.json(result)
  } catch (error: any) {
    result.errors.push(`fatal: ${error?.message || String(error)}`)
    result.durationMs = Date.now() - started
    await finishCronRun(runId, 'FAILURE', result.durationMs, {
      result,
      error: error?.message || String(error),
    })
    return NextResponse.json(result, { status: 500 })
  }
}

// ─── Auto-Approve for CRITICAL, high confidence, low cost ──────────────

async function tryAutoApprovePO(
  recId: string,
  result: ShortageForecastResult
): Promise<void> {
  // Fetch the recommendation
  const rec = await prisma.$queryRawUnsafe<
    Array<{ id: string; urgency: string; aiConfidence: number; estimatedCost: number; vendorId: string; productId: string; recommendedQty: number; relatedJobIds: any }>
  >(
    `
    SELECT "id", "urgency", "aiConfidence", "estimatedCost", "vendorId", "productId", "recommendedQty", "relatedJobIds"
    FROM "SmartPORecommendation"
    WHERE "id" = $1 AND "status" = 'PENDING'
    LIMIT 1
    `,
    recId
  )

  if (rec.length === 0) return

  const r = rec[0]
  const aiConf = r.aiConfidence || 0
  const cost = r.estimatedCost || 0

  // Criteria for auto-approve:
  // 1. urgency = CRITICAL
  // 2. aiConfidence > 0.85
  // 3. estimatedCost < 2000
  if (r.urgency !== 'CRITICAL' || aiConf <= 0.85 || cost >= 2000) {
    return
  }

  // Auto-approve: create a draft PO from the recommendation
  try {
    const poId = await createDraftPOFromRecommendation(r)
    if (poId) {
      // Update recommendation
      await prisma.$executeRawUnsafe(
        `
        UPDATE "SmartPORecommendation"
        SET "status" = 'AUTO_APPROVED', "convertedPOId" = $1, "updatedAt" = NOW()
        WHERE "id" = $2
        `,
        poId,
        recId
      )

      // Get job numbers for notification
      const jobIds = Array.isArray(r.relatedJobIds) ? (r.relatedJobIds as string[]) : []
      const jobNumber = jobIds.length > 0 ? `Job ${jobIds[0]}` : 'Job'

      // Create inbox notification for ops
      const notifId = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "InboxItem" (
          "id", "type", "source", "title", "description", "priority", "status",
          "entityType", "entityId", "actionData", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'PO_AUTO_APPROVED', 'shortage-forecast', $2, $3, 'HIGH', 'PENDING',
          'PurchaseOrder', $4, $5::jsonb, NOW(), NOW()
        )
        `,
        notifId,
        `Auto-PO Created: ${poId.slice(0, 8)} (Critical Shortage)`,
        `Auto-approved PO for critical shortage affecting ${jobNumber}. Cost: $${cost.toFixed(2)}. Verify and release to vendor.`,
        poId,
        JSON.stringify({
          poId,
          recommendationId: recId,
          cost,
          urgency: r.urgency,
        })
      )

      result.autoApprovedPOs++
    }
  } catch (err: any) {
    result.errors.push(`auto-approve ${recId}: ${err?.message || String(err)}`)
  }
}

async function createDraftPOFromRecommendation(rec: {
  id: string
  vendorId: string
  productId: string
  recommendedQty: number
  estimatedCost: number
}): Promise<string | null> {
  // Get vendor and product info
  const vendor = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string }>
  >(
    `SELECT "id", "name" FROM "Vendor" WHERE "id" = $1 AND active = TRUE LIMIT 1`,
    rec.vendorId
  )

  if (vendor.length === 0) return null

  const product = await prisma.$queryRawUnsafe<
    Array<{ id: string; sku: string | null; name: string | null }>
  >(
    `SELECT "id", "sku", "name" FROM "Product" WHERE "id" = $1 LIMIT 1`,
    rec.productId
  )

  if (product.length === 0) return null

  const vendorProduct = await prisma.$queryRawUnsafe<
    Array<{ vendorSku: string; vendorCost: number }>
  >(
    `
    SELECT "vendorSku", "vendorCost"
    FROM "VendorProduct"
    WHERE "vendorId" = $1 AND "productId" = $2 AND preferred = TRUE
    LIMIT 1
    `,
    rec.vendorId,
    rec.productId
  )

  const vendorSku = vendorProduct.length > 0 ? vendorProduct[0].vendorSku : product[0].sku || 'N/A'
  const unitCost = vendorProduct.length > 0 ? vendorProduct[0].vendorCost : (rec.estimatedCost / rec.recommendedQty)

  // Generate PO number
  const currentYear = new Date().getFullYear()
  const lastPO = await prisma.$queryRawUnsafe<Array<{ poNumber: string }>>(
    `
    SELECT "poNumber" FROM "PurchaseOrder"
    WHERE "poNumber" LIKE $1
    ORDER BY "poNumber" DESC
    LIMIT 1
    `,
    `PO-${currentYear}-%`
  )

  let nextSequence = 1
  if (lastPO.length > 0) {
    const parts = lastPO[0].poNumber.split('-')
    if (parts.length === 3) {
      const seq = parseInt(parts[2], 10)
      if (!isNaN(seq)) nextSequence = seq + 1
    }
  }

  const poNumber = `PO-${currentYear}-${String(nextSequence).padStart(4, '0')}`
  const poId = `po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  // Create PurchaseOrder in DRAFT status
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "PurchaseOrder" (
      "id", "poNumber", "vendorId", "status", "subtotal", "shippingCost", "total",
      "notes", "aiGenerated", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, 'DRAFT', $4, 0, $5,
      $6, TRUE, NOW(), NOW()
    )
    `,
    poId,
    poNumber,
    rec.vendorId,
    rec.estimatedCost,
    rec.estimatedCost,
    `Auto-generated from SmartPO recommendation ${rec.id}`
  )

  // Create PurchaseOrderItem
  const itemId = `poi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "PurchaseOrderItem" (
      "id", "purchaseOrderId", "productId", "vendorSku", "description",
      "quantity", "unitCost", "lineTotal", "receivedQty", "damagedQty",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, 0, 0,
      NOW(), NOW()
    )
    `,
    itemId,
    poId,
    rec.productId,
    vendorSku,
    product[0].name || product[0].sku || 'Unknown Product',
    rec.recommendedQty,
    unitCost,
    rec.estimatedCost
  )

  return poId
}

// ─── SmartPORecommendation upsert ───────────────────────────────────────

async function upsertRecommendation(
  job: JobMaterialStatus,
  line: MaterialStatusLine,
  result: ShortageForecastResult
): Promise<string | null> {
  const scheduledDate = job.scheduledDate
  if (!scheduledDate) return null

  const leadDays = line.preferredVendorLeadDays || 14
  const requiredBy = new Date(scheduledDate.getTime() - leadDays * 86400000)
  const safeRequiredBy = requiredBy < new Date() ? new Date() : requiredBy

  const recommendedQty = Math.max(line.shortfall, line.reorderQty || 0, 1)
  const unitCost = line.preferredVendorCost || 0
  const estimatedCost = unitCost * recommendedQty

  const urgency = daysUntil(scheduledDate) < 7 ? 'CRITICAL' : 'HIGH'

  // Idempotency: find existing PENDING ATP_SHORTAGE rec for same
  // (vendor, product) within ±3 days of our requiredBy.
  const existing = await prisma.$queryRawUnsafe<
    Array<{ id: string; recommendedQty: number; relatedJobIds: any }>
  >(
    `
    SELECT "id", "recommendedQty", "relatedJobIds"
    FROM "SmartPORecommendation"
    WHERE "status" = 'PENDING'
      AND "recommendationType" = 'ATP_SHORTAGE'
      AND "vendorId" = $1
      AND "productId" = $2
      AND "orderByDate" BETWEEN ($3::timestamp - INTERVAL '3 days')
                             AND ($3::timestamp + INTERVAL '3 days')
    LIMIT 1
    `,
    line.preferredVendorId,
    line.productId,
    safeRequiredBy
  )

  if (existing.length > 0) {
    const row = existing[0]
    // Merge job ID into relatedJobIds and bump qty if higher.
    const related: string[] = Array.isArray(row.relatedJobIds)
      ? (row.relatedJobIds as string[])
      : []
    const merged = Array.from(new Set([...related, job.jobId]))
    const newQty = Math.max(Number(row.recommendedQty) || 0, recommendedQty)
    const newCost = unitCost * newQty

    if (newQty === Number(row.recommendedQty) && merged.length === related.length) {
      result.recommendationsSkipped++
      return row.id
    }
    await prisma.$executeRawUnsafe(
      `
      UPDATE "SmartPORecommendation"
      SET "recommendedQty" = $1,
          "estimatedCost" = $2,
          "relatedJobIds" = $3::jsonb,
          "urgency" = CASE WHEN $4 = 'CRITICAL' THEN 'CRITICAL' ELSE "urgency" END,
          "updatedAt" = NOW()
      WHERE "id" = $5
      `,
      newQty,
      newCost,
      JSON.stringify(merged),
      urgency,
      row.id
    )
    result.recommendationsUpdated++
    return row.id
  }

  const recId = `atp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "SmartPORecommendation" (
      "id", "vendorId", "productId",
      "recommendationType", "urgency", "triggerReason",
      "recommendedQty", "estimatedCost", "estimatedSavings",
      "targetDeliveryDate", "orderByDate",
      "relatedJobIds", "relatedOrderIds",
      "status", "aiConfidence", "aiReasoning",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3,
      'ATP_SHORTAGE', $4, $5,
      $6, $7, 0,
      $8, $9,
      $10::jsonb, '[]'::jsonb,
      'PENDING', 0.90, $11,
      NOW(), NOW()
    )
    `,
    recId,
    line.preferredVendorId,
    line.productId,
    urgency,
    `ATP shortage: Job ${job.jobNumber || job.jobId} short ${line.shortfall} × ${line.sku} by ${scheduledDate.toISOString().slice(0, 10)}`,
    Math.round(recommendedQty),
    estimatedCost,
    scheduledDate,
    safeRequiredBy,
    JSON.stringify([job.jobId]),
    `ATP forecast: required=${line.required.toFixed(0)} allocated=${line.allocated.toFixed(0)} onHand=${line.onHand} committedToOthers=${line.committedToOthers.toFixed(0)} projectedATP=${line.projectedATP.toFixed(0)} shortfall=${line.shortfall.toFixed(0)}`
  )
  result.recommendationsCreated++
  return recId
}

// ─── InboxItem ──────────────────────────────────────────────────────────

async function upsertInboxItem(
  job: JobMaterialStatus,
  line: MaterialStatusLine,
  result: ShortageForecastResult
) {
  // Idempotency key = entityType + entityId + entityId segment.
  // We store productId:jobId as entityId to keep it globally unique and
  // allow one-item-per-product-per-job.
  const entityId = `${line.productId}:${job.jobId}`
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT "id" FROM "InboxItem"
    WHERE "type" = 'MRP_SHORTAGE'
      AND "entityType" = 'JobMaterialLine'
      AND "entityId" = $1
      AND "status" = 'PENDING'
    LIMIT 1
    `,
    entityId
  )
  if (existing.length > 0) return

  const priority = line.status === 'RED'
    ? (daysUntil(job.scheduledDate) < 7 ? 'CRITICAL' : 'HIGH')
    : 'HIGH'

  const dueBy = job.scheduledDate
    ? new Date(job.scheduledDate.getTime() - (line.preferredVendorLeadDays || 14) * 86400000)
    : null

  const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "InboxItem" (
      "id", "type", "source", "title", "description", "priority", "status",
      "entityType", "entityId", "financialImpact",
      "actionData", "dueBy", "createdAt", "updatedAt"
    ) VALUES (
      $1, 'MRP_SHORTAGE', 'mrp-shortage-forecast', $2, $3, $4, 'PENDING',
      'JobMaterialLine', $5, $6,
      $7::jsonb, $8, NOW(), NOW()
    )
    `,
    id,
    `Short ${Math.round(line.shortfall)} × ${line.sku} for ${job.jobNumber || 'Job'} (${job.builderName || ''})`,
    `Required ${line.required.toFixed(0)} by ${job.scheduledDate?.toISOString().slice(0, 10)}, on hand ${line.onHand}, allocated ${line.allocated.toFixed(0)}, projected ATP ${line.projectedATP.toFixed(0)}. Recommend ${line.recommendation} via ${line.preferredVendorName || 'preferred vendor'}.`,
    priority,
    entityId,
    line.estShortageValue,
    JSON.stringify({
      jobId: job.jobId,
      productId: line.productId,
      sku: line.sku,
      shortfall: line.shortfall,
      recommendation: line.recommendation,
      vendorId: line.preferredVendorId,
    }),
    dueBy
  )
  result.inboxItemsCreated++

  // GAP-14: Create PM-targeted notification if job has assigned PM
  if (job.jobId && line.status === 'RED') {
    const pmRow = await prisma.$queryRawUnsafe<Array<{ assignedPMId: string | null }>>(
      `SELECT "assignedPMId" FROM "Job" WHERE "id" = $1 LIMIT 1`,
      job.jobId
    )
    const pmId = pmRow[0]?.assignedPMId

    if (pmId) {
      const pmInboxId = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      // Create a PM-specific inbox item (could set assignedTo or use type variation)
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "InboxItem" (
          "id", "type", "source", "title", "description", "priority", "status",
          "entityType", "entityId", "financialImpact",
          "actionData", "dueBy", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'PM_MATERIAL_ALERT', 'mrp-shortage-forecast', $2, $3, $4, 'PENDING',
          'JobMaterialLine', $5, $6,
          $7::jsonb, $8, NOW(), NOW()
        )
        `,
        pmInboxId,
        `Material Short: ${line.sku} for ${job.jobNumber}`,
        `Your job ${job.jobNumber} (${job.community}) is short ${Math.round(line.shortfall)} units of ${line.productName || line.sku}. Due date: ${job.scheduledDate?.toISOString().slice(0, 10)}. Coordinate with operations to expedite.`,
        priority,
        entityId,
        line.estShortageValue,
        JSON.stringify({
          jobId: job.jobId,
          productId: line.productId,
          sku: line.sku,
          assignedPmId: pmId,
          shortfall: line.shortfall,
        }),
        dueBy
      )
    }
  }
}

// ─── MaterialWatch (Phase 4) ────────────────────────────────────────────

async function upsertMaterialWatch(
  job: JobMaterialStatus,
  line: MaterialStatusLine,
  result: ShortageForecastResult
) {
  // For every RED line we keep a MaterialWatch entry keyed roughly by
  // (orderId or jobId) + productId. If one exists in AWAITING/PARTIAL,
  // bump its qtyNeeded to the max observed; otherwise create a new one.
  const orderIdRow = await prisma.$queryRawUnsafe<Array<{ orderId: string | null }>>(
    `SELECT "orderId" FROM "Job" WHERE "id" = $1 LIMIT 1`,
    job.jobId
  )
  const orderId = orderIdRow[0]?.orderId || job.jobId // fall back to jobId to keep NOT NULL happy

  const existing = await prisma.$queryRawUnsafe<
    Array<{ id: string; qtyNeeded: number }>
  >(
    `
    SELECT "id", "qtyNeeded"
    FROM "MaterialWatch"
    WHERE "jobId" = $1
      AND "productId" = $2
      AND "status" IN ('AWAITING','PARTIAL')
    LIMIT 1
    `,
    job.jobId,
    line.productId
  )

  if (existing.length > 0) {
    const row = existing[0]
    const newQty = Math.max(Number(row.qtyNeeded) || 0, Math.round(line.shortfall))
    if (newQty === Number(row.qtyNeeded)) return
    await prisma.$executeRawUnsafe(
      `UPDATE "MaterialWatch"
         SET "qtyNeeded" = $1,
             "updatedAt" = NOW()
       WHERE "id" = $2`,
      newQty,
      row.id
    )
    result.materialWatchUpserts++
    return
  }

  const mwId = `mw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "MaterialWatch" (
      "id", "orderId", "productId", "jobId",
      "sku", "productName", "qtyNeeded", "qtyAvailable",
      "status", "notes", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      'AWAITING', $9, NOW(), NOW()
    )
    `,
    mwId,
    orderId,
    line.productId,
    job.jobId,
    line.sku,
    line.productName,
    Math.round(line.shortfall),
    line.available,
    `ATP forecast RED: shortfall=${line.shortfall.toFixed(0)} scheduledDate=${job.scheduledDate?.toISOString().slice(0, 10)} recommendation=${line.recommendation}`
  )
  result.materialWatchUpserts++
}

// ─── Helpers ────────────────────────────────────────────────────────────

function daysUntil(d: Date | null): number {
  if (!d) return 999
  const ms = d.getTime() - Date.now()
  return Math.max(0, Math.floor(ms / 86400000))
}
