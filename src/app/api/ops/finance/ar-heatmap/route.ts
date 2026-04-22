export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/finance/ar-heatmap
 *
 * Returns a builder × aging-bucket matrix for all open invoices.
 * Buckets: Current, 1-30, 31-60, 61-90, 90+ (days past due).
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const invoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceNumber", "builderId", "total",
             ("total" - COALESCE("amountPaid",0))::float AS "balanceDue",
             "dueDate", "issuedAt", "status"::text AS "status"
      FROM "Invoice"
      WHERE "status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND ("total" - COALESCE("amountPaid",0)) > 0
    `)

    const builders = await prisma.builder.findMany({
      where: { id: { in: Array.from(new Set(invoices.map((i) => i.builderId))) } },
      select: { id: true, companyName: true },
    })
    const builderMap = new Map(builders.map((b) => [b.id, b.companyName]))

    type Bucket = 'current' | '1-30' | '31-60' | '61-90' | '90+'
    const bucketOrder: Bucket[] = ['current', '1-30', '31-60', '61-90', '90+']

    const bucketize = (inv: (typeof invoices)[number]): Bucket => {
      if (!inv.dueDate) return 'current'
      const days = Math.floor((Date.now() - inv.dueDate.getTime()) / (24 * 60 * 60 * 1000))
      if (days <= 0) return 'current'
      if (days <= 30) return '1-30'
      if (days <= 60) return '31-60'
      if (days <= 90) return '61-90'
      return '90+'
    }

    interface Row {
      builderId: string
      builderName: string
      buckets: Record<Bucket, { amount: number; count: number; invoiceIds: string[] }>
      total: number
    }

    const rows = new Map<string, Row>()

    for (const inv of invoices) {
      const b = bucketize(inv)
      let row = rows.get(inv.builderId)
      if (!row) {
        row = {
          builderId: inv.builderId,
          builderName: builderMap.get(inv.builderId) || '—',
          buckets: {
            current: { amount: 0, count: 0, invoiceIds: [] },
            '1-30': { amount: 0, count: 0, invoiceIds: [] },
            '31-60': { amount: 0, count: 0, invoiceIds: [] },
            '61-90': { amount: 0, count: 0, invoiceIds: [] },
            '90+': { amount: 0, count: 0, invoiceIds: [] },
          },
          total: 0,
        }
        rows.set(inv.builderId, row)
      }
      row.buckets[b].amount += inv.balanceDue
      row.buckets[b].count += 1
      row.buckets[b].invoiceIds.push(inv.id)
      row.total += inv.balanceDue
    }

    const rowList = Array.from(rows.values()).sort((a, b) => b.total - a.total)

    const totals = bucketOrder.reduce(
      (acc, b) => {
        acc[b] = rowList.reduce((s, r) => s + r.buckets[b].amount, 0)
        return acc
      },
      {} as Record<Bucket, number>
    )
    const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0)

    return NextResponse.json({
      asOf: new Date().toISOString(),
      bucketOrder,
      rows: rowList.map((r) => ({
        ...r,
        total: Math.round(r.total * 100) / 100,
        buckets: Object.fromEntries(
          Object.entries(r.buckets).map(([k, v]) => [
            k,
            { amount: Math.round(v.amount * 100) / 100, count: v.count, invoiceIds: v.invoiceIds },
          ])
        ),
      })),
      totals: Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      grandTotal: Math.round(grandTotal * 100) / 100,
    })
  } catch (err: any) {
    console.error('[finance ar-heatmap] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
