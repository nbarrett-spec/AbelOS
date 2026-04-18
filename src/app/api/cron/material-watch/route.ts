export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// Material Watch Cron — Runs every 30 minutes
//
// Scans MaterialWatch entries in AWAITING/PARTIAL status and checks current
// inventory levels. When stock is available, marks watches as ARRIVED,
// notifies sales reps, and transitions orders to READY_TO_SHIP.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runMaterialWatchCheck()
}

async function runMaterialWatchCheck() {
  const runId = await startCronRun('material-watch', 'schedule')
  const started = Date.now()
  const result = {
    checked: 0,
    arrived: 0,
    partial: 0,
    ordersReady: 0,
    notificationsSent: 0,
    errors: [] as string[],
  }

  try {
    const now = new Date().toISOString()

    // Ensure table exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MaterialWatch" (
        "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL, "orderItemId" TEXT,
        "productId" TEXT NOT NULL, "jobId" TEXT, "sku" TEXT NOT NULL,
        "productName" TEXT NOT NULL, "qtyNeeded" INT NOT NULL,
        "qtyAvailable" INT NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'AWAITING',
        "notifiedSalesRep" BOOLEAN NOT NULL DEFAULT FALSE,
        "notifiedOps" BOOLEAN NOT NULL DEFAULT FALSE,
        "arrivedAt" TIMESTAMPTZ, "salesRepId" TEXT, "createdById" TEXT,
        "purchaseOrderId" TEXT, "notes" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {})

    // Get all active watches
    const watches: any[] = await prisma.$queryRawUnsafe(`
      SELECT mw."id", mw."orderId", mw."productId", mw."sku", mw."productName",
             mw."qtyNeeded", mw."qtyAvailable", mw."status", mw."salesRepId"
      FROM "MaterialWatch" mw
      WHERE mw."status" IN ('AWAITING', 'PARTIAL')
      ORDER BY mw."createdAt" ASC
      LIMIT 500
    `)

    result.checked = watches.length

    for (const watch of watches) {
      try {
        // Check current inventory
        const inv: any[] = await prisma.$queryRawUnsafe(
          `SELECT "available", "onHand" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`,
          watch.productId
        )

        const currentAvailable = inv[0]?.available || 0

        if (currentAvailable >= watch.qtyNeeded && watch.status !== 'ARRIVED') {
          // Material fully available
          await prisma.$executeRawUnsafe(`
            UPDATE "MaterialWatch"
            SET "status" = 'ARRIVED', "qtyAvailable" = $2, "arrivedAt" = $3::timestamptz, "updatedAt" = $3::timestamptz
            WHERE "id" = $1
          `, watch.id, currentAvailable, now)
          result.arrived++

          // Notify sales rep
          if (watch.salesRepId) {
            await prisma.$executeRawUnsafe(`
              INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "createdAt")
              VALUES ($1, $2, 'SYSTEM'::text, $3, $4, $5, $6::timestamptz)
            `,
              crypto.randomUUID(), watch.salesRepId,
              `Material arrived: ${watch.productName}`,
              `${watch.qtyNeeded} units of ${watch.sku} are now in stock. Order can proceed.`,
              `/ops/orders/${watch.orderId}`,
              now
            ).catch(() => {})
            result.notificationsSent++
          }

          // Check if all watches for this order are fulfilled
          const remaining: any[] = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*)::int AS "pending"
            FROM "MaterialWatch"
            WHERE "orderId" = $1 AND "status" IN ('AWAITING', 'PARTIAL')
          `, watch.orderId)

          if ((remaining[0]?.pending || 0) === 0) {
            await prisma.$executeRawUnsafe(`
              UPDATE "Order"
              SET "status" = 'READY_TO_SHIP', "updatedAt" = NOW()
              WHERE "id" = $1 AND "status"::text = 'AWAITING_MATERIAL'
            `, watch.orderId)
            result.ordersReady++
          }

        } else if (currentAvailable > watch.qtyAvailable && currentAvailable > 0) {
          // Partial progress
          await prisma.$executeRawUnsafe(`
            UPDATE "MaterialWatch"
            SET "status" = 'PARTIAL', "qtyAvailable" = $2, "updatedAt" = $3::timestamptz
            WHERE "id" = $1
          `, watch.id, currentAvailable, now)
          result.partial++
        }
      } catch (err: any) {
        result.errors.push(`Watch ${watch.id}: ${err.message}`)
      }
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    return safeJson(result)
  } catch (error: any) {
    result.errors.push(`Fatal: ${error.message}`)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: error.message })
    return safeJson(result, { status: 500 })
  }
}
