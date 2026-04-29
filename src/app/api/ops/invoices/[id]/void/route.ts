export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

interface RouteParams {
  params: { id: string }
}

// POST /api/ops/invoices/[id]/void — Void an invoice.
// Body: { reason: string }
// Guards: state machine (current → VOID), role (ADMIN | MANAGER | ACCOUNTING).
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  })
  if (auth.error) return auth.error

  try {
    const { id } = params
    const body = await request.json().catch(() => ({}))
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required to void an invoice.' },
        { status: 400 }
      )
    }

    // Load current status
    const currentRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "invoiceNumber", "status"::text AS "status"
       FROM "Invoice" WHERE "id" = $1`,
      id
    )
    if (currentRows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    const current = currentRows[0]

    // State-machine guard
    try {
      requireValidTransition('invoice', current.status, 'VOID')
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // Update — set status, append reason to notes for traceability.
    await prisma.$executeRawUnsafe(
      `UPDATE "Invoice"
         SET "status" = 'VOID'::"InvoiceStatus",
             "notes" = COALESCE("notes" || E'\n\n', '') ||
                       'VOID (' || NOW()::text || '): ' || $2,
             "updatedAt" = NOW()
       WHERE "id" = $1`,
      id,
      reason
    )

    await audit(request, 'VOID', 'Invoice', id, {
      invoiceNumber: current.invoiceNumber,
      from: current.status,
      to: 'VOID',
      reason,
    })

    return NextResponse.json({
      success: true,
      id,
      status: 'VOID',
    })
  } catch (error) {
    console.error('POST /api/ops/invoices/[id]/void error:', error)
    return NextResponse.json({ error: 'Failed to void invoice' }, { status: 500 })
  }
}
