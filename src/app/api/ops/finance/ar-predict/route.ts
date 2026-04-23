export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/finance/ar-predict
//
// For each open invoice, compute a "predicted payment date" by averaging
// the historical (receivedAt − dueDate) days per builder. Invoices with no
// builder history fall back to the global average; invoices with no
// dueDate get null.
//
// Also returns:
//  - waterfall  — aging-bucket counts/amounts (Current, 1-30, 31-60, 61-90, 90+)
//  - reminderHistory  — map of invoiceId -> remindersSent count (via AuditLog)
//  - dsoTrend — 12-month DSO series from FinancialSnapshot (computed inline if empty)
//  - builderPatterns — avg days past due per builder
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()

    // ── Historical payment lag per builder ────────────────────────────────
    const lagsRaw: Array<{ builderId: string; lag: number }> = await prisma.$queryRawUnsafe(`
      SELECT i."builderId" AS "builderId",
             EXTRACT(EPOCH FROM (p."receivedAt" - i."dueDate")) / 86400 AS "lag"
      FROM "Payment" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      WHERE i."dueDate" IS NOT NULL
        AND p."receivedAt" IS NOT NULL
    `)

    const byBuilder: Record<string, number[]> = {}
    const all: number[] = []
    for (const r of lagsRaw) {
      const lag = Number(r.lag)
      if (!Number.isFinite(lag)) continue
      all.push(lag)
      if (!byBuilder[r.builderId]) byBuilder[r.builderId] = []
      byBuilder[r.builderId].push(lag)
    }
    const avg = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length)
    const globalAvgLag = avg(all)
    const builderAvgLag: Record<string, number> = {}
    for (const [bid, arr] of Object.entries(byBuilder)) builderAvgLag[bid] = avg(arr)

    // ── Open invoices ────────────────────────────────────────────────────
    const invoices: Array<{
      id: string
      invoiceNumber: string
      builderId: string
      total: number
      amountPaid: number
      status: string
      dueDate: Date | null
      issuedAt: Date | null
      createdAt: Date
    }> = await prisma.$queryRawUnsafe(`
      SELECT id, "invoiceNumber", "builderId", total, "amountPaid", status::text as status,
             "dueDate", "issuedAt", "createdAt"
      FROM "Invoice"
      WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
        AND (total - COALESCE("amountPaid",0)) > 0
    `)

    // Builder map
    const builderIds = Array.from(new Set(invoices.map(i => i.builderId)))
    const builders = builderIds.length === 0 ? [] : await prisma.builder.findMany({
      where: { id: { in: builderIds } },
      select: { id: true, companyName: true, paymentTerm: true },
    })
    const builderMap = new Map(builders.map(b => [b.id, b]))

    // Waterfall buckets — Current, 1-30, 31-60, 61-90, 90+
    const waterfall = {
      current:   { count: 0, amount: 0 },
      d1_30:     { count: 0, amount: 0 },
      d31_60:    { count: 0, amount: 0 },
      d61_90:    { count: 0, amount: 0 },
      d90_plus:  { count: 0, amount: 0 },
    }

    const enriched = invoices.map(inv => {
      const balance = Number(inv.total) - Number(inv.amountPaid)
      const issued = inv.issuedAt ?? inv.createdAt
      const daysOutstanding = Math.floor((now.getTime() - issued.getTime()) / 86400000)
      const builder = builderMap.get(inv.builderId)

      // Predicted pay date: dueDate + builderLag (or globalLag)
      const lag = builderAvgLag[inv.builderId] ?? globalAvgLag
      let predictedPaymentDate: string | null = null
      if (inv.dueDate) {
        const predicted = new Date(inv.dueDate)
        predicted.setDate(predicted.getDate() + Math.round(lag))
        predictedPaymentDate = predicted.toISOString()
      }

      // Days past due (negative = days until due, positive = days overdue)
      const daysPastDue = inv.dueDate
        ? Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000)
        : 0

      // Bucket
      let bucket: keyof typeof waterfall
      if (daysPastDue <= 0) bucket = 'current'
      else if (daysPastDue <= 30) bucket = 'd1_30'
      else if (daysPastDue <= 60) bucket = 'd31_60'
      else if (daysPastDue <= 90) bucket = 'd61_90'
      else bucket = 'd90_plus'
      waterfall[bucket].count++
      waterfall[bucket].amount += balance

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        builderId: inv.builderId,
        builderName: builder?.companyName ?? 'Unknown',
        paymentTerm: builder?.paymentTerm ?? null,
        balanceDue: balance,
        total: Number(inv.total),
        amountPaid: Number(inv.amountPaid),
        status: inv.status,
        issuedAt: (inv.issuedAt ?? inv.createdAt).toISOString(),
        dueDate: inv.dueDate?.toISOString() ?? null,
        daysOutstanding,
        daysPastDue,
        predictedPaymentDate,
        builderAvgLag: Math.round(builderAvgLag[inv.builderId] ?? globalAvgLag),
        bucket,
      }
    })

    // Sort by soonest predicted date (nulls last)
    enriched.sort((a, b) => {
      if (!a.predictedPaymentDate && !b.predictedPaymentDate) return b.balanceDue - a.balanceDue
      if (!a.predictedPaymentDate) return 1
      if (!b.predictedPaymentDate) return -1
      return a.predictedPaymentDate.localeCompare(b.predictedPaymentDate)
    })

    // ── Reminder history — count per invoice from AuditLog ────────────────
    const reminderRows: Array<{ entityId: string | null; count: number }> = await prisma.$queryRawUnsafe(`
      SELECT "entityId", COUNT(*)::int as count
      FROM "AuditLog"
      WHERE "entityType" = 'ReminderEmail'
      GROUP BY "entityId"
    `).catch(() => []) as any

    const reminderHistory: Record<string, number> = {}
    for (const r of reminderRows) {
      if (r.entityId) reminderHistory[r.entityId] = Number(r.count)
    }

    // ── DSO trend — last 12 months from FinancialSnapshot ────────────────
    const snapshots = await prisma.financialSnapshot.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 12,
      select: { snapshotDate: true, dso: true },
    })
    let dsoTrend = snapshots.reverse().map(s => ({
      date: s.snapshotDate.toISOString().slice(0, 7),
      dso: s.dso,
    }))

    // If snapshots empty, compute a rough current DSO from data on hand
    if (dsoTrend.length === 0) {
      const totalOpen = enriched.reduce((s, i) => s + i.balanceDue, 0)
      // Last 90 days of invoiced revenue
      const revenueRow: Array<{ total: number }> = await prisma.$queryRawUnsafe(`
        SELECT COALESCE(SUM(total),0)::float as total FROM "Invoice"
        WHERE "issuedAt" >= NOW() - INTERVAL '90 days'
      `)
      const rev = revenueRow[0]?.total ?? 0
      const dailyRev = rev / 90
      const dso = dailyRev > 0 ? Math.round(totalOpen / dailyRev) : 0
      dsoTrend = [{ date: now.toISOString().slice(0, 7), dso }]
    }

    // ── Builder patterns (for quick view) ────────────────────────────────
    const builderPatterns = Object.entries(builderAvgLag).map(([bid, lag]) => {
      const b = builderMap.get(bid)
      const samples = (byBuilder[bid] ?? []).length
      return {
        builderId: bid,
        builderName: b?.companyName ?? 'Unknown',
        paymentTerm: b?.paymentTerm ?? null,
        avgDaysLate: Math.round(lag),
        sampleSize: samples,
      }
    }).sort((a, b) => b.avgDaysLate - a.avgDaysLate)

    return NextResponse.json({
      asOf: now.toISOString(),
      waterfall,
      invoices: enriched,
      reminderHistory,
      dsoTrend,
      builderPatterns,
      globalAvgLag: Math.round(globalAvgLag),
    })
  } catch (err: any) {
    console.error('[ar-predict]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
