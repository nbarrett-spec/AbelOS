export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/cron/dead-stock-report — scheduled (CRON_SECRET)
 * POST /api/cron/dead-stock-report — manual (staff auth)
 *
 * Runs weekly (Friday 5 AM CT / 11 AM UTC). Scans for items where onHand > 0
 * but haven't been consumed in 90+ days, calculates dead capital, and creates
 * a summary inbox item for ops review.
 *
 * Also flags overstock items: onHand > maxStock.
 *
 * Idempotent. Safe to re-run.
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runDeadStockReport('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runDeadStockReport('manual')
}

interface DeadStockItem {
  id: string
  productId: string
  productName: string
  sku: string
  onHand: number
  unitCost: number
  deadValue: number
  lastConsumed: Date | null
  daysOld: number
}

interface OverstockItem {
  productId: string
  productName: string
  sku: string
  onHand: number
  maxStock: number
  overage: number
}

async function runDeadStockReport(triggeredBy: 'schedule' | 'manual') {
  const runId = await startCronRun('dead-stock-report', triggeredBy)
  const started = Date.now()

  try {
    // ─── Find dead stock: onHand > 0 but unused for 90+ days ───
    const deadStockRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ii."id", ii."productId", p."name", p."sku", ii."onHand",
             COALESCE(p."unitCost", 0) AS "unitCost",
             ii."onHand" * COALESCE(p."unitCost", 0) AS "deadValue",
             MAX(mp."createdAt") AS "lastConsumed",
             EXTRACT(DAY FROM NOW() - MAX(mp."createdAt"))::int AS "daysOld"
      FROM "InventoryItem" ii
      JOIN "Product" p ON p."id" = ii."productId"
      LEFT JOIN "MaterialPick" mp ON mp."productId" = ii."productId" AND mp."status" = 'COMPLETED'
      WHERE ii."onHand" > 0
      GROUP BY ii."id", ii."productId", p."name", p."sku", ii."onHand", p."unitCost"
      HAVING MAX(mp."createdAt") < NOW() - INTERVAL '90 days' OR MAX(mp."createdAt") IS NULL
      ORDER BY "deadValue" DESC
      LIMIT 100
    `)

    const deadStockItems: DeadStockItem[] = deadStockRows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.name,
      sku: row.sku,
      onHand: Number(row.onHand),
      unitCost: Number(row.unitCost),
      deadValue: Number(row.deadValue),
      lastConsumed: row.lastConsumed,
      daysOld: row.lastConsumed ? Number(row.daysOld) : 9999, // If null, treat as ancient
    }))

    // ─── Find overstock: onHand > maxStock ───
    const overstockRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ii."productId", p."name", p."sku", ii."onHand", ii."maxStock",
             ii."onHand" - COALESCE(ii."maxStock", 0) AS overage
      FROM "InventoryItem" ii
      JOIN "Product" p ON p."id" = ii."productId"
      WHERE ii."onHand" > COALESCE(ii."maxStock", 0)
      ORDER BY overage DESC
      LIMIT 50
    `)

    const overstockItems: OverstockItem[] = overstockRows.map((row) => ({
      productId: row.productId,
      productName: row.name,
      sku: row.sku,
      onHand: Number(row.onHand),
      maxStock: Number(row.maxStock) || 0,
      overage: Number(row.overage),
    }))

    // ─── Create ProcurementAlerts for top dead items ───
    const topDeadItems = deadStockItems.slice(0, 5)
    for (const item of topDeadItems) {
      const alertId = `pca_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProcurementAlert" ("id", "productId", "alertType", "quantity", "severity", "reason", "createdAt", "updatedAt")
         VALUES ($1, $2, 'OVERSTOCK', $3, 'MEDIUM', $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        alertId,
        item.productId,
        item.onHand,
        `Dead stock detected: unused for ${item.daysOld}+ days; $${item.deadValue.toFixed(2)} tied-up capital`
      )
    }

    // ─── Create summary InboxItem ───
    const totalDeadValue = deadStockItems.reduce((sum, item) => sum + item.deadValue, 0)
    const totalOverstockQty = overstockItems.reduce((sum, item) => sum + item.overage, 0)

    const inboxId = `inbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const summary = `Dead Stock Report: ${deadStockItems.length} items, $${totalDeadValue.toFixed(2)} tied-up. Overstock: ${overstockItems.length} SKUs, ${totalOverstockQty} units over limit.`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" ("id", "type", "source", "title", "description",
                                  "priority", "status", "entityType", "entityId",
                                  "actionData", "createdAt", "updatedAt")
       VALUES ($1, 'INVENTORY_ALERT', 'dead-stock-report', $2, $3,
               'MEDIUM', 'PENDING', 'InventoryItem', 'bulk',
               $4::jsonb, NOW(), NOW())`,
      inboxId,
      'Dead Stock Report',
      summary,
      JSON.stringify({
        deadStockCount: deadStockItems.length,
        totalDeadValue: totalDeadValue.toFixed(2),
        overstockCount: overstockItems.length,
        totalOverstockQty: totalOverstockQty,
        topDeadItems: topDeadItems.map((item) => ({
          sku: item.sku,
          productName: item.productName,
          onHand: item.onHand,
          deadValue: item.deadValue.toFixed(2),
          lastConsumed: item.lastConsumed?.toISOString() || 'Never',
        })),
        topOverstockItems: overstockItems.slice(0, 3).map((item) => ({
          sku: item.sku,
          productName: item.productName,
          onHand: item.onHand,
          maxStock: item.maxStock,
          overage: item.overage,
        })),
      })
    )

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: {
        deadStockCount: deadStockItems.length,
        totalDeadValue: totalDeadValue.toFixed(2),
        overstockCount: overstockItems.length,
        totalOverstockQty: totalOverstockQty,
      },
    })

    return NextResponse.json({
      ok: true,
      deadStockCount: deadStockItems.length,
      totalDeadValue: totalDeadValue.toFixed(2),
      overstockCount: overstockItems.length,
      totalOverstockQty,
    })
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[dead-stock-report] error:', message)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
