export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/finance/ap-waterfall
//
// Mirrors the AR waterfall for Payables. Buckets open POs into:
//   - Current (no date yet, or expected > today)
//   - 1-30 days past expected
//   - 31-60
//   - 61-90
//   - 90+
// Plus pay-this-week / next-week / later windows (forward-looking).
//
// Also returns per-vendor exposure summary.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const msDay = 86400000

    const pos = await prisma.purchaseOrder.findMany({
      where: { status: { in: ['APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED'] } },
      select: {
        id: true, poNumber: true, status: true, total: true, expectedDate: true,
        orderedAt: true, receivedAt: true, notes: true,
        vendor: { select: { id: true, name: true, active: true } },
      },
    })

    const waterfall = {
      current:  { count: 0, amount: 0 },
      d1_30:    { count: 0, amount: 0 },
      d31_60:   { count: 0, amount: 0 },
      d61_90:   { count: 0, amount: 0 },
      d90_plus: { count: 0, amount: 0 },
    }

    const windows = {
      this_week: { count: 0, amount: 0 },
      next_week: { count: 0, amount: 0 },
      later:     { count: 0, amount: 0 },
      overdue:   { count: 0, amount: 0 },
      no_date:   { count: 0, amount: 0 },
    }

    const vendorExposure: Record<string, { vendorId: string; vendorName: string; amount: number; count: number }> = {}

    const enriched = pos.map(po => {
      const total = Number(po.total)
      const exp = po.expectedDate
      const days = exp ? Math.floor((now.getTime() - exp.getTime()) / msDay) : null

      // Backward-looking waterfall buckets
      let bucket: keyof typeof waterfall
      if (days === null || days <= 0) bucket = 'current'
      else if (days <= 30) bucket = 'd1_30'
      else if (days <= 60) bucket = 'd31_60'
      else if (days <= 90) bucket = 'd61_90'
      else bucket = 'd90_plus'
      waterfall[bucket].count++
      waterfall[bucket].amount += total

      // Forward-looking pay windows
      let window: keyof typeof windows
      if (!exp) window = 'no_date'
      else if (days !== null && days > 0) window = 'overdue'
      else {
        const daysUntil = -(days ?? 0)
        if (daysUntil <= 7) window = 'this_week'
        else if (daysUntil <= 14) window = 'next_week'
        else window = 'later'
      }
      windows[window].count++
      windows[window].amount += total

      // Vendor exposure
      const v = po.vendor
      if (!vendorExposure[v.id]) {
        vendorExposure[v.id] = { vendorId: v.id, vendorName: v.name, amount: 0, count: 0 }
      }
      vendorExposure[v.id].amount += total
      vendorExposure[v.id].count++

      const paymentHint = extractPaymentHint(po.notes)
      return {
        id: po.id,
        poNumber: po.poNumber,
        vendorId: v.id,
        vendorName: v.name,
        status: po.status,
        amount: total,
        expectedDate: exp?.toISOString() ?? null,
        daysPastExpected: days,
        orderedAt: po.orderedAt?.toISOString() ?? null,
        paymentHint,
        bucket,
        window,
      }
    })

    enriched.sort((a, b) => {
      // Overdue first, then this week, etc.
      const order = { overdue: 0, this_week: 1, next_week: 2, later: 3, no_date: 4 }
      const wa = order[a.window as keyof typeof order] ?? 5
      const wb = order[b.window as keyof typeof order] ?? 5
      if (wa !== wb) return wa - wb
      return b.amount - a.amount
    })

    const vendorList = Object.values(vendorExposure).sort((a, b) => b.amount - a.amount)

    return NextResponse.json({
      asOf: now.toISOString(),
      waterfall,
      windows,
      vendors: vendorList,
      purchaseOrders: enriched,
    })
  } catch (err: any) {
    console.error('[ap-waterfall]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/finance/ap-waterfall
// Body: { poId, amount?, method?, reference? }
// Records an outgoing Payment against the PO — implemented by marking the PO
// as received + storing the payment in the PO notes (since Payment is linked
// to Invoice, not PO, in the current schema).
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { poId, amount, method, reference } = body
    if (!poId) return NextResponse.json({ error: 'poId required' }, { status: 400 })

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, poNumber: true, total: true, notes: true, status: true },
    })
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 })

    const ts = new Date().toISOString()
    const paidLine = `PAID ${ts} amt=${amount ?? po.total} method=${method ?? 'CHECK'}${reference ? ` ref=${reference}` : ''}`
    const nextNotes = [po.notes, paidLine].filter(Boolean).join('\n')

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        notes: nextNotes,
        receivedAt: new Date(),
        status: po.status === 'SENT_TO_VENDOR' ? 'RECEIVED' : po.status,
      },
    })

    await audit(request, 'UPDATE', 'PurchaseOrder', poId, {
      action: 'mark_paid',
      amount: amount ?? po.total,
      method: method ?? 'CHECK',
      reference,
    }).catch(() => {})

    return NextResponse.json({ ok: true, poNumber: po.poNumber })
  } catch (err: any) {
    console.error('[ap-waterfall POST]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

function extractPaymentHint(notes: string | null): string | null {
  if (!notes) return null
  const m = notes.match(/^PAY:\s*(\S+)/m)
  return m?.[1] || null
}
