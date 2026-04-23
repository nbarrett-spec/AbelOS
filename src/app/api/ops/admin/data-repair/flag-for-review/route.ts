export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ops/admin/data-repair/flag-for-review
// body: { orderId: string, reason: string }
//
// Creates a HIGH-priority InboxItem (type=DATA_REPAIR_ESCALATION) assigned to
// Nate (n.barrett@abellumber.com). The order itself is not mutated — reviewer
// is deferring the decision.
//
// If Nate's Staff row cannot be resolved the inbox item is left unassigned
// rather than failing the request — an admin should still see it in the queue.
// ────────────────────────────────────────────────────────────────────────────

const NATE_EMAIL = 'n.barrett@abellumber.com'

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

    // Load order + items-sum snapshot so the inbox item carries enough detail
    // to act on without re-querying.
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string
      orderNumber: string
      builderId: string
      builderName: string | null
      subtotal: number
      total: number
      taxAmount: number
      shippingCost: number
      itemsSum: number
      itemCount: number
    }>>(
      `SELECT o.id, o."orderNumber", o."builderId",
              b."companyName" AS "builderName",
              o.subtotal, o.total, o."taxAmount", o."shippingCost",
              COALESCE((SELECT SUM("lineTotal") FROM "OrderItem" WHERE "orderId" = o.id), 0)::float AS "itemsSum",
              (SELECT COUNT(*)::int FROM "OrderItem" WHERE "orderId" = o.id)::int AS "itemCount"
       FROM "Order" o
       LEFT JOIN "Builder" b ON b.id = o."builderId"
       WHERE o.id = $1`,
      orderId,
    )
    if (!rows.length) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    const o = rows[0]

    // Resolve Nate's Staff id for assignment. Not fatal if missing.
    let assignedTo: string | null = null
    try {
      const nate = await prisma.staff.findUnique({ where: { email: NATE_EMAIL }, select: { id: true } })
      assignedTo = nate?.id ?? null
    } catch {
      assignedTo = null
    }

    const delta = Math.round((o.itemsSum + o.taxAmount + o.shippingCost - o.total) * 100) / 100

    const inbox = await prisma.inboxItem.create({
      data: {
        type: 'DATA_REPAIR_ESCALATION',
        source: 'data-repair',
        title: `Review drift on ${o.orderNumber} (${o.builderName ?? 'Unknown builder'})`,
        description: reason.trim(),
        priority: 'HIGH',
        status: 'PENDING',
        entityType: 'Order',
        entityId: o.id,
        financialImpact: delta,
        assignedTo,
        actionData: {
          orderId: o.id,
          orderNumber: o.orderNumber,
          builderId: o.builderId,
          builderName: o.builderName,
          storedTotal: o.total,
          itemsSum: o.itemsSum,
          itemCount: o.itemCount,
          delta,
          classification: 'CORRUPT_HEADER_TRUST_ITEMS',
        },
      },
    })

    await audit(
      request,
      'DATA_REPAIR_FLAG_FOR_REVIEW',
      'Order',
      orderId,
      {
        orderNumber: o.orderNumber,
        inboxItemId: inbox.id,
        reason: reason.trim(),
        delta,
        assignedTo,
      },
      'WARN',
    )

    return NextResponse.json({ ok: true, inboxItemId: inbox.id, orderNumber: o.orderNumber, delta })
  } catch (error: any) {
    console.error('[data-repair/flag-for-review] POST error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to flag for review' }, { status: 500 })
  }
}
