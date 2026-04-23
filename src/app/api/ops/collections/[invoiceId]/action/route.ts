export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { sendDay15ReminderEmail } from '@/lib/email/collections/day-15-reminder'
import { sendDay30PastDueEmail } from '@/lib/email/collections/day-30-past-due'
import { sendDay45FinalNoticeEmail } from '@/lib/email/collections/day-45-final'
import { sendDay60HoldEmail } from '@/lib/email/collections/day-60-hold'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/collections/[invoiceId]/action
//
// Logs a collection action against an invoice and, when applicable, fires
// the matching email template through Resend. Intended for the Dawn
// collection-center UI — every row has quick-action buttons and each click
// POSTs here.
//
// Body:
//   actionType   — REMINDER | PAST_DUE | FINAL_NOTICE | ACCOUNT_HOLD
//                  | PHONE_CALL | PAYMENT_PLAN | NOTE | PROMISED | FOLLOW_UP
//   channel      — EMAIL | PHONE | SMS | LETTER | NOTE          (default EMAIL)
//   notes        — free-form text
//   sendEmail    — if true and actionType maps to a template, also email the
//                  builder (auto-picks Day-15/30/45/60 template). Defaults
//                  to false so "Log phone call" and "Mark promised" don't
//                  spam the builder.
// ──────────────────────────────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set([
  'REMINDER',
  'PAST_DUE',
  'FINAL_NOTICE',
  'ACCOUNT_HOLD',
  'PHONE_CALL',
  'PAYMENT_PLAN',
  'NOTE',
  'PROMISED',
  'FOLLOW_UP',
])

const VALID_CHANNELS = new Set(['EMAIL', 'PHONE', 'SMS', 'LETTER', 'NOTE'])

const EMAIL_TEMPLATE_FOR_ACTION: Record<string, 'DAY_15' | 'DAY_30' | 'DAY_45' | 'DAY_60'> = {
  REMINDER: 'DAY_15',
  PAST_DUE: 'DAY_30',
  FINAL_NOTICE: 'DAY_45',
  ACCOUNT_HOLD: 'DAY_60',
}

interface InvoiceLookup {
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
  builderContactName: string | null
  builderEmail: string | null
  invoiceContactEmail: string | null
  invoiceContactName: string | null
}

export async function POST(
  request: NextRequest,
  context: { params: { invoiceId: string } },
) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const { session } = auth

  const { invoiceId } = context.params
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const actionType = String(body.actionType || '').toUpperCase()
  const channel = String(body.channel || 'EMAIL').toUpperCase()
  const notes: string | null = body.notes ? String(body.notes) : null
  const sendEmailToo = Boolean(body.sendEmail)

  if (!VALID_ACTION_TYPES.has(actionType)) {
    return NextResponse.json(
      {
        error: `Invalid actionType. Must be one of: ${[...VALID_ACTION_TYPES].join(', ')}`,
      },
      { status: 400 },
    )
  }
  if (!VALID_CHANNELS.has(channel)) {
    return NextResponse.json(
      { error: `Invalid channel. Must be one of: ${[...VALID_CHANNELS].join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const rows = await prisma.$queryRawUnsafe<InvoiceLookup[]>(
      `
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
        ic."email" AS "invoiceContactEmail",
        ic."firstName" AS "invoiceContactName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      LEFT JOIN LATERAL (
        SELECT "email", "firstName"
        FROM "BuilderContact"
        WHERE "builderId" = i."builderId"
          AND "active" = true
          AND "email" IS NOT NULL
          AND "receivesInvoice" = true
        ORDER BY "isPrimary" DESC, "createdAt" ASC
        LIMIT 1
      ) ic ON true
      WHERE i."id" = $1
      LIMIT 1
    `,
      invoiceId,
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = rows[0]
    const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Fire the email first (if requested) so we can record success/failure
    // in the notes. Keeps the audit trail honest.
    let emailResult: { attempted: boolean; success: boolean; error?: string | null } = {
      attempted: false,
      success: false,
      error: null,
    }

    if (sendEmailToo && channel === 'EMAIL') {
      const templateKey = EMAIL_TEMPLATE_FOR_ACTION[actionType]
      if (templateKey) {
        const to = invoice.invoiceContactEmail || invoice.builderEmail
        const contactName =
          invoice.invoiceContactName ||
          invoice.builderContactName ||
          invoice.builderName ||
          'there'
        const builderName = invoice.builderName || 'your account'
        if (!to) {
          emailResult = { attempted: true, success: false, error: 'No contact email on file' }
        } else {
          const refDate = invoice.dueDate || invoice.issuedAt || invoice.createdAt
          const dueDate = new Date(refDate)
          const daysPastDue = Math.max(
            0,
            Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24)),
          )
          const baseParams = {
            to,
            contactName,
            builderName,
            invoiceNumber: invoice.invoiceNumber,
            balanceDue: Number(invoice.balanceDue),
            originalDueDate: dueDate,
            daysPastDue,
          }
          try {
            let res: { success: boolean; error?: string }
            if (templateKey === 'DAY_15') res = await sendDay15ReminderEmail(baseParams)
            else if (templateKey === 'DAY_30') res = await sendDay30PastDueEmail(baseParams)
            else if (templateKey === 'DAY_45') res = await sendDay45FinalNoticeEmail(baseParams)
            else {
              // DAY_60 — also grab total outstanding for the account
              const totalRow = await prisma.$queryRawUnsafe<Array<{ sum: number | null }>>(
                `SELECT COALESCE(SUM(i."total" - COALESCE(i."amountPaid", 0)), 0)::float AS "sum"
                 FROM "Invoice" i
                 WHERE i."builderId" = $1
                   AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
                   AND (i."total" - COALESCE(i."amountPaid", 0)) > 0`,
                invoice.builderId,
              )
              res = await sendDay60HoldEmail({
                ...baseParams,
                totalOutstanding: Number(totalRow[0]?.sum ?? invoice.balanceDue),
              })
            }
            emailResult = { attempted: true, success: res.success, error: res.error || null }
          } catch (e: any) {
            emailResult = { attempted: true, success: false, error: e?.message || String(e) }
          }
        }
      } else {
        emailResult = {
          attempted: true,
          success: false,
          error: `No email template for actionType=${actionType}`,
        }
      }
    }

    const finalNote = [
      notes || null,
      emailResult.attempted
        ? `Email send: ${emailResult.success ? 'OK' : 'FAILED' + (emailResult.error ? ` (${emailResult.error})` : '')}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ') || null

    await prisma.$executeRawUnsafe(
      `INSERT INTO "CollectionAction"
         ("id", "invoiceId", "actionType", "channel", "sentBy", "notes", "sentAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      actionId,
      invoiceId,
      actionType,
      channel,
      session.staffId,
      finalNote,
    )

    // Account-hold side-effect: suspend the builder. Mirrors the behaviour
    // of the legacy /api/ops/collections POST handler so both routes land in
    // the same account state.
    if (actionType === 'ACCOUNT_HOLD') {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Builder"
           SET "status" = 'SUSPENDED'::"AccountStatus", "updatedAt" = NOW()
           WHERE "id" = $1`,
          invoice.builderId,
        )
      } catch (e) {
        console.error('[collections/action] account hold suspend failed:', e)
      }
    }

    await audit(request, 'CREATE', 'CollectionAction', actionId, {
      invoiceId,
      actionType,
      channel,
      emailSent: emailResult.attempted && emailResult.success,
    })

    return NextResponse.json({
      success: true,
      actionId,
      email: emailResult,
    })
  } catch (error: any) {
    console.error('POST /api/ops/collections/[invoiceId]/action error:', error)
    return NextResponse.json(
      { error: 'Failed to log collection action', detail: error?.message || null },
      { status: 500 },
    )
  }
}
