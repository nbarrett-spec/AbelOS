export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { getPipelineDemand } from '@/lib/mrp/forecast'

interface ReorderCalibrationResult {
  asOf: string
  productsWithData: number
  productsUpdated: number
  reorderPointChangesGt50Percent: number
  productsMissingData: number
  overstockAlertsCreated: number
  deadStockAlertsCreated: number
  errors: string[]
}

/**
 * GET /api/cron/reorder-calibration — cron trigger (requires CRON_SECRET)
 * POST /api/cron/reorder-calibration — manual trigger (requires staff auth)
 *
 * GAP-4 + GAP-5: Demand-driven reorder point calibration + overstock detection
 *
 * 1. For each active product with InventoryItem + DemandForecast data:
 *    - Calculate avgDailyUsage from actuals (last 90 days)
 *    - Pull avgLeadTimeDays from preferred VendorProduct
 *    - Calculate reorderPoint = ceil(avgDailyUsage * avgLeadTimeDays) + safetyStock
 *    - Calculate safetyStock = ceil(1.65 * stdDevDailyUsage * sqrt(avgLeadTimeDays))
 *    - Update InventoryItem with new reorderPoint, safetyStock, avgDailyUsage, daysOfSupply
 *
 * 2. Detect overstocked items (onHand > maxStock) and create ProcurementAlerts
 *
 * 3. Detect dead stock (onHand > 0 but no allocations in last 90 days)
 *    and create ProcurementAlerts
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runReorderCalibration('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runReorderCalibration('manual')
}

async function runReorderCalibration(
  triggeredBy: 'schedule' | 'manual' = 'schedule'
): Promise<NextResponse<ReorderCalibrationResult>> {
  const runId = await startCronRun('reorder-calibration', triggeredBy)
  const started = Date.now()
  const result: ReorderCalibrationResult = {
    asOf: new Date().toISOString(),
    productsWithData: 0,
    productsUpdated: 0,
    reorderPointChangesGt50Percent: 0,
    productsMissingData: 0,
    overstockAlertsCreated: 0,
    deadStockAlertsCreated: 0,
    errors: [],
  }

  try {
    // Step 1: Get all active products with InventoryItem
    const products: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT
        ii."productId",
        ii."sku",
        ii."productName",
        ii."category",
        ii."onHand",
        ii."unitCost",
        ii."maxStock",
        ii."reorderPoint" AS "currentReorderPoint",
        ii."safetyStock" AS "currentSafetyStock"
      FROM "InventoryItem" ii
      ORDER BY ii."productId"
    `)

    result.productsWithData = products.length

    // Step 2: Process each product
    for (const product of products) {
      try {
        // Get 90-day demand actuals
        const demandRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "actualDemand", "forecastDate"
           FROM "DemandForecast"
           WHERE "productId" = $1
             AND "forecastDate" >= NOW() - INTERVAL '90 days'
             AND "actualDemand" IS NOT NULL
           ORDER BY "forecastDate"`,
          product.productId
        )

        if (demandRows.length === 0) {
          result.productsMissingData++
          continue
        }

        // Calculate avgDailyUsage and stdDevDailyUsage
        const actuals = demandRows.map((r) => Number(r.actualDemand) || 0)
        const avgDailyUsage = actuals.reduce((a, b) => a + b, 0) / actuals.length
        const variance =
          actuals.reduce((sum, val) => sum + Math.pow(val - avgDailyUsage, 2), 0) /
          actuals.length
        const stdDevDailyUsage = Math.sqrt(variance)

        // Get preferred vendor lead time
        const vendorRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "leadTimeDays"
           FROM "VendorProduct"
           WHERE "productId" = $1 AND "preferred" = true
           LIMIT 1`,
          product.productId
        )

        if (vendorRows.length === 0) {
          result.productsMissingData++
          continue
        }

        const avgLeadTimeDays = Number(vendorRows[0].leadTimeDays) || 14

        // Calculate safetyStock: ceil(1.65 * stdDevDailyUsage * sqrt(avgLeadTimeDays))
        // Floor at 2 units minimum for active items
        const safetyStockRaw =
          1.65 * stdDevDailyUsage * Math.sqrt(avgLeadTimeDays)
        const safetyStock = Math.max(2, Math.ceil(safetyStockRaw))

        // GAP-20: Calculate reorderPoint with pipeline demand as a floor
        const basedReorderPoint = Math.ceil(avgDailyUsage * avgLeadTimeDays) + safetyStock
        const pipelineDemand = await getPipelineDemand(product.productId, 30)
        const reorderPoint = Math.max(basedReorderPoint, pipelineDemand)

        // Calculate daysOfSupply: onHand / max(avgDailyUsage, 0.01)
        const daysOfSupply = product.onHand / Math.max(avgDailyUsage, 0.01)

        // Detect if reorder point change > 50%
        const currentROP = Number(product.currentReorderPoint) || 0
        const percentChange = currentROP > 0 ? Math.abs(reorderPoint - currentROP) / currentROP : 1
        if (percentChange > 0.5) {
          result.reorderPointChangesGt50Percent++
        }

        // Update InventoryItem
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem"
           SET "reorderPoint" = $1,
               "safetyStock" = $2,
               "avgDailyUsage" = $3,
               "daysOfSupply" = $4,
               "updatedAt" = NOW()
           WHERE "productId" = $5`,
          reorderPoint,
          safetyStock,
          avgDailyUsage,
          daysOfSupply,
          product.productId
        )

        result.productsUpdated++
      } catch (err: any) {
        result.errors.push(
          `product ${product.sku || product.productId}: ${err?.message || err}`
        )
      }
    }

    // Step 3: Detect and alert on overstocked items
    // Clear old OVERSTOCKED alerts first (items that were over-stocked but are now consumed)
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ProcurementAlert"
       WHERE "type" = 'OVERSTOCKED'
         AND "status" = 'ACTIVE'
         AND (SELECT "onHand" FROM "InventoryItem" WHERE "productId" = "ProcurementAlert"."productId")
              <= (SELECT "maxStock" FROM "InventoryItem" WHERE "productId" = "ProcurementAlert"."productId")`
    )

    const overstockRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "productId", "sku", "productName", "onHand", "maxStock", "unitCost"
      FROM "InventoryItem"
      WHERE "onHand" > "maxStock"
    `)

    for (const item of overstockRows) {
      try {
        const excessUnits = item.onHand - item.maxStock
        const excessValue = excessUnits * (Number(item.unitCost) || 0)

        // Determine priority by excess value
        const priority =
          excessValue > 5000 ? 'HIGH' : excessValue > 1000 ? 'MEDIUM' : 'LOW'

        // Check if alert already exists
        const existingAlert: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "ProcurementAlert"
           WHERE "type" = 'OVERSTOCKED'
             AND "productId" = $1
             AND "status" = 'ACTIVE'
           LIMIT 1`,
          item.productId
        )

        if (existingAlert.length === 0) {
          // Create new alert
          await prisma.$executeRawUnsafe(
            `INSERT INTO "ProcurementAlert"
             ("id", "type", "priority", "title", "message", "productId", "data", "status", "createdAt")
             VALUES (
               gen_random_uuid()::text,
               'OVERSTOCKED',
               $1::text,
               $2,
               $3,
               $4,
               $5::jsonb,
               'ACTIVE',
               NOW()
             )`,
            priority,
            `Overstock: ${item.sku || item.productId}`,
            `${item.productName || 'Product'} has ${excessUnits} excess units (value: $${excessValue.toFixed(2)})`,
            item.productId,
            JSON.stringify({
              excessUnits,
              excessValue,
              onHand: item.onHand,
              maxStock: item.maxStock,
            })
          )

          result.overstockAlertsCreated++
        }
      } catch (err: any) {
        result.errors.push(
          `overstock alert ${item.sku || item.productId}: ${err?.message || err}`
        )
      }
    }

    // Step 4: Detect dead stock
    // Clear old DEAD_STOCK alerts first
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ProcurementAlert"
       WHERE "type" = 'DEAD_STOCK'
         AND "status" = 'ACTIVE'
         AND (SELECT "onHand" FROM "InventoryItem" WHERE "productId" = "ProcurementAlert"."productId") = 0`
    )

    const deadStockRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ii."productId", ii."sku", ii."productName", ii."onHand"
      FROM "InventoryItem" ii
      WHERE ii."onHand" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "InventoryAllocation" ia
          WHERE ia."productId" = ii."productId"
            AND ia."status" IN ('RESERVED', 'PICKED')
            AND ia."createdAt" >= NOW() - INTERVAL '90 days'
        )
    `)

    for (const item of deadStockRows) {
      try {
        // Check if alert already exists
        const existingAlert: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "ProcurementAlert"
           WHERE "type" = 'DEAD_STOCK'
             AND "productId" = $1
             AND "status" = 'ACTIVE'
           LIMIT 1`,
          item.productId
        )

        if (existingAlert.length === 0) {
          // Create new alert
          await prisma.$executeRawUnsafe(
            `INSERT INTO "ProcurementAlert"
             ("id", "type", "priority", "title", "message", "productId", "data", "status", "createdAt")
             VALUES (
               gen_random_uuid()::text,
               'DEAD_STOCK',
               'MEDIUM'::text,
               $1,
               $2,
               $3,
               $4::jsonb,
               'ACTIVE',
               NOW()
             )`,
            `Dead stock: ${item.sku || item.productId}`,
            `${item.productName || 'Product'} has ${item.onHand} units on-hand with no allocation activity in 90 days`,
            item.productId,
            JSON.stringify({
              onHand: item.onHand,
              noActivityDays: 90,
            })
          )

          result.deadStockAlertsCreated++
        }
      } catch (err: any) {
        result.errors.push(
          `dead stock alert ${item.sku || item.productId}: ${err?.message || err}`
        )
      }
    }

    await finishCronRun(
      runId,
      result.errors.length > 0 ? 'FAILURE' : 'SUCCESS',
      Date.now() - started,
      {
        result,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      }
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[reorder-calibration] error:', error)
    result.errors.push(`fatal: ${error?.message || error}`)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      result,
      error: error?.message || String(error),
    })
    return NextResponse.json(result, { status: 500 })
  }
}
