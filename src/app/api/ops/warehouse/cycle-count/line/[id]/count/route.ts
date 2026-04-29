export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/warehouse/cycle-count/line/[id]/count
 *
 * Body: { countedQty: number, notes?: string }
 *
 * Records the count, computes variance = countedQty - expectedQty, marks the
 * line COUNTED, and updates the parent batch's rollups (completedSkus,
 * discrepanciesFound). Also stamps InventoryItem.lastCountedAt so the same
 * SKU doesn't rotate back into next week's top-20 on the "days since count"
 * factor alone.
 *
 * GAP-17: If variance exceeds threshold (5 units OR 2%), auto-adjust inventory:
 * - Update InventoryItem.onHand to counted value
 * - Recalculate available = onHand - committed
 * - Recalculate daysOfSupply = onHand / avgDailyUsage
 * - Create audit trail entry
 * - If adjustment creates shortage (available < 0), create ProcurementAlert + InboxItem
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const lineId = params.id
  if (!lineId) {
    return NextResponse.json({ error: 'line id required' }, { status: 400 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const countedQtyRaw = body?.countedQty
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 1000) : null
    const staffId = request.headers.get('x-staff-id') || null

    const countedQty = Number(countedQtyRaw)
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      return NextResponse.json(
        { error: 'countedQty must be a non-negative number' },
        { status: 400 }
      )
    }

    audit(request, 'UPDATE', 'CycleCountLine', lineId, {
      action: 'count',
      countedQty,
    }).catch(() => {})

    // Load the line so we know expectedQty + previous state.
    const lineRows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT l.id, l."batchId", l."productId", l."expectedQty", l.status, l."countedQty" AS "prevCountedQty"
      FROM "CycleCountLine" l
      WHERE l.id = $1
      LIMIT 1
      `,
      lineId
    )
    if (lineRows.length === 0) {
      return NextResponse.json({ error: 'line not found' }, { status: 404 })
    }
    const line = lineRows[0]
    const variance = Math.trunc(countedQty - Number(line.expectedQty || 0))
    const wasAlreadyCounted = line.status === 'COUNTED'

    // ─── GAP-17: Cycle count adjustment ───
    // Variance threshold: 5 units OR 2% (whichever is higher)
    const VARIANCE_THRESHOLD_QTY = 5
    const VARIANCE_THRESHOLD_PCT = 0.02
    const expectedQty = Number(line.expectedQty || 0)
    const variancePercent = expectedQty > 0 ? Math.abs(variance) / expectedQty : 1
    const exceedsThreshold =
      Math.abs(variance) >= VARIANCE_THRESHOLD_QTY ||
      variancePercent >= VARIANCE_THRESHOLD_PCT

    // Fetch current inventory state before adjustment
    const invItemBefore: any[] = await prisma.$queryRawUnsafe(
      `SELECT "onHand", "committed", "avgDailyUsage"
         FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`,
      line.productId
    )
    const invBefore = invItemBefore[0] || { onHand: 0, committed: 0, avgDailyUsage: 0 }

    // Single transaction: update line + rollups + inventory adjustments + alerts
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `
        UPDATE "CycleCountLine"
           SET "countedQty"  = $2,
               "variance"    = $3,
               "countedAt"   = NOW(),
               "countedById" = $4,
               "notes"       = COALESCE($5, "notes"),
               "status"      = 'COUNTED'
         WHERE id = $1
        `,
        lineId,
        Math.trunc(countedQty),
        variance,
        staffId,
        notes
      )

      // Only bump batch rollups on the first-time count transition.
      if (!wasAlreadyCounted) {
        await tx.$executeRawUnsafe(
          `
          UPDATE "CycleCountBatch"
             SET "completedSkus"      = "completedSkus" + 1,
                 "discrepanciesFound" = "discrepanciesFound" + CASE WHEN $2 <> 0 THEN 1 ELSE 0 END
           WHERE id = $1
          `,
          line.batchId,
          variance
        )
      } else {
        // If they RE-counted and the variance flipped, reconcile counter
        const prevVariance = Math.trunc(
          Number(line.prevCountedQty ?? 0) - Number(line.expectedQty || 0)
        )
        const delta =
          (variance !== 0 ? 1 : 0) - (prevVariance !== 0 ? 1 : 0)
        if (delta !== 0) {
          await tx.$executeRawUnsafe(
            `
            UPDATE "CycleCountBatch"
               SET "discrepanciesFound" = GREATEST("discrepanciesFound" + $2, 0)
             WHERE id = $1
            `,
            line.batchId,
            delta
          )
        }
      }

      // ─── GAP-17: Auto-adjust inventory if variance exceeds threshold ───
      if (exceedsThreshold) {
        const newOnHand = Math.trunc(countedQty)
        const newAvailable = Math.max(
          0,
          newOnHand - Number(invBefore.committed || 0)
        )
        const avgDaily = Number(invBefore.avgDailyUsage || 0) || 1
        const newDaysOfSupply = avgDaily > 0 ? newOnHand / avgDaily : 0

        await tx.$executeRawUnsafe(
          `
          UPDATE "InventoryItem"
             SET "onHand" = $2,
                 "available" = $3,
                 "daysOfSupply" = $4,
                 "lastAdjustedAt" = NOW(),
                 "adjustmentReason" = 'cycle_count_variance',
                 "updatedAt" = NOW()
           WHERE "productId" = $1
          `,
          line.productId,
          newOnHand,
          newAvailable,
          newDaysOfSupply
        )

        // Create audit trail
        const auditId = `ccadj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await tx.$executeRawUnsafe(
          `
          INSERT INTO "AuditLog" ("id", "entityType", "entityId", "action", "changes", "staffId", "createdAt")
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
          ON CONFLICT DO NOTHING
          `,
          auditId,
          'InventoryItem',
          line.productId,
          'cycle_count_adjustment',
          JSON.stringify({
            expectedQty,
            countedQty: newOnHand,
            variance,
            variancePercent: (variancePercent * 100).toFixed(2) + '%',
            before: { onHand: Number(invBefore.onHand) },
            after: { onHand: newOnHand, available: newAvailable },
          }),
          staffId
        )

        // Check for new shortages
        if (newAvailable < 0) {
          const affectedAllocs: any[] = await tx.$queryRawUnsafe(
            `
            SELECT DISTINCT "jobId" FROM "InventoryAllocation"
            WHERE "productId" = $1 AND "status" IN ('RESERVED', 'PICKED')
            LIMIT 10
            `,
            line.productId
          )

          for (const alloc of affectedAllocs) {
            // Create ProcurementAlert
            const alertId = `pca_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "ProcurementAlert" ("id", "productId", "alertType", "quantity", "severity", "reason", "createdAt", "updatedAt")
              VALUES ($1, $2, 'SHORTAGE', $3, 'HIGH', $4, NOW(), NOW())
              ON CONFLICT DO NOTHING
              `,
              alertId,
              line.productId,
              Math.abs(newAvailable),
              `Cycle count revealed shortage: adjustment created deficit of ${Math.abs(newAvailable)} units`
            )

            // Create InboxItem
            const inboxId = `inbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "InboxItem" ("id", "type", "source", "title", "description",
                                        "priority", "status", "entityType", "entityId",
                                        "createdAt", "updatedAt")
               VALUES ($1, 'MRP_RECOMMENDATION', 'cycle_count', $2, $3,
                       'HIGH', 'PENDING', 'Job', $4, NOW(), NOW())
              `,
              inboxId,
              `Stock shortage discovered on job allocation`,
              `Cycle count adjustment revealed shortage: product inventory now below committed allocations by ${Math.abs(newAvailable)} units`,
              alloc.jobId
            )
          }
        }
      }

      // Stamp InventoryItem.lastCountedAt
      await tx.$executeRawUnsafe(
        `
        UPDATE "InventoryItem"
           SET "lastCountedAt" = NOW()
         WHERE "productId" = $1
        `,
        line.productId
      )
    })

    return NextResponse.json({
      ok: true,
      lineId,
      countedQty: Math.trunc(countedQty),
      variance,
      status: 'COUNTED',
      adjustmentApplied: exceedsThreshold,
    })
  } catch (error: any) {
    console.error('[cycle-count/line/count] error:', error)
    return NextResponse.json(
      { error: 'Failed to record count' },
      { status: 500 }
    )
  }
}
