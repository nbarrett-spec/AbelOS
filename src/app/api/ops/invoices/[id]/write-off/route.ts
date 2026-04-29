export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

interface RouteParams {
  params: { id: string }
}

// POST /api/ops/invoices/[id]/write-off — Write off an invoice (admin-only).
// Body: { amount: number, reason: string }
//
// State machine note: WRITE_OFF is only directly reachable from VOID. We honor
// that by validating current → VOID, then VOID → WRITE_OFF, then performing a
// single UPDATE that lands the row in WRITE_OFF. Guard rails stay intact: any
// disallowed source state (PAID, WRITE_OFF, etc.) errors before we touch the row.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN'] })
  if (auth.error) return auth.error

  try {
    const { id } = params
    const body = await request.json().catch(() => ({}))
    const amount = Number(body?.amount)
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'A positive write-off amount is required.' },
        { status: 400 }
      )
    }
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required to write off an invoice.' },
        { status: 400 }
      )
    }

    // Load current status + balance for sanity-check on amount.
    const currentRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "invoiceNumber", "status"::text AS "status",
              "total", "amountPaid",
              ("total" - COALESCE("amountPaid", 0))::float AS "balanceDue"
         FROM "Invoice" WHERE "id" = $1`,
      id
    )
    if (currentRows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    const current = currentRows[0]

    // Don't let write-offs exceed the outstanding balance.
    if (amount > Number(current.balanceDue) + 0.01) {
      return NextResponse.json(
        {
          error: `Write-off amount ($${amount.toFixed(2)}) exceeds balance due ($${Number(current.balanceDue).toFixed(2)}).`,
        },
        { status: 400 }
      )
    }

    // State-machine guards: must be able to reach WRITE_OFF via VOID.
    try {
      if (current.status !== 'VOID') {
        requireValidTransition('invoice', current.status, 'VOID')
      }
      requireValidTransition('invoice', 'VOID', 'WRITE_OFF')
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // Single UPDATE — final status is WRITE_OFF, append a structured note.
    await prisma.$executeRawUnsafe(
      `UPDATE "Invoice"
         SET "status" = 'WRITE_OFF'::"InvoiceStatus",
             "notes" = COALESCE("notes" || E'\n\n', '') ||
                       'WRITE_OFF (' || NOW()::text || '): $' || $2 || ' — ' || $3,
             "updatedAt" = NOW()
       WHERE "id" = $1`,
      id,
      amount.toFixed(2),
      reason
    )

    await audit(request, 'WRITE_OFF', 'Invoice', id, {
      invoiceNumber: current.invoiceNumber,
      from: current.status,
      to: 'WRITE_OFF',
      amount,
      reason,
    })

    return NextResponse.json({
      success: true,
      id,
      status: 'WRITE_OFF',
      amount,
    })
  } catch (error) {
    console.error('POST /api/ops/invoices/[id]/write-off error:', error)
    return NextResponse.json({ error: 'Failed to write off invoice' }, { status: 500 })
  }
}
