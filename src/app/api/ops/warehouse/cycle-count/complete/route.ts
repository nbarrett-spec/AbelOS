export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/warehouse/cycle-count/complete
 *
 * Body: { batchId: string }
 *
 * Closes a CycleCountBatch once all 20 lines are COUNTED. Rejects with 409 if
 * any lines are still PENDING so the warehouse can't accidentally sign off on
 * an incomplete sweep. Stamps closedAt and flips the inbox item resolved.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const batchId = typeof body?.batchId === 'string' ? body.batchId : null
    const staffId = request.headers.get('x-staff-id') || null

    if (!batchId) {
      return NextResponse.json({ error: 'batchId required' }, { status: 400 })
    }

    audit(request, 'UPDATE', 'CycleCountBatch', batchId, {
      action: 'complete',
    }).catch(() => {})

    const batchRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, status, "totalSkus", "completedSkus" FROM "CycleCountBatch" WHERE id = $1 LIMIT 1`,
      batchId
    )
    if (batchRows.length === 0) {
      return NextResponse.json({ error: 'batch not found' }, { status: 404 })
    }
    const batch = batchRows[0]
    if (batch.status !== 'OPEN') {
      return NextResponse.json(
        { error: `batch already ${batch.status}` },
        { status: 409 }
      )
    }
    if (Number(batch.completedSkus) < Number(batch.totalSkus)) {
      return NextResponse.json(
        {
          error: `Cannot close batch: ${batch.completedSkus}/${batch.totalSkus} lines counted`,
        },
        { status: 409 }
      )
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "CycleCountBatch"
          SET status = 'CLOSED', "closedAt" = NOW()
        WHERE id = $1`,
      batchId
    )

    // Mark the associated inbox item completed (best-effort).
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
          SET status = 'COMPLETED',
              "resolvedAt" = NOW(),
              "resolvedBy" = $2,
              "updatedAt" = NOW()
        WHERE "type" = 'CYCLE_COUNT_WEEKLY'
          AND "entityType" = 'CycleCountBatch'
          AND "entityId" = $1
          AND "status" = 'PENDING'`,
      batchId,
      staffId
    ).catch(() => {})

    return NextResponse.json({ ok: true, batchId, status: 'CLOSED' })
  } catch (error: any) {
    console.error('[cycle-count/complete] error:', error)
    return NextResponse.json(
      { error: 'Failed to close batch' },
      { status: 500 }
    )
  }
}
