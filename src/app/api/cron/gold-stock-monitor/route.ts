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
    errors: [],
  }

  try {
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
