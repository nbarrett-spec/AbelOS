export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { withCronRun } from '@/lib/cron'

/**
 * /api/cron/allocation-health
 *
 * Nightly (3am CT) sweep that keeps the InventoryAllocation ledger honest:
 *   1. Release stranded allocations — any active row whose Job is in a
 *      terminal status (CLOSED / COMPLETE / INVOICED / DELIVERED).
 *   2. Re-run `recompute_inventory_committed()` with no filter so
 *      InventoryItem.committed / .available match the ledger.
 *   3. Write a snapshot into CronRun.result for the observability page.
 *
 * GET  — scheduled trigger (requires CRON_SECRET)
 * POST — manual trigger (requires staff auth)
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runAllocationHealth('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runAllocationHealth('manual')
}

async function runAllocationHealth(triggeredBy: 'schedule' | 'manual'): Promise<NextResponse> {
  return withCronRun('allocation-health', async () => {
    const result: any = {
      asOf: new Date().toISOString(),
      strandedReleased: 0,
      productsRecomputed: 0,
      ledgerTotals: {},
      errors: [] as string[],
    }

    // 1. Release stranded allocations
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(`
        UPDATE "InventoryAllocation" ia
           SET "status" = 'RELEASED',
               "releasedAt" = NOW(),
               "notes" = COALESCE(ia."notes", '') || ' | swept by allocation-health cron',
               "updatedAt" = NOW()
         WHERE ia."status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
           AND ia."jobId" IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM "Job" j
              WHERE j."id" = ia."jobId"
                AND j."status"::text IN ('CLOSED', 'COMPLETE', 'INVOICED', 'DELIVERED')
           )
         RETURNING ia."id", ia."productId"
      `)
      result.strandedReleased = rows.length
    } catch (e: any) {
      result.errors.push('stranded_sweep: ' + e.message)
    }

    // 2. Recompute committed / available
    try {
      const rec: any[] = await prisma.$queryRawUnsafe(
        `SELECT recompute_inventory_committed(NULL) AS touched`
      )
      result.productsRecomputed = Number(rec?.[0]?.touched ?? 0)
    } catch (e: any) {
      result.errors.push('recompute: ' + e.message)
      // Fallback: inline recompute so the sweep still makes progress
      try {
        await prisma.$executeRawUnsafe(`
          UPDATE "InventoryItem" ii
             SET "committed" = COALESCE((
                   SELECT SUM(ia."quantity") FROM "InventoryAllocation" ia
                    WHERE ia."productId" = ii."productId"
                      AND ia."status" IN ('RESERVED', 'PICKED')
                 ), 0),
                 "available" = GREATEST(COALESCE(ii."onHand", 0) - COALESCE((
                   SELECT SUM(ia."quantity") FROM "InventoryAllocation" ia
                    WHERE ia."productId" = ii."productId"
                      AND ia."status" IN ('RESERVED', 'PICKED')
                 ), 0), 0),
                 "updatedAt" = NOW()
        `)
      } catch {}
    }

    // 3. Snapshot of ledger + inventory totals
    try {
      const ledger: any[] = await prisma.$queryRawUnsafe(`
        SELECT status, COUNT(*)::int AS n, SUM("quantity")::int AS qty
          FROM "InventoryAllocation"
         GROUP BY status
      `)
      const totals: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS rows,
          SUM("onHand")::int AS onhand,
          SUM("committed")::int AS committed,
          SUM("available")::int AS available
        FROM "InventoryItem"
      `)
      result.ledgerTotals = {
        byStatus: ledger,
        inventoryItem: totals[0] || {},
      }
    } catch (e: any) {
      result.errors.push('snapshot: ' + e.message)
    }

    return NextResponse.json(result, { status: 200 })
  }, { triggeredBy })
}
