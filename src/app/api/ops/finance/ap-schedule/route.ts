export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/finance/ap-schedule
 *
 * Outstanding vendor bills (PurchaseOrders in status SENT_TO_VENDOR
 * or PARTIALLY_RECEIVED or RECEIVED not yet paid) grouped by pay-window:
 *   this_week  — expectedDate within 7 days
 *   next_week  — 8-14 days
 *   later      — 15+ days
 *   overdue    — expectedDate passed and still open
 *
 * (POST to update a payment hint — stored in notes for now since we don't
 * have a dedicated payment-status column on PO.)
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
      },
      select: {
        id: true,
        poNumber: true,
        status: true,
        total: true,
        orderedAt: true,
        expectedDate: true,
        receivedAt: true,
        notes: true,
        vendor: { select: { id: true, name: true } },
      },
    })

    type Window = 'overdue' | 'this_week' | 'next_week' | 'later' | 'no_date'
    const buckets: Record<Window, any[]> = {
      overdue: [],
      this_week: [],
      next_week: [],
      later: [],
      no_date: [],
    }

    const oneWeek = 7 * 24 * 60 * 60 * 1000
    for (const po of pos) {
      const row = {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        total: po.total,
        expectedDate: po.expectedDate,
        orderedAt: po.orderedAt,
        vendorId: po.vendor.id,
        vendorName: po.vendor.name,
        daysFromNow: po.expectedDate
          ? Math.ceil((po.expectedDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
          : null,
        paymentHint: extractPaymentHint(po.notes),
      }
      if (!po.expectedDate) buckets.no_date.push(row)
      else if (po.expectedDate < now) buckets.overdue.push(row)
      else if (po.expectedDate.getTime() - now.getTime() <= oneWeek) buckets.this_week.push(row)
      else if (po.expectedDate.getTime() - now.getTime() <= 2 * oneWeek) buckets.next_week.push(row)
      else buckets.later.push(row)
    }

    const sum = (arr: any[]) =>
      Math.round(arr.reduce((s, r) => s + r.total, 0) * 100) / 100

    return NextResponse.json({
      asOf: now.toISOString(),
      buckets,
      totals: {
        overdue: sum(buckets.overdue),
        this_week: sum(buckets.this_week),
        next_week: sum(buckets.next_week),
        later: sum(buckets.later),
        no_date: sum(buckets.no_date),
        grand: sum(pos),
      },
      counts: Object.fromEntries(
        Object.entries(buckets).map(([k, v]) => [k, v.length])
      ),
    })
  } catch (err: any) {
    console.error('[finance ap-schedule] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

/**
 * POST /api/ops/finance/ap-schedule
 *
 * Body: { poId, paymentHint }
 * Stores a pay-window hint in the PO notes (prefixed PAY:) — a lightweight
 * way to let accounting mark "pay this week" / "pay when cash allows" without
 * adding a new column.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { poId, paymentHint } = await request.json()
    if (!poId) return NextResponse.json({ error: 'poId required' }, { status: 400 })

    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { notes: true } })
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 })

    const cleanedNotes = (po.notes || '').replace(/^PAY:\s*\S+.*$/gm, '').trim()
    const newNotes = paymentHint ? `PAY: ${paymentHint}\n${cleanedNotes}`.trim() : cleanedNotes

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { notes: newNotes },
    })

    await audit(request, 'UPDATE', 'APSchedule', poId, { paymentHint })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

function extractPaymentHint(notes: string | null): string | null {
  if (!notes) return null
  const m = notes.match(/^PAY:\s*(\S+)/m)
  return m?.[1] || null
}
