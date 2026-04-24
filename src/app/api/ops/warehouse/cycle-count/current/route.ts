export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/warehouse/cycle-count/current
 *
 * Returns the most recently-created OPEN CycleCountBatch (one per week) plus
 * its lines. If no OPEN batch exists, returns the most recent batch of any
 * status so the UI can show a "closed — next Monday 6AM" state.
 *
 * Shape:
 *   { batch: { id, weekStart, status, totalSkus, completedSkus,
 *              discrepanciesFound, assignedToName, createdAt, closedAt },
 *     lines: [ { id, sku, productName, binLocation, onHand, expectedQty,
 *                countedQty, variance, status, countedAt, countedByName, notes } ] }
 *
 * Degrades cleanly (returns null batch) if tables haven't been created yet —
 * they get materialized on first cron run.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Try OPEN first; fall back to most-recent-of-any-status.
    const batchRows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        b.id,
        b."weekStart",
        b.status,
        b."assignedToId",
        b."totalSkus",
        b."completedSkus",
        b."discrepanciesFound",
        b."createdAt",
        b."closedAt",
        COALESCE(NULLIF(TRIM(s."firstName" || ' ' || s."lastName"), ''), NULL) AS "assignedToName"
      FROM "CycleCountBatch" b
      LEFT JOIN "Staff" s ON s.id = b."assignedToId"
      ORDER BY
        CASE WHEN b.status = 'OPEN' THEN 0 ELSE 1 END,
        b."weekStart" DESC,
        b."createdAt" DESC
      LIMIT 1
    `).catch(() => [])

    if (batchRows.length === 0) {
      return NextResponse.json({ batch: null, lines: [] })
    }

    const batch = batchRows[0]
    const lineRows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        l.id,
        l.sku,
        l."binLocation",
        l."expectedQty",
        l."countedQty",
        l.variance,
        l.status,
        l."countedAt",
        l.notes,
        l."productId",
        p.name AS "productName",
        ii."onHand" AS "liveOnHand",
        COALESCE(NULLIF(TRIM(cb."firstName" || ' ' || cb."lastName"), ''), NULL) AS "countedByName"
      FROM "CycleCountLine" l
      LEFT JOIN "Product" p       ON p.id  = l."productId"
      LEFT JOIN "InventoryItem" ii ON ii."productId" = l."productId"
      LEFT JOIN "Staff" cb         ON cb.id = l."countedById"
      WHERE l."batchId" = $1
      ORDER BY
        CASE WHEN l.status = 'PENDING' THEN 0 ELSE 1 END,
        l.sku ASC
      `,
      batch.id
    ).catch(() => [])

    return NextResponse.json({
      batch: {
        id: batch.id,
        weekStart: batch.weekStart,
        status: batch.status,
        assignedToId: batch.assignedToId,
        assignedToName: batch.assignedToName,
        totalSkus: Number(batch.totalSkus || 0),
        completedSkus: Number(batch.completedSkus || 0),
        discrepanciesFound: Number(batch.discrepanciesFound || 0),
        createdAt: batch.createdAt,
        closedAt: batch.closedAt,
      },
      lines: lineRows.map((l: any) => ({
        id: l.id,
        sku: l.sku,
        productId: l.productId,
        productName: l.productName || '(unknown product)',
        binLocation: l.binLocation,
        expectedQty: Number(l.expectedQty || 0),
        liveOnHand: l.liveOnHand != null ? Number(l.liveOnHand) : null,
        countedQty: l.countedQty != null ? Number(l.countedQty) : null,
        variance: l.variance != null ? Number(l.variance) : null,
        status: l.status,
        countedAt: l.countedAt,
        countedByName: l.countedByName,
        notes: l.notes,
      })),
    })
  } catch (error: any) {
    console.error('[cycle-count/current] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch current cycle-count batch' },
      { status: 500 }
    )
  }
}
