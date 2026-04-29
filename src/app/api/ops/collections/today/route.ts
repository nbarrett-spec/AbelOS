export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/collections/today
//
// Returns the collection queue Dawn should work today: every invoice whose
// days-past-due is at or beyond any active CollectionRule threshold, annotated
// with the recommended next action, last contact, and days-past-due.
//
// The recommended "nextAction" is chosen by matching the most aggressive
// CollectionRule the invoice is eligible for that hasn't already been fired
// as a CollectionAction. That means:
//
//   Day 15 → REMINDER       (if no REMINDER logged yet)
//   Day 30 → PAST_DUE       (if no PAST_DUE logged yet)
//   Day 45 → FINAL_NOTICE   (if no FINAL_NOTICE logged yet)
//   Day 60 → ACCOUNT_HOLD   (if no ACCOUNT_HOLD logged yet)
//
// If every rule has already fired, nextAction = 'FOLLOW_UP' so Dawn knows the
// automated cadence is spent and this one needs human work.
// ──────────────────────────────────────────────────────────────────────────

interface OverdueInvoiceRow {
  id: string
  invoiceNumber: string
  builderId: string
  builderName: string | null
  builderContactName: string | null
  builderEmail: string | null
  builderPhone: string | null
  total: number
  amountPaid: number
  balanceDue: number
  status: string
  dueDate: Date | null
  issuedAt: Date | null
  createdAt: Date
}

interface CollectionRuleRow {
  id: string
  name: string
  daysOverdue: number
  actionType: string
  channel: string
  isActive: boolean
}

interface CollectionActionRow {
  id: string
  invoiceId: string
  actionType: string
  channel: string
  sentAt: Date
  sentBy: string | null
  notes: string | null
}

interface PaymentRow {
  id: string
  invoiceId: string
  amount: number
  method: string
  reference: string | null
  receivedAt: Date
}

function daysDiff(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rules = await prisma.$queryRawUnsafe<CollectionRuleRow[]>(
      `SELECT "id", "name", "daysOverdue", "actionType", "channel", "isActive"
       FROM "CollectionRule"
       WHERE "isActive" = true
       ORDER BY "daysOverdue" ASC`,
    )

    const invoices = await prisma.$queryRawUnsafe<OverdueInvoiceRow[]>(`
      SELECT
        i."id", i."invoiceNumber", i."builderId",
        i."total"::float AS "total",
        COALESCE(i."amountPaid", 0)::float AS "amountPaid",
        (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
        i."status"::text AS "status",
        i."dueDate", i."issuedAt", i."createdAt",
        b."companyName" AS "builderName",
        b."contactName" AS "builderContactName",
        b."email" AS "builderEmail",
        b."phone" AS "builderPhone"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      ORDER BY i."dueDate" ASC NULLS LAST
    `)

    const invoiceIds = invoices.map((i) => i.id)
    let actionsByInvoice = new Map<string, CollectionActionRow[]>()
    let paymentsByInvoice = new Map<string, PaymentRow[]>()
    if (invoiceIds.length > 0) {
      const placeholders = invoiceIds.map((_, idx) => `$${idx + 1}`).join(', ')
      const actions = await prisma.$queryRawUnsafe<CollectionActionRow[]>(
        `SELECT "id", "invoiceId", "actionType", "channel", "sentAt", "sentBy", "notes"
         FROM "CollectionAction"
         WHERE "invoiceId" IN (${placeholders})
         ORDER BY "sentAt" DESC`,
        ...invoiceIds,
      )
      for (const a of actions) {
        const list = actionsByInvoice.get(a.invoiceId) || []
        list.push(a)
        actionsByInvoice.set(a.invoiceId, list)
      }

      // Pull recent payments per invoice so the action card can show prior
      // payment history inline (FIX-16). SELECT-only — no business logic.
      const payments = await prisma.$queryRawUnsafe<PaymentRow[]>(
        `SELECT "id", "invoiceId", "amount"::float AS "amount",
                "method"::text AS "method", "reference", "receivedAt"
         FROM "Payment"
         WHERE "invoiceId" IN (${placeholders})
         ORDER BY "receivedAt" DESC`,
        ...invoiceIds,
      )
      for (const p of payments) {
        const list = paymentsByInvoice.get(p.invoiceId) || []
        list.push(p)
        paymentsByInvoice.set(p.invoiceId, list)
      }
    }

    const now = new Date()
    const queue: any[] = []

    for (const inv of invoices) {
      const refDate = inv.dueDate || inv.issuedAt || inv.createdAt
      const daysPastDue = daysDiff(now, refDate)
      if (daysPastDue <= 0) continue

      // Eligible rules = rules whose threshold we've crossed. Consider from
      // most aggressive down, skipping rules already fired.
      const eligible = [...rules]
        .filter((r) => r.daysOverdue <= daysPastDue)
        .sort((a, b) => b.daysOverdue - a.daysOverdue)
      if (eligible.length === 0) continue

      const alreadyFiredTypes = new Set(
        (actionsByInvoice.get(inv.id) || []).map((a) => a.actionType),
      )
      const unfired = eligible.find((r) => !alreadyFiredTypes.has(r.actionType))

      const priorActions = actionsByInvoice.get(inv.id) || []
      const lastContact = priorActions[0] || null

      const nextAction = unfired
        ? {
            ruleId: unfired.id,
            ruleName: unfired.name,
            actionType: unfired.actionType,
            channel: unfired.channel,
            triggerDays: unfired.daysOverdue,
          }
        : {
            ruleId: null,
            ruleName: 'Human follow-up',
            actionType: 'FOLLOW_UP',
            channel: 'PHONE',
            triggerDays: null,
          }

      queue.push({
        invoice: {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          total: Number(inv.total),
          amountPaid: Number(inv.amountPaid),
          balanceDue: Number(inv.balanceDue),
          status: inv.status,
          dueDate: inv.dueDate?.toISOString() || null,
          issuedAt: inv.issuedAt?.toISOString() || null,
          daysPastDue,
        },
        builder: {
          id: inv.builderId,
          name: inv.builderName || 'Unknown',
          contactName: inv.builderContactName || null,
          email: inv.builderEmail || null,
          phone: inv.builderPhone || null,
        },
        nextAction,
        lastContact: lastContact
          ? {
              actionType: lastContact.actionType,
              channel: lastContact.channel,
              sentAt: lastContact.sentAt.toISOString(),
              sentBy: lastContact.sentBy,
              notes: lastContact.notes,
            }
          : null,
        priorActionCount: priorActions.length,
        priorActions: priorActions.map((a) => ({
          id: a.id,
          actionType: a.actionType,
          channel: a.channel,
          sentAt: a.sentAt.toISOString(),
          sentBy: a.sentBy,
          notes: a.notes,
        })),
        priorPayments: (paymentsByInvoice.get(inv.id) || []).map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference,
          receivedAt: p.receivedAt.toISOString(),
        })),
      })
    }

    // Sort: unfired-ladder items first, then by daysPastDue desc so oldest
    // skeletons surface to the top. Within that, balanceDue desc as a
    // secondary sort — Dawn collects the big ones first if everything else
    // ties.
    queue.sort((a, b) => {
      const aFired = a.nextAction.actionType === 'FOLLOW_UP' ? 1 : 0
      const bFired = b.nextAction.actionType === 'FOLLOW_UP' ? 1 : 0
      if (aFired !== bFired) return aFired - bFired
      if (b.invoice.daysPastDue !== a.invoice.daysPastDue) {
        return b.invoice.daysPastDue - a.invoice.daysPastDue
      }
      return b.invoice.balanceDue - a.invoice.balanceDue
    })

    const totalOutstanding = queue.reduce(
      (sum, row) => sum + Number(row.invoice.balanceDue),
      0,
    )

    return NextResponse.json({
      asOf: now.toISOString(),
      total: queue.length,
      totalOutstanding,
      queue,
    })
  } catch (error) {
    console.error('GET /api/ops/collections/today error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch collections queue' },
      { status: 500 },
    )
  }
}
