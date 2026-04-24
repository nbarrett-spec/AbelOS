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

    // Single transaction: update line + rollups + inventory timestamp.
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
      // Re-submits overwrite the value but don't double-count the rollup.
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
        // If they RE-counted and the variance flipped between zero/non-zero,
        // reconcile the discrepancy counter so it doesn't drift.
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

      // Stamp InventoryItem.lastCountedAt so the risk scorer ages this SKU
      // back out of next week's rotation. Exists-guard so catalog-only
      // products don't blow up.
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
    })
  } catch (error: any) {
    console.error('[cycle-count/line/count] error:', error)
    return NextResponse.json(
      { error: 'Failed to record count' },
      { status: 500 }
    )
  }
}
