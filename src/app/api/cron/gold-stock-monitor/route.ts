export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'

interface GoldStockMonitorResult {
  asOf: string
  kitsChecked: number
  buildReadyItems: number
  shortItems: number
  goldStockReplenishRecommendations: number
  goldStockHealth: {
    totalKits: number
    activeKits: number
    kitsAboveMin: number
    kitsBelowMin: number
    avgHealthPercent: number
  }
  errors: string[]
}

/**
 * GET /api/cron/gold-stock-monitor  — cron trigger (requires CRON_SECRET)
 * POST /api/cron/gold-stock-monitor — manual trigger (requires staff auth)
 *
 * Daily sweep of active GoldStockKits. For each kit where currentQty < minQty:
 *   - If every component is available (onHand >= need for one kit): create
 *     an InboxItem (GOLD_STOCK_BUILD_READY) assigned to the first WAREHOUSE_LEAD.
 *   - Otherwise create a GOLD_STOCK_COMPONENTS_SHORT InboxItem so purchasing
 *     can pull the missing SKUs.
 *
 * GAP-19: For each component below safetyStock, auto-create SmartPORecommendation
 * with source='GOLD_STOCK_REPLENISH'. If the component has a preferred vendor,
 * auto-set vendorId on the recommendation.
 *
 * Dedupes against existing PENDING InboxItems for the same kit so we don't
 * spam the inbox on every tick.
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runMonitor('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runMonitor('manual')
}

async function runMonitor(
  triggeredBy: 'schedule' | 'manual' = 'schedule'
): Promise<NextResponse<GoldStockMonitorResult>> {
  const runId = await startCronRun('gold-stock-monitor', triggeredBy)
  const started = Date.now()
  const result: GoldStockMonitorResult = {
    asOf: new Date().toISOString(),
    kitsChecked: 0,
    buildReadyItems: 0,
    shortItems: 0,
    goldStockReplenishRecommendations: 0,
    goldStockHealth: {
      totalKits: 0,
      activeKits: 0,
      kitsAboveMin: 0,
      kitsBelowMin: 0,
      avgHealthPercent: 0,
    },
    errors: [],
  }

  try {
    // GAP-19: Health summary — all ACTIVE kits
    const allKits: Array<{
      id: string
      kitCode: string
      minQty: number
      currentQty: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT "id", "kitCode", "minQty", "currentQty", "status"
      FROM "GoldStockKit"
      WHERE "status" = 'ACTIVE'
    `)
    result.goldStockHealth.totalKits = allKits.length
    result.goldStockHealth.activeKits = allKits.filter((k: any) => k.status === 'ACTIVE').length

    const healthMetrics = allKits.map((k) => ({
      kitCode: k.kitCode,
      health: k.minQty > 0 ? Math.min(100, Math.round((k.currentQty / k.minQty) * 100)) : 100,
      isBelowMin: k.currentQty < k.minQty,
    }))
    result.goldStockHealth.kitsAboveMin = healthMetrics.filter((m) => !m.isBelowMin).length
    result.goldStockHealth.kitsBelowMin = healthMetrics.filter((m) => m.isBelowMin).length
    result.goldStockHealth.avgHealthPercent = healthMetrics.length > 0
      ? Math.round(healthMetrics.reduce((a, m) => a + m.health, 0) / healthMetrics.length)
      : 100

    // All ACTIVE kits below minQty
    const kits: Array<{
      id: string
      kitCode: string
      kitName: string
      minQty: number
      reorderQty: number
      currentQty: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT "id", "kitCode", "kitName", "minQty", "reorderQty", "currentQty"
      FROM "GoldStockKit"
      WHERE "status" = 'ACTIVE'
        AND "currentQty" < "minQty"
    `)
    result.kitsChecked = kits.length

    if (kits.length === 0) {
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
      return NextResponse.json(result)
    }

    // Find one warehouse lead to assign inbox items to.
    const lead: Array<{ id: string }> = await prisma.$queryRawUnsafe(`
      SELECT "id" FROM "Staff"
      WHERE "role" = 'WAREHOUSE_LEAD' AND "active" = true
      ORDER BY "createdAt" ASC
      LIMIT 1
    `)
    const assignedTo = lead[0]?.id ?? null

    for (const kit of kits) {
      try {
        // Pull components + current onHand
        const comps: Array<{
          productId: string
          quantity: number
          onHand: number
          available: number
          sku: string
          name: string
        }> = await prisma.$queryRawUnsafe(
          `
          SELECT gkc."productId",
                 gkc."quantity"::int AS "quantity",
                 COALESCE(ii."onHand", 0)::int AS "onHand",
                 COALESCE(ii."available", 0)::int AS "available",
                 p."sku",
                 p."name"
          FROM "GoldStockKitComponent" gkc
          JOIN "Product" p ON p."id" = gkc."productId"
          LEFT JOIN "InventoryItem" ii ON ii."productId" = gkc."productId"
          WHERE gkc."kitId" = $1
          `,
          kit.id
        )

        if (comps.length === 0) continue

        // Short count: how many components can't cover even one kit build?
        const shortages = comps
          .filter((c) => c.available < c.quantity)
          .map((c) => ({
            sku: c.sku,
            name: c.name,
            need: c.quantity,
            have: c.available,
            short: c.quantity - c.available,
          }))

        const allAvailable = shortages.length === 0
        const type = allAvailable
          ? 'GOLD_STOCK_BUILD_READY'
          : 'GOLD_STOCK_COMPONENTS_SHORT'

        // Dedupe: skip if a PENDING inbox row for this kit+type already exists
        const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "InboxItem"
             WHERE "type" = $1 AND "entityType" = 'GoldStockKit'
               AND "entityId" = $2 AND "status" = 'PENDING'
             LIMIT 1`,
          type,
          kit.id
        )
        if (existing.length > 0) continue

        const priority = allAvailable ? 'MEDIUM' : 'HIGH'
        const title = allAvailable
          ? `Pre-build ${kit.reorderQty}× ${kit.kitCode}`
          : `Gold stock blocked: ${kit.kitCode} short ${shortages.length} SKU(s)`
        const description = allAvailable
          ? `${kit.kitName}. currentQty=${kit.currentQty} < minQty=${kit.minQty}. All components in stock — safe to build ${kit.reorderQty} kits.`
          : `${kit.kitName}. currentQty=${kit.currentQty} < minQty=${kit.minQty}. Components short: ${shortages.map((s) => `${s.sku} (need ${s.need}, have ${s.have})`).join('; ')}`

        const id = `ii_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InboxItem"
            ("id", "type", "source", "title", "description",
             "priority", "status", "entityType", "entityId",
             "assignedTo", "actionData", "createdAt", "updatedAt")
           VALUES ($1, $2, 'gold-stock-monitor', $3, $4,
                   $5, 'PENDING', 'GoldStockKit', $6,
                   $7, $8::jsonb, NOW(), NOW())`,
          id,
          type,
          title,
          description,
          priority,
          kit.id,
          assignedTo,
          JSON.stringify({
            kitId: kit.id,
            kitCode: kit.kitCode,
            reorderQty: kit.reorderQty,
            minQty: kit.minQty,
            currentQty: kit.currentQty,
            shortages,
          })
        )

        // GAP-19: Auto-create SmartPORecommendation for components below safetyStock
        if (!allAvailable) {
          for (const shortage of shortages) {
            try {
              // Find the product ID and preferred vendor
              const prodData: Array<{
                productId: string
                preferredVendorId: string | null
              }> = await prisma.$queryRawUnsafe(
                `SELECT p."id" as "productId", vp."vendorId" as "preferredVendorId"
                 FROM "Product" p
                 LEFT JOIN "VendorProduct" vp ON vp."productId" = p."id" AND vp."isPreferred" = true
                 WHERE p."sku" = $1
                 LIMIT 1`,
                shortage.sku
              )

              if (prodData.length > 0) {
                const prodId = prodData[0].productId
                const vendorId = prodData[0].preferredVendorId

                // Check if recommendation already exists for this product (PENDING or APPROVED)
                const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
                  `SELECT "id" FROM "SmartPORecommendation"
                   WHERE "productId" = $1 AND "status" IN ('PENDING', 'APPROVED')
                   LIMIT 1`,
                  prodId
                )

                if (existing.length === 0) {
                  const recId = `spr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
                  await prisma.$executeRawUnsafe(
                    `INSERT INTO "SmartPORecommendation"
                      ("id", "vendorId", "productId", "recommendationType",
                       "urgency", "triggerReason", "recommendedQty",
                       "status", "createdAt", "updatedAt")
                     VALUES ($1, $2, $3, 'REPLENISH', 'URGENT',
                             $4, $5, 'PENDING', NOW(), NOW())`,
                    recId,
                    vendorId || '', // Will use null if no preferred vendor
                    prodId,
                    `Gold Stock kit component limiting factor: ${kit.kitCode} needs ${shortage.need}, have ${shortage.have}`,
                    Math.max(1, Math.ceil(shortage.short * 1.5)) // Recommend 1.5x shortage quantity
                  )
                  result.goldStockReplenishRecommendations++

                  // Create inbox alert for the limiting component
                  const alertId = `ii_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
                  await prisma.$executeRawUnsafe(
                    `INSERT INTO "InboxItem"
                      ("id", "type", "source", "title", "description",
                       "priority", "status", "entityType", "entityId",
                       "assignedTo", "createdAt", "updatedAt")
                     VALUES ($1, 'GOLD_STOCK_LIMITING_COMPONENT', 'gold-stock-monitor', $2, $3,
                             'HIGH', 'PENDING', 'Product', $4,
                             $5, NOW(), NOW())`,
                    alertId,
                    `${kit.kitCode} limited by ${shortage.sku}`,
                    `Gold Stock kit ${kit.kitCode} limited to ${Math.floor(shortage.have / shortage.need)} complete kits. ${shortage.sku} is limiting factor (need ${shortage.need}, have ${shortage.have}).`,
                    prodId,
                    assignedTo // Assign to same warehouse lead or purchasing
                  )
                }
              }
            } catch (e: any) {
              result.errors.push(`replenish recommendation for ${shortage.sku}: ${e?.message || String(e)}`)
            }
          }
        }

        if (allAvailable) result.buildReadyItems++
        else result.shortItems++
      } catch (e: any) {
        result.errors.push(`kit ${kit.kitCode}: ${e?.message || String(e)}`)
      }
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    return NextResponse.json(result)
  } catch (e: any) {
    result.errors.push(e?.message || String(e))
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: e?.message,
    })
    return NextResponse.json(result, { status: 500 })
  }
}
