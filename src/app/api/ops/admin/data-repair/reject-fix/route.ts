export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ops/admin/data-repair/reject-fix
// body: { orderId: string, reason: string }
//
// Leaves the Order.total / Order.subtotal untouched — reviewer signalled that
// the stored header is authoritative (e.g. an intentional discount or write-
// off was applied outside the item grid). The rejection is recorded on the
// DataQualityIssue row (status=IGNORED) and in the AuditLog.
//
// No schema change. No Order mutation. Idempotent.
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'ACCOUNTING'] })
  if (auth.error) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const { orderId, reason } = body as { orderId?: string; reason?: string }
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'reason required' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRawUnsafe<Array<{ id: string; orderNumber: string; total: number }>>(
        `SELECT id, "orderNumber", total FROM "Order" WHERE id = $1`,
        orderId,
      )
      if (!orders.length) {
        throw Object.assign(new Error('Order not found'), { status: 404 })
      }
      const o = orders[0]

      // Mark any matching DataQualityIssue rows IGNORED (not FIXED — reviewer
      // explicitly decided not to change the data).
      try {
        await tx.$executeRawUnsafe(
          `UPDATE "DataQualityIssue"
           SET status = 'IGNORED', "fixedAt" = NOW(), "fixedBy" = $1, "updatedAt" = NOW()
           WHERE "entityType" = 'Order' AND "entityId" = $2 AND status = 'OPEN'`,
          request.headers.get('x-staff-id') || 'unknown',
          orderId,
        )
      } catch {
        // Table optional — swallow.
      }

      return { orderNumber: o.orderNumber, storedTotal: Number(o.total) }
    })

    await audit(
      request,
      'DATA_REPAIR_REJECT_FIX',
      'Order',
      orderId,
      {
        orderNumber: result.orderNumber,
        storedTotal: result.storedTotal,
        reason: reason.trim(),
        interpretation: 'Reviewer classified the stored header as intentional — no mutation applied.',
        classification: 'CORRUPT_HEADER_TRUST_ITEMS',
      },
      'WARN',
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    const status = error?.status || 500
    console.error('[data-repair/reject-fix] POST error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to reject fix' }, { status })
  }
}
