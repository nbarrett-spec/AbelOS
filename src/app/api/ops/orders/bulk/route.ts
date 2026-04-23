export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, InvalidTransitionError } from '@/lib/status-guard'

// PATCH /api/ops/orders/bulk — Bulk update order statuses
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Order', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const { orderIds, status, notes } = body

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: 'orderIds array required' }, { status: 400 })
    }
    if (!status) {
      return NextResponse.json({ error: 'status required' }, { status: 400 })
    }

    const validStatuses = ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETE', 'CANCELLED']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }, { status: 400 })
    }

    const results: { id: string; orderNumber: string; success: boolean; error?: string }[] = []

    for (const orderId of orderIds) {
      try {
        // Get current order
        const current: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, "orderNumber", status::text as status FROM "Order" WHERE id = $1`,
          orderId
        )

        if (current.length === 0) {
          results.push({ id: orderId, orderNumber: '?', success: false, error: 'Not found' })
          continue
        }

        const order = current[0]

        // Status guard — per-row transition check before the UPDATE.
        try {
          requireValidTransition('order', order.status, status)
        } catch (e) {
          if (e instanceof InvalidTransitionError) {
            results.push({
              id: orderId,
              orderNumber: order.orderNumber,
              success: false,
              error: e.message,
            })
            continue
          }
          throw e
        }

        // Update status
        await prisma.$queryRawUnsafe(
          `UPDATE "Order" SET status = $1::"OrderStatus", "updatedAt" = NOW() WHERE id = $2`,
          status, orderId
        )

        // Add delivery notes if provided
        if (notes) {
          await prisma.$queryRawUnsafe(
            `UPDATE "Order" SET "deliveryNotes" = COALESCE("deliveryNotes", '') || $1 WHERE id = $2`,
            `\n[Bulk update ${new Date().toISOString().slice(0, 10)}] ${notes}`,
            orderId
          )
        }

        // Audit log
        try {
          await prisma.$queryRawUnsafe(`
            INSERT INTO "AuditLog" (id, action, entity, "entityId", "performedBy", details, "createdAt")
            VALUES ($1, 'BULK_STATUS_UPDATE', 'Order', $2, 'ops-staff', $3, NOW())
          `,
            'audit_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            orderId,
            JSON.stringify({ from: order.status, to: status, orderNumber: order.orderNumber })
          )
        } catch (e: any) { console.warn('[Bulk Orders] Failed to audit log status update:', e?.message) }

        results.push({ id: orderId, orderNumber: order.orderNumber, success: true })
      } catch (e: any) {
        results.push({ id: orderId, orderNumber: '?', success: false, error: e.message })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    return NextResponse.json({
      message: `Updated ${successCount} orders${failCount > 0 ? `, ${failCount} failed` : ''}`,
      results,
      successCount,
      failCount,
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
