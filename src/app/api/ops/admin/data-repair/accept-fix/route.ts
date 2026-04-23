export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ops/admin/data-repair/accept-fix
// body: { orderId: string, actorNote?: string }
//
// Atomically rebuilds the Order header from OrderItem.lineTotal:
//   subtotal = SUM(lineTotal)
//   total    = SUM(lineTotal) + taxAmount + shippingCost
//
// Re-runs the drift check post-commit and reports zeroResidual = true only
// when the fix fully resolves the drift.
//
// Any matching DataQualityIssue rows for this order are marked FIXED so the
// data-quality dashboard stays honest. AuditLog entry is written with the
// old/new values and delta for traceability.
// ────────────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'ACCOUNTING'] })
  if (auth.error) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const { orderId, actorNote } = body as { orderId?: string; actorNote?: string }
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    }

    // Pull current state + items inside the same transaction so we see a
    // consistent snapshot and fail fast if the order was fixed concurrently.
    const result = await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRawUnsafe<Array<{
        id: string
        orderNumber: string
        subtotal: number
        taxAmount: number
        shippingCost: number
        total: number
      }>>(
        `SELECT id, "orderNumber", subtotal, "taxAmount", "shippingCost", total
         FROM "Order" WHERE id = $1 FOR UPDATE`,
        orderId,
      )
      if (!orders.length) {
        throw Object.assign(new Error('Order not found'), { status: 404 })
      }
      const o = orders[0]

      const itemsRow = await tx.$queryRawUnsafe<Array<{ sum: number | null; count: number }>>(
        `SELECT COALESCE(SUM("lineTotal"), 0)::float AS sum, COUNT(*)::int AS count
         FROM "OrderItem" WHERE "orderId" = $1`,
        orderId,
      )
      const itemSum = round2(Number(itemsRow[0]?.sum || 0))
      const itemCount = Number(itemsRow[0]?.count || 0)
      if (itemCount === 0) {
        throw Object.assign(new Error('Refusing to rebuild header for an order with zero items'), {
          status: 409,
        })
      }

      const tax = round2(Number(o.taxAmount || 0))
      const ship = round2(Number(o.shippingCost || 0))
      const newSubtotal = itemSum
      const newTotal = round2(itemSum + tax + ship)
      const oldSubtotal = round2(Number(o.subtotal))
      const oldTotal = round2(Number(o.total))
      const delta = round2(newTotal - oldTotal)

      // Apply the fix.
      await tx.$executeRawUnsafe(
        `UPDATE "Order"
         SET subtotal = $1, total = $2, "updatedAt" = NOW()
         WHERE id = $3`,
        newSubtotal,
        newTotal,
        orderId,
      )

      // Verify residual drift is gone.
      const check = await tx.$queryRawUnsafe<Array<{ total: number; ts: number; tax: number; ship: number }>>(
        `SELECT o.total,
                COALESCE((SELECT SUM("lineTotal") FROM "OrderItem" WHERE "orderId" = o.id), 0)::float AS ts,
                COALESCE(o."taxAmount", 0)::float AS tax,
                COALESCE(o."shippingCost", 0)::float AS ship
         FROM "Order" o WHERE o.id = $1`,
        orderId,
      )
      const row = check[0]
      const residual = row ? Math.abs(Number(row.total) - (Number(row.ts) + Number(row.tax) + Number(row.ship))) : 999
      const zeroResidual = residual < 0.02

      // Mark any open DataQualityIssue rows for this order as FIXED.
      try {
        await tx.$executeRawUnsafe(
          `UPDATE "DataQualityIssue"
           SET status = 'FIXED', "fixedAt" = NOW(), "fixedBy" = $1, "updatedAt" = NOW()
           WHERE "entityType" = 'Order' AND "entityId" = $2 AND status != 'FIXED'`,
          request.headers.get('x-staff-id') || 'unknown',
          orderId,
        )
      } catch {
        // Table optional — swallow.
      }

      return {
        orderNumber: o.orderNumber,
        oldSubtotal,
        oldTotal,
        newSubtotal,
        newTotal,
        delta,
        itemCount,
        zeroResidual,
        residual: round2(residual),
      }
    })

    await audit(
      request,
      'DATA_REPAIR_ACCEPT_FIX',
      'Order',
      orderId,
      {
        orderNumber: result.orderNumber,
        oldSubtotal: result.oldSubtotal,
        oldTotal: result.oldTotal,
        newSubtotal: result.newSubtotal,
        newTotal: result.newTotal,
        delta: result.delta,
        itemCount: result.itemCount,
        zeroResidual: result.zeroResidual,
        residual: result.residual,
        actorNote: actorNote || null,
        classification: 'CORRUPT_HEADER_TRUST_ITEMS',
      },
      'WARN',
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    const status = error?.status || 500
    console.error('[data-repair/accept-fix] POST error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to accept fix' }, { status })
  }
}
