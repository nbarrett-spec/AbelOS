export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/mrp/production-queue
 *
 * Returns the kanban buckets for the production queue.
 * We map OrderStatus values to 4 columns the floor actually thinks in:
 *   RECEIVED         (order received, not confirmed)
 *   CONFIRMED        (confirmed, materials in progress)
 *   IN_PRODUCTION    (on the floor)
 *   READY_TO_SHIP    (staged + READY_TO_SHIP/PARTIAL_SHIPPED)
 *
 * Also includes count of AWAITING_MATERIAL as a blocked side-channel.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const orders = await prisma.order.findMany({
      where: {
        status: {
          in: [
            'RECEIVED',
            'CONFIRMED',
            'IN_PRODUCTION',
            'AWAITING_MATERIAL',
            'READY_TO_SHIP',
            'PARTIAL_SHIPPED',
          ],
        },
      },
      select: {
        id: true,
        orderNumber: true,
        poNumber: true,
        status: true,
        total: true,
        deliveryDate: true,
        createdAt: true,
        updatedAt: true,
        builder: {
          select: { id: true, companyName: true },
        },
        items: {
          select: { id: true, quantity: true },
        },
        jobs: {
          select: { id: true, jobNumber: true, assignedPMId: true, status: true },
        },
      },
      orderBy: [
        { deliveryDate: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 400,
    })

    const columnMap: Record<string, string> = {
      RECEIVED: 'RECEIVED',
      CONFIRMED: 'CONFIRMED',
      IN_PRODUCTION: 'IN_PRODUCTION',
      AWAITING_MATERIAL: 'IN_PRODUCTION', // surface in production with badge
      READY_TO_SHIP: 'READY_TO_SHIP',
      PARTIAL_SHIPPED: 'READY_TO_SHIP',
    }

    const today = new Date()
    const items = orders.map((o) => {
      const lineCount = o.items.length
      const unitCount = o.items.reduce((s, it) => s + it.quantity, 0)
      const daysToDelivery = o.deliveryDate
        ? Math.ceil((o.deliveryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
        : null
      const urgency: 'RED' | 'AMBER' | 'GREEN' | 'NONE' =
        daysToDelivery == null
          ? 'NONE'
          : daysToDelivery < 0
            ? 'RED'
            : daysToDelivery <= 3
              ? 'RED'
              : daysToDelivery <= 7
                ? 'AMBER'
                : 'GREEN'

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        poNumber: o.poNumber,
        status: o.status,
        column: columnMap[o.status] || 'RECEIVED',
        total: o.total,
        deliveryDate: o.deliveryDate,
        daysToDelivery,
        urgency,
        builderName: o.builder?.companyName || '—',
        builderId: o.builder?.id || null,
        lineCount,
        unitCount,
        jobNumbers: o.jobs.map((j) => j.jobNumber).filter(Boolean),
        updatedAt: o.updatedAt,
        flagged: o.status === 'AWAITING_MATERIAL',
      }
    })

    const columns = ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP'] as const
    const buckets = Object.fromEntries(
      columns.map((c) => [c, items.filter((i) => i.column === c)])
    ) as Record<(typeof columns)[number], typeof items>

    return NextResponse.json({
      asOf: new Date().toISOString(),
      columns,
      buckets,
      totals: {
        RECEIVED: buckets.RECEIVED.length,
        CONFIRMED: buckets.CONFIRMED.length,
        IN_PRODUCTION: buckets.IN_PRODUCTION.length,
        READY_TO_SHIP: buckets.READY_TO_SHIP.length,
        AWAITING_MATERIAL: items.filter((i) => i.flagged).length,
      },
    })
  } catch (err: any) {
    console.error('[mrp production-queue] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to load queue' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/ops/mrp/production-queue
 *
 * Body: { orderId: string, status: OrderStatus }
 * Advances or moves an order between columns.
 */
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const orderId: string | undefined = body?.orderId
    const status: string | undefined = body?.status
    if (!orderId || !status) {
      return NextResponse.json(
        { error: 'orderId and status required' },
        { status: 400 }
      )
    }
    const validStatuses = [
      'RECEIVED',
      'CONFIRMED',
      'IN_PRODUCTION',
      'AWAITING_MATERIAL',
      'READY_TO_SHIP',
      'PARTIAL_SHIPPED',
      'SHIPPED',
    ]
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 })
    }
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: status as any },
      select: { id: true, status: true, orderNumber: true },
    })

    await audit(request, 'UPDATE', 'Order', orderId, { status })

    return NextResponse.json({ ok: true, order: updated })
  } catch (err: any) {
    console.error('[mrp production-queue PATCH] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to update' },
      { status: 500 }
    )
  }
}
