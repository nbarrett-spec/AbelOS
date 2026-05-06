export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { runMrpProjection } from '@/lib/mrp'
import { startCronRun, finishCronRun } from '@/lib/cron'

interface MrpNightlyResult {
  asOf: string
  productsProjected: number
  stockoutsFound: number
  recommendationsCreated: number
  recommendationsResolved: number
  errors: string[]
}

/**
 * GET /api/cron/mrp-nightly  — cron trigger (requires CRON_SECRET)
 * POST /api/cron/mrp-nightly — manual trigger (requires staff auth)
 *
 * 1. Run MRP projection
 * 2. Insert SmartPORecommendation rows for new stockouts
 * 3. Resolve stale MRP recommendations whose stockout has been covered by inbound POs
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runMrpNightly('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runMrpNightly('manual')
}

async function runMrpNightly(triggeredBy: 'schedule' | 'manual' = 'schedule'): Promise<NextResponse<MrpNightlyResult>> {
  const runId = await startCronRun('mrp-nightly', triggeredBy)
  const started = Date.now()
  const result: MrpNightlyResult = {
    asOf: new Date().toISOString(),
    productsProjected: 0,
    stockoutsFound: 0,
    recommendationsCreated: 0,
    recommendationsResolved: 0,
    errors: [],
  }

  try {
    const projection = await runMrpProjection({ horizonDays: 90, leadBufferDays: 3 })
    result.productsProjected = projection.products.length

    const stockouts = projection.products.filter(
      (p) => p.stockoutDate !== null && p.preferredVendor
    )
    result.stockoutsFound = stockouts.length

    if (stockouts.length > 0) {
      // Skip products with an existing PENDING MRP rec
      const productIdList = stockouts.map((s) => s.productId)
      const existingRows = await prisma.$queryRawUnsafe<Array<{ productId: string }>>(
        `
        SELECT DISTINCT "productId"
        FROM "SmartPORecommendation"
        WHERE "productId" = ANY($1::text[])
          AND "status" = 'PENDING'
          AND "recommendationType" = 'MRP_FORWARD'
        `,
        productIdList
      )
      const existingSet = new Set(existingRows.map((r) => r.productId))

      for (const item of stockouts) {
        if (existingSet.has(item.productId)) continue

        const vendor = item.preferredVendor!
        const recommendedQty = Math.max(
          item.shortfallQty + item.safetyStock,
          item.reorderQty || 0,
          vendor.minOrderQty || 1,
          1
        )
        const estimatedCost = (vendor.vendorCost || 0) * recommendedQty
        // Urgency now factors in lead time: if poNeededBy is in the past
        // (alreadyLate), bump straight to CRITICAL — we're already eating
        // schedule risk regardless of how many days of stock remain.
        const urgency = item.alreadyLate
          ? 'CRITICAL'
          : (item.daysUntilStockout ?? 999) < 7
            ? 'CRITICAL'
            : (item.daysUntilStockout ?? 999) < 14
              ? 'HIGH'
              : (item.daysUntilStockout ?? 999) < 30
                ? 'NORMAL'
                : 'LOW'

        // Use effectiveLeadDays (Product → VendorProduct → Vendor → 14d) so
        // orderByDate matches what the projection surfaced as poNeededBy.
        const orderByDate = item.poNeededBy
          ? new Date(item.poNeededBy)
          : item.stockoutDate
            ? new Date(
                new Date(item.stockoutDate).getTime() -
                  item.effectiveLeadDays * 86400000
              )
            : new Date()
        const safeOrderByDate = orderByDate < new Date() ? new Date() : orderByDate

        const recId = `mrp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

        try {
          await prisma.$executeRawUnsafe(
            `
            INSERT INTO "SmartPORecommendation" (
              "id", "vendorId", "productId", "productCategory",
              "recommendationType", "urgency", "triggerReason",
              "recommendedQty", "estimatedCost", "estimatedSavings",
              "targetDeliveryDate", "orderByDate",
              "relatedJobIds", "relatedOrderIds",
              "status", "aiConfidence", "aiReasoning",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4,
              'MRP_FORWARD', $5, $6,
              $7, $8, 0,
              $9, $10,
              $11::jsonb, '[]'::jsonb,
              'PENDING', 0.85, $12,
              NOW(), NOW()
            )
            `,
            recId,
            vendor.vendorId,
            item.productId,
            item.category,
            urgency,
            item.alreadyLate
              ? `Nightly MRP: ${item.sku} stocks out ${item.stockoutDate} — vendor lead time ${item.effectiveLeadDays}d, ALREADY LATE to order`
              : `Nightly MRP: ${item.sku} stocks out ${item.stockoutDate} (in ${item.daysUntilStockout}d, lead ${item.effectiveLeadDays}d)`,
            recommendedQty,
            estimatedCost,
            new Date(item.stockoutDate!),
            safeOrderByDate,
            JSON.stringify(item.drivingJobIds),
            `Nightly cron projection: onHand=${item.onHand} totalDemand=${item.totalDemand} totalInbound=${item.totalInbound} ending=${item.endingBalance}`
          )
          result.recommendationsCreated++
        } catch (err: any) {
          result.errors.push(`insert ${item.sku}: ${err?.message || err}`)
        }
      }
    }

    // Resolve stale MRP recommendations: any PENDING MRP_FORWARD rec for a
    // product that is no longer projected to stock out.
    const stockoutProductIds = new Set(stockouts.map((s) => s.productId))
    const allPendingMrp = await prisma.$queryRawUnsafe<
      Array<{ id: string; productId: string }>
    >(
      `
      SELECT "id", "productId"
      FROM "SmartPORecommendation"
      WHERE "status" = 'PENDING'
        AND "recommendationType" = 'MRP_FORWARD'
      `
    )

    const staleIds = allPendingMrp
      .filter((r) => !stockoutProductIds.has(r.productId))
      .map((r) => r.id)

    if (staleIds.length > 0) {
      try {
        await prisma.$executeRawUnsafe(
          `
          UPDATE "SmartPORecommendation"
          SET "status" = 'RESOLVED', "updatedAt" = NOW()
          WHERE "id" = ANY($1::text[])
          `,
          staleIds
        )
        result.recommendationsResolved = staleIds.length
      } catch (err: any) {
        result.errors.push(`resolve stale: ${err?.message || err}`)
      }
    }

    await finishCronRun(runId, result.errors.length > 0 ? 'FAILURE' : 'SUCCESS', Date.now() - started, {
      result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
    })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[mrp-nightly] error:', error)
    result.errors.push(`fatal: ${error?.message || error}`)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      result,
      error: error?.message || String(error),
    })
    return NextResponse.json(result, { status: 500 })
  }
}
