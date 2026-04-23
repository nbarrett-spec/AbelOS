export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ops/admin/data-repair/drift-flagged
//
// Returns every Order that is flagged CORRUPT_HEADER_TRUST_ITEMS — plus any
// sibling classifications that require human review. This is the data source
// for the Data Repair review queue at /ops/admin/data-repair.
//
// Classification rules mirror scripts/drift-deep-dive.mjs:
//   CORRUPT_HEADER_TRUST_ITEMS — stored total is a tiny fraction of items sum
//     (stored header looks decimal-shifted/truncated). Items are truth.
//
// The endpoint is READ-ONLY. It re-runs the classification live against the
// DB so "Accept Fix" actions remove orders from the result set automatically.
// ────────────────────────────────────────────────────────────────────────────

type FlaggedOrder = {
  id: string
  orderNumber: string
  builderName: string | null
  builderId: string
  storedSubtotal: number
  storedTax: number
  storedShipping: number
  storedTotal: number
  computedItemSum: number
  computedTax: number
  computedFreight: number
  computedTotal: number
  delta: number
  classification: 'CORRUPT_HEADER_TRUST_ITEMS'
  suggestedAction: string
  items: Array<{
    id: string
    description: string
    qty: number
    unitPrice: number
    lineTotal: number
  }>
  lastUpdatedAt: string
  createdAt: string
  notes: string
}

interface Row {
  id: string
  orderNumber: string
  builderId: string
  builderName: string | null
  subtotal: number | null
  taxAmount: number | null
  shippingCost: number | null
  total: number | null
  itemsSum: number | null
  itemCount: number | null
  createdAt: Date
  updatedAt: Date
}

interface ItemRow {
  id: string
  orderId: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function classify(r: {
  subtotal: number
  tax: number
  ship: number
  total: number
  itemsSum: number
  itemCount: number
}): { kind: string; reason: string } | null {
  const { total, itemsSum, itemCount } = r
  const absStoredTotal = Math.abs(total)
  const expectedFromItems = itemsSum + r.tax + r.ship
  const absDriftItems = Math.abs(total - expectedFromItems)
  const totalVsItems = itemsSum > 0 ? absStoredTotal / itemsSum : 0

  if (itemsSum > 1000 && totalVsItems < 0.25 && absDriftItems > 10000 && itemCount > 0) {
    return {
      kind: 'CORRUPT_HEADER_TRUST_ITEMS',
      reason: `items=$${round2(itemsSum)} vs |stored total|=$${round2(absStoredTotal)} (${(totalVsItems * 100).toFixed(1)}%). Stored header looks decimal-shifted/truncated — items are truth.`,
    }
  }

  return null
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'ACCOUNTING'] })
  if (auth.error) return auth.error

  try {
    // Pull every candidate — orders with items whose |drift| might be > $10K.
    // The classifier then filters to CORRUPT_HEADER_TRUST_ITEMS specifically.
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT
         o.id, o."orderNumber", o."builderId",
         b."companyName" AS "builderName",
         o.subtotal, o."taxAmount", o."shippingCost", o.total,
         o."createdAt", o."updatedAt",
         COALESCE((
           SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id
         ), 0)::float AS "itemsSum",
         (SELECT COUNT(*)::int FROM "OrderItem" oi WHERE oi."orderId" = o.id)::int AS "itemCount"
       FROM "Order" o
       LEFT JOIN "Builder" b ON b.id = o."builderId"
       WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id)
         AND ABS(o.total - (
           COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0)
           + COALESCE(o."taxAmount", 0)
           + COALESCE(o."shippingCost", 0)
         )) > 10000
       ORDER BY o."orderNumber"`,
    )

    const flagged: FlaggedOrder[] = []
    const perBuilder = new Map<string, { builderId: string; builderName: string; orders: number; hidden: number }>()

    for (const r of rows) {
      const subtotal = Number(r.subtotal || 0)
      const tax = Number(r.taxAmount || 0)
      const ship = Number(r.shippingCost || 0)
      const total = Number(r.total || 0)
      const itemsSum = Number(r.itemsSum || 0)
      const itemCount = Number(r.itemCount || 0)

      const c = classify({ subtotal, tax, ship, total, itemsSum, itemCount })
      if (!c || c.kind !== 'CORRUPT_HEADER_TRUST_ITEMS') continue

      const computedTotal = round2(itemsSum + tax + ship)
      const delta = round2(computedTotal - total)

      flagged.push({
        id: r.id,
        orderNumber: r.orderNumber,
        builderName: r.builderName,
        builderId: r.builderId,
        storedSubtotal: round2(subtotal),
        storedTax: round2(tax),
        storedShipping: round2(ship),
        storedTotal: round2(total),
        computedItemSum: round2(itemsSum),
        computedTax: round2(tax),
        computedFreight: round2(ship),
        computedTotal,
        delta,
        classification: 'CORRUPT_HEADER_TRUST_ITEMS',
        suggestedAction: `Rebuild: subtotal = $${round2(itemsSum)}, total = $${computedTotal}. ${c.reason}`,
        items: [], // filled in below in a single batched query
        lastUpdatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        notes:
          (r.builderName?.toLowerCase().includes('toll')
            ? 'Toll Brothers mid-April import batch; stored header is decimal-shifted or truncated'
            : 'Stored header is decimal-shifted or truncated — items are truth'),
      })

      if (delta > 0) {
        const key = r.builderId
        const cur = perBuilder.get(key) ?? {
          builderId: r.builderId,
          builderName: r.builderName ?? 'Unknown',
          orders: 0,
          hidden: 0,
        }
        cur.orders += 1
        cur.hidden += delta
        perBuilder.set(key, cur)
      }
    }

    // Batch-load items for all flagged orders in one roundtrip.
    if (flagged.length > 0) {
      const ids = flagged.map(f => f.id)
      const items = await prisma.$queryRawUnsafe<ItemRow[]>(
        `SELECT oi.id, oi."orderId", oi.description, oi.quantity, oi."unitPrice", oi."lineTotal"
         FROM "OrderItem" oi
         WHERE oi."orderId" = ANY($1::text[])
         ORDER BY oi.id`,
        ids,
      )
      const byOrder = new Map<string, FlaggedOrder['items']>()
      for (const it of items) {
        const bucket = byOrder.get(it.orderId) ?? []
        bucket.push({
          id: it.id,
          description: it.description,
          qty: Number(it.quantity),
          unitPrice: round2(Number(it.unitPrice)),
          lineTotal: round2(Number(it.lineTotal)),
        })
        byOrder.set(it.orderId, bucket)
      }
      for (const f of flagged) {
        f.items = byOrder.get(f.id) ?? []
      }
    }

    // Recovered-so-far and rejected-count come from the AuditLog.
    // We count distinct Order IDs touched by ACCEPT_FIX / REJECT_FIX actions.
    let recoveredSoFar = 0
    let rejectedCount = 0
    let acceptedCount = 0
    try {
      const accepted = await prisma.$queryRawUnsafe<Array<{ entityId: string; amount: number }>>(
        `SELECT "entityId", COALESCE((details->>'delta')::float, 0) AS amount
         FROM "AuditLog"
         WHERE entity = 'Order' AND action = 'DATA_REPAIR_ACCEPT_FIX'
         ORDER BY "createdAt" DESC`,
      )
      const seen = new Set<string>()
      for (const a of accepted) {
        if (seen.has(a.entityId)) continue
        seen.add(a.entityId)
        recoveredSoFar += Math.max(0, Number(a.amount) || 0)
      }
      acceptedCount = seen.size

      const rejected = await prisma.$queryRawUnsafe<Array<{ entityId: string }>>(
        `SELECT DISTINCT "entityId"
         FROM "AuditLog"
         WHERE entity = 'Order' AND action = 'DATA_REPAIR_REJECT_FIX'`,
      )
      rejectedCount = rejected.length
    } catch {
      // AuditLog table may not exist in rare local setups — soft-fail.
    }

    const totalHiddenRevenue = flagged.reduce((sum, f) => sum + Math.max(0, f.delta), 0)

    return NextResponse.json({
      orders: flagged,
      summary: {
        flaggedCount: flagged.length,
        totalHiddenRevenue: round2(totalHiddenRevenue),
        recoveredSoFar: round2(recoveredSoFar),
        acceptedCount,
        rejectedCount,
      },
      builderBreakdown: Array.from(perBuilder.values())
        .map(b => ({ ...b, hidden: round2(b.hidden) }))
        .sort((a, b) => b.hidden - a.hidden),
    })
  } catch (error: any) {
    console.error('[data-repair/drift-flagged] GET error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load drift-flagged orders' }, { status: 500 })
  }
}
