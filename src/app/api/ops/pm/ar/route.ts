export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/ar
//
// PM-scoped accounts-receivable summary. Returns the open invoice picture
// for the *current* logged-in staff member where Job.assignedPMId matches.
//
// This is intentionally a thin, read-only counterpart to /api/ops/finance/ar.
// PMs see their own book of business — outstanding $, count of overdue
// invoices, and aging bucket counts — without exposing the company-wide
// finance dashboard.
//
// Response shape (frozen for the client):
//   {
//     asOf: string,
//     pmId: string,
//     outstanding: number,           // total balanceDue across all open invoices
//     overdueCount: number,          // invoices with daysPastDue > 0
//     aging: {
//       '0-30': number,              // count of invoices with daysPastDue <= 30
//       '31-60': number,
//       '61-90': number,
//       '90+': number,
//     }
//   }
//
// "Open" = status IN (ISSUED, SENT, PARTIALLY_PAID, OVERDUE) AND balanceDue > 0.
// "Days past due" follows the same priority as /api/ops/finance/ar:
// dueDate -> issuedAt -> createdAt.
//
// Auth: handled by checkStaffAuth() + the /api/ops/pm role gate
// (ADMIN, MANAGER, PROJECT_MANAGER only).
// ──────────────────────────────────────────────────────────────────────────

interface PmInvoiceRow {
  id: string
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: Date | null
  issuedAt: Date | null
  createdAt: Date
}

type AgingBucket = '0-30' | '31-60' | '61-90' | '90+'

function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 30) return '0-30'
  if (daysPastDue <= 60) return '31-60'
  if (daysPastDue <= 90) return '61-90'
  return '90+'
}

function daysDiff(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const pmId = request.headers.get('x-staff-id') || ''
  if (!pmId) {
    return NextResponse.json(
      { error: 'Missing staff context' },
      { status: 401 }
    )
  }

  try {
    // Pull only the open invoices tied to jobs this PM owns. We do the join
    // in SQL because Invoice has no Prisma relation to Builder/Job (the
    // schema keeps those FKs unrelated to keep migrations cheap), but jobId
    // is a plain string column we can join on.
    const rows = await prisma.$queryRawUnsafe<PmInvoiceRow[]>(
      `
      SELECT
        i."id",
        i."total"::float AS "total",
        COALESCE(i."amountPaid", 0)::float AS "amountPaid",
        (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
        i."dueDate", i."issuedAt", i."createdAt"
      FROM "Invoice" i
      INNER JOIN "Job" j ON j."id" = i."jobId"
      WHERE j."assignedPMId" = $1
        AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      `,
      pmId
    )

    const now = new Date()
    let outstanding = 0
    let overdueCount = 0
    const aging: Record<AgingBucket, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    }

    for (const r of rows) {
      const balance = Number(r.balanceDue)
      if (balance <= 0) continue
      outstanding += balance

      const refDate = r.dueDate || r.issuedAt || r.createdAt
      const daysPastDue = daysDiff(now, refDate)
      if (daysPastDue > 0) overdueCount++
      aging[bucketFor(daysPastDue)]++
    }

    return safeJson({
      asOf: now.toISOString(),
      pmId,
      outstanding,
      overdueCount,
      aging,
    })
  } catch (error: any) {
    console.error('[PM AR] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load PM AR summary.', detail: error?.message },
      { status: 500 }
    )
  }
}
