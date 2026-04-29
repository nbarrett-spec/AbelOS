export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/finance/ar
//
// Aging dashboard feed for /ops/finance/ar. Returns:
//
//   kpi — Total AR / Overdue / Expected This Week / DSO (30d trailing)
//   buckets — Current / 1-15 / 16-30 / 31-45 / 46-60 / 60+
//   byBuilder — per-builder totals with bucket split, for table + drill-down
//   invoices — per-invoice rows so the page can drill without a second call
//
// "Days past due" is computed from dueDate (or issuedAt if dueDate null,
// falling back to createdAt). Open invoices only (ISSUED, SENT, PARTIALLY_PAID,
// OVERDUE) with balanceDue > 0.
// ──────────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  invoiceNumber: string
  builderId: string
  total: number
  amountPaid: number
  balanceDue: number
  status: string
  dueDate: Date | null
  issuedAt: Date | null
  createdAt: Date
  builderName: string | null
  paymentTerm: string | null
}

type BucketKey = 'current' | 'd1_15' | 'd16_30' | 'd31_45' | 'd46_60' | 'd60_plus'

const BUCKET_ORDER: BucketKey[] = ['current', 'd1_15', 'd16_30', 'd31_45', 'd46_60', 'd60_plus']

function classify(daysPastDue: number): BucketKey {
  if (daysPastDue <= 0) return 'current'
  if (daysPastDue <= 15) return 'd1_15'
  if (daysPastDue <= 30) return 'd16_30'
  if (daysPastDue <= 45) return 'd31_45'
  if (daysPastDue <= 60) return 'd46_60'
  return 'd60_plus'
}

function daysDiff(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const startOfWeek = new Date(now)
    // ISO week: Monday as first day. Go back (dayOfWeek-1) days (Sun=0 → 6, Mon=1 → 0).
    const dayOfWeek = (startOfWeek.getDay() + 6) % 7
    startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek)
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(endOfWeek.getDate() + 7)

    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(`
      SELECT
        i."id", i."invoiceNumber", i."builderId",
        i."total"::float AS "total",
        COALESCE(i."amountPaid", 0)::float AS "amountPaid",
        (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
        i."status"::text AS "status",
        i."dueDate", i."issuedAt", i."createdAt",
        i."paymentTerm"::text AS "paymentTerm",
        b."companyName" AS "builderName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
    `)

    // ── Bucket roll-up + per-builder totals ────────────────────────────────
    const buckets: Record<BucketKey, { count: number; amount: number }> = {
      current: { count: 0, amount: 0 },
      d1_15: { count: 0, amount: 0 },
      d16_30: { count: 0, amount: 0 },
      d31_45: { count: 0, amount: 0 },
      d46_60: { count: 0, amount: 0 },
      d60_plus: { count: 0, amount: 0 },
    }

    const byBuilder: Record<string, {
      builderId: string
      builderName: string
      current: number
      d1_30: number // merged 1-30 column for the summary table
      d31_60: number
      d60_plus: number
      total: number
      invoiceCount: number
      lastPaymentDate: string | null
    }> = {}

    const invoicesOut: Array<{
      id: string
      invoiceNumber: string
      builderId: string
      builderName: string
      balanceDue: number
      total: number
      amountPaid: number
      status: string
      paymentTerm: string | null
      dueDate: string | null
      issuedAt: string | null
      daysPastDue: number
      bucket: BucketKey
    }> = []

    let totalAR = 0
    let overdueTotal = 0
    let expectedThisWeek = 0

    for (const r of rows) {
      const balance = Number(r.balanceDue)
      if (balance <= 0) continue

      // Reference date priority: dueDate > issuedAt > createdAt. Matches the
      // aging math most accounting teams use and avoids classing invoices
      // without due dates as "overdue" on day one.
      const refDate = r.dueDate || r.issuedAt || r.createdAt
      const daysPastDue = daysDiff(now, refDate)
      const bucket = classify(daysPastDue)
      buckets[bucket].count++
      buckets[bucket].amount += balance
      totalAR += balance
      if (bucket !== 'current') overdueTotal += balance

      // Expected this week: dueDate falls in current Mon-Sun window (inclusive).
      if (r.dueDate && r.dueDate >= startOfWeek && r.dueDate < endOfWeek) {
        expectedThisWeek += balance
      }

      const builderName = r.builderName || 'Unknown'
      if (!byBuilder[r.builderId]) {
        byBuilder[r.builderId] = {
          builderId: r.builderId,
          builderName,
          current: 0,
          d1_30: 0,
          d31_60: 0,
          d60_plus: 0,
          total: 0,
          invoiceCount: 0,
          lastPaymentDate: null,
        }
      }
      const b = byBuilder[r.builderId]
      b.total += balance
      b.invoiceCount++
      if (bucket === 'current') b.current += balance
      else if (bucket === 'd1_15' || bucket === 'd16_30') b.d1_30 += balance
      else if (bucket === 'd31_45' || bucket === 'd46_60') b.d31_60 += balance
      else b.d60_plus += balance

      invoicesOut.push({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        builderId: r.builderId,
        builderName,
        balanceDue: balance,
        total: Number(r.total),
        amountPaid: Number(r.amountPaid),
        status: r.status,
        paymentTerm: r.paymentTerm,
        dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
        issuedAt: r.issuedAt ? new Date(r.issuedAt).toISOString() : null,
        daysPastDue,
        bucket,
      })
    }

    // ── DSO (30-day trailing) ──────────────────────────────────────────────
    // DSO = (AR / Credit Sales) × Days. Use 30-day window. Falls back to 0
    // if no sales in window (avoids division-by-zero and absurd spikes on
    // small denominators).
    const salesWindow = 30
    const salesRow = await prisma.$queryRawUnsafe<Array<{ sum: number | null }>>(`
      SELECT COALESCE(SUM(i."total"), 0)::float AS "sum"
      FROM "Invoice" i
      WHERE i."issuedAt" IS NOT NULL
        AND i."issuedAt" >= NOW() - INTERVAL '30 days'
        AND i."status"::text NOT IN ('DRAFT', 'VOID')
    `)
    const credit30 = Number(salesRow[0]?.sum ?? 0)
    const dso = credit30 > 0 ? Math.round((totalAR / credit30) * salesWindow) : 0

    // ── Last payment date per builder ──────────────────────────────────────
    // Most-recent Payment.receivedAt across any of that builder's invoices.
    // Powers the "Last Payment" column in the per-builder breakdown so Dawn
    // can see at a glance who's gone cold even if their balance still looks
    // fine on the surface.
    const lastPaymentRows = await prisma.$queryRawUnsafe<Array<{ builderId: string; lastPaymentDate: Date | null }>>(`
      SELECT i2."builderId" AS "builderId", MAX(p."receivedAt") AS "lastPaymentDate"
      FROM "Payment" p
      JOIN "Invoice" i2 ON i2."id" = p."invoiceId"
      WHERE i2."builderId" IS NOT NULL
      GROUP BY i2."builderId"
    `)
    for (const lp of lastPaymentRows) {
      const b = byBuilder[lp.builderId]
      if (b && lp.lastPaymentDate) {
        b.lastPaymentDate = new Date(lp.lastPaymentDate).toISOString()
      }
    }

    // ── Sort builders by total AR desc ─────────────────────────────────────
    const builderList = Object.values(byBuilder).sort((a, b) => b.total - a.total)

    return NextResponse.json({
      asOf: now.toISOString(),
      kpi: {
        totalAR,
        overdueTotal,
        expectedThisWeek,
        dso,
      },
      buckets: {
        current: buckets.current,
        d1_15: buckets.d1_15,
        d16_30: buckets.d16_30,
        d31_45: buckets.d31_45,
        d46_60: buckets.d46_60,
        d60_plus: buckets.d60_plus,
      },
      bucketOrder: BUCKET_ORDER,
      byBuilder: builderList,
      invoices: invoicesOut,
    })
  } catch (error) {
    console.error('GET /api/ops/finance/ar error:', error)
    return NextResponse.json({ error: 'Failed to fetch AR aging data' }, { status: 500 })
  }
}
