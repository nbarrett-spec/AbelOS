export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { syncMonthEndToQuickBooks } from '@/lib/integrations/quickbooks'

// ──────────────────────────────────────────────────────────────────────────
// Monthly Close API
// ──────────────────────────────────────────────────────────────────────────
// Uses raw SQL against the MonthlyClose table (additive migration — the
// Prisma client may not yet be regenerated in some environments).
// ──────────────────────────────────────────────────────────────────────────

type CloseStep =
  | 'invoicesIssued'
  | 'posReceived'
  | 'arReviewed'
  | 'apReviewed'
  | 'snapshotTaken'
  | 'qbSynced'

const VALID_STEPS: CloseStep[] = [
  'invoicesIssued',
  'posReceived',
  'arReviewed',
  'apReviewed',
  'snapshotTaken',
  'qbSynced',
]

interface CloseRow {
  id: string
  year: number
  month: number
  invoicesIssued: boolean
  posReceived: boolean
  arReviewed: boolean
  apReviewed: boolean
  snapshotTaken: boolean
  qbSynced: boolean
  reconciliationVariance: number | null
  reconciliationOk: boolean
  invoicesIssuedAt: Date | null
  posReceivedAt: Date | null
  arReviewedAt: Date | null
  apReviewedAt: Date | null
  snapshotTakenAt: Date | null
  qbSyncedAt: Date | null
  reconciledAt: Date | null
  status: string
  closedAt: Date | null
  notes: string | null
}

async function loadClose(year: number, month: number): Promise<CloseRow | null> {
  const rows = await prisma.$queryRawUnsafe<CloseRow[]>(
    `SELECT id, year, month, "invoicesIssued", "posReceived", "arReviewed", "apReviewed",
            "snapshotTaken", "qbSynced", "reconciliationVariance", "reconciliationOk",
            "invoicesIssuedAt", "posReceivedAt", "arReviewedAt", "apReviewedAt",
            "snapshotTakenAt", "qbSyncedAt", "reconciledAt", status, "closedAt", notes
     FROM "MonthlyClose" WHERE year = $1 AND month = $2 LIMIT 1`,
    year, month,
  )
  return rows[0] ?? null
}

async function createClose(year: number, month: number): Promise<CloseRow> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MonthlyClose" (id, year, month) VALUES ($1, $2, $3)
     ON CONFLICT (year, month) DO NOTHING`,
    `close_${year}_${month}_${Date.now().toString(36)}`,
    year,
    month,
  )
  const close = await loadClose(year, month)
  if (!close) throw new Error('Failed to create MonthlyClose')
  return close
}

async function getOrCreateClose(year: number, month: number): Promise<CloseRow> {
  return (await loadClose(year, month)) ?? (await createClose(year, month))
}

async function computeHints(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  const [draftInvoices, openPOs] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int as count FROM "Invoice"
       WHERE status::text = 'DRAFT' AND "createdAt" >= $1 AND "createdAt" < $2`,
      start, end,
    ),
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int as count FROM "PurchaseOrder"
       WHERE status::text IN ('SENT_TO_VENDOR','PARTIALLY_RECEIVED')
         AND "createdAt" >= $1 AND "createdAt" < $2`,
      start, end,
    ),
  ])
  return {
    draftInvoiceCount: draftInvoices[0]?.count ?? 0,
    openPOCount: openPOs[0]?.count ?? 0,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'] })
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const month = Number(searchParams.get('month')) || (new Date().getMonth() + 1)

    if (year < 2020 || year > 2100 || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid year/month' }, { status: 400 })
    }

    const close = await getOrCreateClose(year, month)
    const hints = await computeHints(year, month)

    const history = await prisma.$queryRawUnsafe<Array<{ year: number; month: number; status: string; closedAt: Date | null; reconciliationVariance: number | null }>>(
      `SELECT year, month, status, "closedAt", "reconciliationVariance"
       FROM "MonthlyClose" ORDER BY year DESC, month DESC LIMIT 12`,
    )

    return NextResponse.json({ close, hints, history })
  } catch (err: any) {
    console.error('[monthly-close GET]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'] })
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const year = Number(body.year)
    const month = Number(body.month)
    const action = String(body.action || '')
    if (!year || !month) return NextResponse.json({ error: 'year/month required' }, { status: 400 })

    const staffId = auth.session.staffId
    const close = await getOrCreateClose(year, month)

    if (action === 'toggle') {
      const step = String(body.step || '') as CloseStep
      if (!VALID_STEPS.includes(step)) return NextResponse.json({ error: 'invalid step' }, { status: 400 })
      const current = (close as any)[step] as boolean
      const nextVal = !current
      const atCol = `"${step}At"`
      const byCol = `"${step}ById"`
      const valCol = `"${step}"`
      await prisma.$executeRawUnsafe(
        `UPDATE "MonthlyClose"
         SET ${valCol} = $1,
             ${atCol} = $2,
             ${byCol} = $3,
             status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END,
             "updatedAt" = NOW()
         WHERE year = $4 AND month = $5`,
        nextVal,
        nextVal ? new Date() : null,
        nextVal ? staffId : null,
        year,
        month,
      )
      const updated = await loadClose(year, month)
      await audit(request, 'UPDATE', 'MonthlyClose', updated?.id ?? '', { step, value: nextVal }).catch(() => {})
      return NextResponse.json({ close: updated })
    }

    if (action === 'reconcile') {
      const variancePct = Number(body.variancePct)
      if (!Number.isFinite(variancePct)) return NextResponse.json({ error: 'variancePct required' }, { status: 400 })
      const ok = Math.abs(variancePct) < 1
      await prisma.$executeRawUnsafe(
        `UPDATE "MonthlyClose"
         SET "reconciliationVariance" = $1, "reconciliationOk" = $2,
             "reconciledAt" = NOW(), "reconciledById" = $3,
             "updatedAt" = NOW()
         WHERE year = $4 AND month = $5`,
        variancePct, ok, staffId, year, month,
      )
      const updated = await loadClose(year, month)
      await audit(request, 'UPDATE', 'MonthlyClose', updated?.id ?? '', { variancePct, ok }).catch(() => {})
      return NextResponse.json({ close: updated })
    }

    if (action === 'qb_sync') {
      const result = await syncMonthEndToQuickBooks({ year, month })
      if (result.ok) {
        await prisma.$executeRawUnsafe(
          `UPDATE "MonthlyClose"
           SET "qbSynced" = true, "qbSyncedAt" = NOW(), "qbSyncedById" = $1, "updatedAt" = NOW()
           WHERE year = $2 AND month = $3`,
          staffId, year, month,
        )
      }
      const updated = await loadClose(year, month)
      await audit(request, 'UPDATE', 'MonthlyClose', updated?.id ?? '', { qbSync: result.ok, message: result.message }).catch(() => {})
      return NextResponse.json({ close: updated, qb: result })
    }

    if (action === 'close_month') {
      const critical: CloseStep[] = ['invoicesIssued', 'posReceived', 'arReviewed', 'apReviewed', 'snapshotTaken']
      const missing = critical.filter(s => !(close as any)[s])
      if (missing.length > 0) {
        return NextResponse.json({ error: `Cannot close — missing: ${missing.join(', ')}` }, { status: 400 })
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "MonthlyClose"
         SET status = 'CLOSED', "closedAt" = NOW(), "closedById" = $1, "updatedAt" = NOW()
         WHERE year = $2 AND month = $3`,
        staffId, year, month,
      )
      const updated = await loadClose(year, month)
      await audit(request, 'UPDATE', 'MonthlyClose', updated?.id ?? '', { action: 'close_month' }).catch(() => {})
      return NextResponse.json({ close: updated })
    }

    if (action === 'generate_report') {
      const asOf = new Date(Date.UTC(year, month, 0, 23, 59, 59))
      const periodStart = new Date(Date.UTC(year, month - 1, 1))
      const periodEnd = new Date(Date.UTC(year, month, 1))
      const [arRows, apRows, revenueRows] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ total: number }>>(
          `SELECT COALESCE(SUM(total - "amountPaid"), 0)::float AS total
           FROM "Invoice" WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
             AND "createdAt" <= $1`, asOf,
        ),
        prisma.$queryRawUnsafe<Array<{ total: number }>>(
          `SELECT COALESCE(SUM(total), 0)::float AS total
           FROM "PurchaseOrder" WHERE status::text IN ('SENT_TO_VENDOR','PARTIALLY_RECEIVED','RECEIVED')
             AND "createdAt" <= $1`, asOf,
        ),
        prisma.$queryRawUnsafe<Array<{ total: number; count: number }>>(
          `SELECT COALESCE(SUM(total), 0)::float AS total, COUNT(*)::int AS count
           FROM "Invoice"
           WHERE "issuedAt" >= $1 AND "issuedAt" < $2`,
          periodStart, periodEnd,
        ),
      ])
      return NextResponse.json({
        report: {
          year, month,
          asOf: asOf.toISOString(),
          arOutstanding: arRows[0]?.total ?? 0,
          apOutstanding: apRows[0]?.total ?? 0,
          revenueIssued: revenueRows[0]?.total ?? 0,
          invoicesIssued: revenueRows[0]?.count ?? 0,
        },
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[monthly-close POST]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
