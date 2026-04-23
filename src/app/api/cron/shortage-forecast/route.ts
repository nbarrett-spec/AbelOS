export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'
import {
  computeAllActiveJobsMaterialStatus,
  type MaterialStatusLine,
  type JobMaterialStatus,
} from '@/lib/mrp/atp'

interface ShortageForecastResult {
  asOf: string
  jobsScanned: number
  redLines: number
  amberLines: number
  recommendationsCreated: number
  recommendationsUpdated: number
  recommendationsSkipped: number
  materialWatchUpserts: number
  inboxItemsCreated: number
  totalShortageValue: number
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
    redLines: 0,
    amberLines: 0,
    recommendationsCreated: 0,
    recommendationsUpdated: 0,
    recommendationsSkipped: 0,
    materialWatchUpserts: 0,
    inboxItemsCreated: 0,
    totalShortageValue: 0,
    errors: [],
  }

  try {
    const statuses: JobMaterialStatus[] = await computeAllActiveJobsMaterialStatus()
    result.jobsScanned = statuses.length

    for (const job of statuses) {
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
          await upsertRecommendation(job, line, result)
          await upsertInboxItem(job, line, result)
          await upsertMaterialWatch(job, line, result)
        } catch (err: any) {
          result.errors.push(
            `job=${job.jobId} sku=${line.sku}: ${err?.message || String(err)}`
          )
        }
      }
    }

    await finishCronRun(
      runId,
      result.errors.length > 0 ? 'FAILURE' : 'SUCCESS',
      Date.now() - started,
      { result, error: result.errors.length > 0 ? result.errors.join('; ').slice(0, 3800) : undefined }
    )
    return NextResponse.json(result)
  } catch (error: any) {
    result.errors.push(`fatal: ${error?.message || String(error)}`)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      result,
      error: error?.message || String(error),
    })
    return NextResponse.json(result, { status: 500 })
  }
}

// ─── SmartPORecommendation upsert ───────────────────────────────────────

async function upsertRecommendation(
  job: JobMaterialStatus,
  line: MaterialStatusLine,
  result: ShortageForecastResult
) {
  const scheduledDate = job.scheduledDate
  if (!scheduledDate) return

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
      return
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
    return
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
