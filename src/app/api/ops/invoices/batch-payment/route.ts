export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/invoices/batch-payment
// ──────────────────────────────────────────────────────────────────────────
// One builder check (or ACH/wire) covering N invoices. Inserts N Payment
// rows + updates each Invoice's amountPaid/balanceDue/status atomically in
// a single $transaction. If any row fails, the whole batch rolls back.
//
// Request:
//   {
//     invoiceIds: string[],          // for read-side validation
//     method: PaymentMethod,
//     reference?: string,            // required if method === 'CHECK'
//     receivedAt?: ISO string,
//     notes?: string,
//     totalAmount: number,           // user-entered total
//     distribution: Array<{ invoiceId: string, amount: number }>
//   }
//
// Auth: ADMIN, MANAGER, ACCOUNTING.
// ──────────────────────────────────────────────────────────────────────────

const VALID_METHODS = new Set(['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER'])
const CENT = (n: number) => Math.round(n * 100)

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  })
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const {
      invoiceIds,
      method,
      reference,
      receivedAt,
      notes,
      totalAmount,
      distribution,
    } = body || {}

    // ── Shape validation ────────────────────────────────────────────────
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: 'invoiceIds must be a non-empty array' }, { status: 400 })
    }
    if (!method || typeof method !== 'string' || !VALID_METHODS.has(method)) {
      return NextResponse.json({ error: 'Invalid or missing payment method' }, { status: 400 })
    }
    if (typeof totalAmount !== 'number' || !isFinite(totalAmount) || totalAmount <= 0) {
      return NextResponse.json({ error: 'totalAmount must be a positive number' }, { status: 400 })
    }
    if (!Array.isArray(distribution) || distribution.length === 0) {
      return NextResponse.json({ error: 'distribution must be a non-empty array' }, { status: 400 })
    }
    for (const row of distribution) {
      if (
        !row ||
        typeof row.invoiceId !== 'string' ||
        typeof row.amount !== 'number' ||
        !isFinite(row.amount) ||
        row.amount <= 0
      ) {
        return NextResponse.json(
          { error: 'Each distribution row needs a string invoiceId and a positive amount' },
          { status: 400 }
        )
      }
    }
    if (method === 'CHECK' && (!reference || !String(reference).trim())) {
      return NextResponse.json({ error: 'Check Number is required for check payments' }, { status: 400 })
    }

    // ── Distribution sum must match totalAmount (penny-tolerant) ────────
    const distSumCents = distribution.reduce((s, r) => s + CENT(r.amount), 0)
    const totalCents = CENT(totalAmount)
    if (Math.abs(distSumCents - totalCents) > 1) {
      return NextResponse.json(
        {
          error: `Distribution sum ($${(distSumCents / 100).toFixed(2)}) does not match total amount ($${totalAmount.toFixed(2)})`,
        },
        { status: 400 }
      )
    }

    // ── Optional receivedAt parsing ─────────────────────────────────────
    let receivedAtParam: string | null = null
    if (receivedAt !== undefined && receivedAt !== null && receivedAt !== '') {
      const d = new Date(receivedAt)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid receivedAt timestamp' }, { status: 400 })
      }
      receivedAtParam = d.toISOString()
    }

    // ── Load each target invoice fresh — never trust client balances ────
    const distInvoiceIds = distribution.map((d) => d.invoiceId)
    const invRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "total"::float AS "total", COALESCE("amountPaid",0)::float AS "amountPaid",
              ("total" - COALESCE("amountPaid",0))::float AS "balanceDue",
              "status"::text AS "status"
       FROM "Invoice" WHERE "id" = ANY($1::text[])`,
      distInvoiceIds
    )
    if (invRows.length !== distInvoiceIds.length) {
      return NextResponse.json(
        { error: 'One or more invoices not found' },
        { status: 404 }
      )
    }
    const invById = new Map<string, any>(invRows.map((r) => [r.id, r]))

    // ── Per-row balance + state-machine validation ──────────────────────
    type Plan = {
      invoiceId: string
      paymentId: string
      paymentAmount: number
      newAmountPaid: number
      newBalanceDue: number
      currentStatus: string
      newStatus: string
    }
    const plan: Plan[] = []
    for (const row of distribution) {
      const inv = invById.get(row.invoiceId)
      if (!inv) {
        return NextResponse.json({ error: `Invoice ${row.invoiceId} not found` }, { status: 404 })
      }
      if (CENT(row.amount) > CENT(inv.balanceDue) + 1) {
        return NextResponse.json(
          {
            error: `Payment for invoice ${row.invoiceId} ($${row.amount.toFixed(2)}) exceeds balance due ($${Number(inv.balanceDue).toFixed(2)})`,
          },
          { status: 400 }
        )
      }
      const newAmountPaid = Number(inv.amountPaid || 0) + Number(row.amount)
      const newBalanceDue = Math.max(0, Number(inv.total) - newAmountPaid)
      let newStatus = inv.status
      if (newBalanceDue <= 0) newStatus = 'PAID'
      else if (newAmountPaid > 0) newStatus = 'PARTIALLY_PAID'

      if (newStatus !== inv.status) {
        try {
          requireValidTransition('invoice', inv.status, newStatus)
        } catch (e) {
          const res = transitionErrorResponse(e)
          if (res) return res
          throw e
        }
      }

      plan.push({
        invoiceId: row.invoiceId,
        paymentId: `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        paymentAmount: row.amount,
        newAmountPaid,
        newBalanceDue,
        currentStatus: inv.status,
        newStatus,
      })
    }

    // ── Atomic write ────────────────────────────────────────────────────
    // All payments + invoice updates in one transaction. If any single
    // statement fails, the whole batch rolls back — no half-applied check.
    await prisma.$transaction(async (tx) => {
      for (const p of plan) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "Payment" ("id", "invoiceId", "amount", "method", "reference", "notes", "receivedAt")
           VALUES ($1, $2, $3, '${method}'::"PaymentMethod", $4, $5, COALESCE($6::timestamp, NOW()))`,
          p.paymentId,
          p.invoiceId,
          p.paymentAmount,
          reference || null,
          notes || null,
          receivedAtParam
        )

        const paidAtClause = p.newStatus === 'PAID' ? ', "paidAt" = NOW()' : ''
        await tx.$executeRawUnsafe(
          `UPDATE "Invoice"
           SET "amountPaid" = $1,
               "balanceDue" = $2,
               "status" = '${p.newStatus}'::"InvoiceStatus",
               "issuedAt" = COALESCE("issuedAt", NOW()),
               "updatedAt" = NOW() ${paidAtClause}
           WHERE "id" = $3`,
          p.newAmountPaid,
          p.newBalanceDue,
          p.invoiceId
        )
      }
    })

    // ── Audit: one batch event with full distribution detail ────────────
    await audit(request, 'RECORD_BATCH_PAYMENT', 'Invoice', undefined, {
      method,
      reference: reference || null,
      receivedAt: receivedAtParam,
      totalAmount,
      invoiceCount: plan.length,
      invoiceIds: plan.map((p) => p.invoiceId),
      distribution: plan.map((p) => ({
        invoiceId: p.invoiceId,
        amount: p.paymentAmount,
        newStatus: p.newStatus,
      })),
    })

    return NextResponse.json(
      {
        success: true,
        invoiceCount: plan.length,
        totalApplied: plan.reduce((s, p) => s + p.paymentAmount, 0),
        results: plan.map((p) => ({
          invoiceId: p.invoiceId,
          paymentId: p.paymentId,
          amount: p.paymentAmount,
          newStatus: p.newStatus,
          newBalanceDue: p.newBalanceDue,
        })),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/ops/invoices/batch-payment error:', error)
    return NextResponse.json({ error: 'Failed to record batch payment' }, { status: 500 })
  }
}
