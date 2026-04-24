export const dynamic = 'force-dynamic'

/**
 * POST /api/ops/collections/send-reminder
 *
 * One-click AR-reminder sender for the Collections cockpit (Wave 3, Agent C3).
 *
 * Accepts { builderId } in the JSON body. Looks up every outstanding invoice
 * for that builder, renders the AR-reminder template (src/lib/resend/templates/
 * ar-reminder.ts, shipped by B8), and sends via `sendEmail` from
 * src/lib/email.ts.
 *
 * Contract:
 *   • Feature flag: process.env.FEATURE_COLLECTIONS_SEND_REMINDER !== 'off'
 *     (default ON). When disabled, returns 503 with { ok: false, disabled: true }.
 *   • Dry-run: if process.env.RESEND_API_KEY is missing OR process.env.DRY_RUN
 *     === '1', no email is sent and the response is
 *     { ok: true, dryRun: true, would: { to, subject, invoiceCount, total } }.
 *   • Audit: every invocation (live OR dry-run) writes an AuditLog row with
 *     entity:'collections', action:'SEND_REMINDER', including builderId,
 *     invoice count, and total outstanding.
 *
 * Why a separate endpoint (not reusing [invoiceId]/action):
 *   The existing `action` route works per-invoice and fires per-invoice
 *   templates (Day-15/30/45/60). This endpoint is a single email summarizing
 *   every open balance for a builder — matches Amanda-at-Brookfield / Dawn
 *   Monday-cockpit ergonomics. One click, one email, all outstanding lines.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { sendEmail } from '@/lib/email'
import { renderARReminder } from '@/lib/resend/templates/ar-reminder'

interface InvoiceRow {
  id: string
  invoiceNumber: string
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: Date | null
  issuedAt: Date | null
  createdAt: Date
}

interface BuilderRow {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phone: string | null
}

function daysPastDueOf(ref: Date | null, fallback: Date): number {
  const d = ref || fallback
  const ms = Date.now() - d.getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export async function POST(request: NextRequest) {
  // Feature flag — default ON. Only an explicit "off" disables.
  if (process.env.FEATURE_COLLECTIONS_SEND_REMINDER === 'off') {
    return NextResponse.json(
      { ok: false, disabled: true, error: 'Collections send-reminder is disabled' },
      { status: 503 },
    )
  }

  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const { session } = auth

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const builderId = typeof body?.builderId === 'string' ? body.builderId.trim() : ''
  if (!builderId) {
    return NextResponse.json({ ok: false, error: 'builderId required' }, { status: 400 })
  }

  try {
    const builderRows = await prisma.$queryRawUnsafe<BuilderRow[]>(
      `SELECT "id", "companyName", "contactName", "email", "phone"
       FROM "Builder" WHERE "id" = $1 LIMIT 1`,
      builderId,
    )
    if (builderRows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Builder not found' }, { status: 404 })
    }
    const builder = builderRows[0]

    // Prefer a BuilderContact with receivesInvoice=true, fall back to primary,
    // fall back to the Builder.email on the record.
    const contactRows = await prisma.$queryRawUnsafe<Array<{
      firstName: string
      lastName: string
      email: string | null
    }>>(
      `SELECT "firstName", "lastName", "email"
       FROM "BuilderContact"
       WHERE "builderId" = $1
         AND "active" = true
         AND "email" IS NOT NULL
       ORDER BY "receivesInvoice" DESC, "isPrimary" DESC, "createdAt" ASC
       LIMIT 1`,
      builderId,
    )

    const preferredContactEmail = contactRows[0]?.email || null
    const preferredContactName = contactRows[0]
      ? `${contactRows[0].firstName} ${contactRows[0].lastName}`.trim()
      : null

    const to = preferredContactEmail || builder.email
    const contactName = preferredContactName || builder.contactName || builder.companyName

    if (!to) {
      return NextResponse.json(
        { ok: false, error: 'No email on file for this builder' },
        { status: 422 },
      )
    }

    const invoices = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `
      SELECT
        "id", "invoiceNumber",
        "total"::float AS "total",
        COALESCE("amountPaid", 0)::float AS "amountPaid",
        ("total" - COALESCE("amountPaid", 0))::float AS "balanceDue",
        "dueDate", "issuedAt", "createdAt"
      FROM "Invoice"
      WHERE "builderId" = $1
        AND "status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND ("total" - COALESCE("amountPaid", 0)) > 0
      ORDER BY "dueDate" ASC NULLS LAST
      `,
      builderId,
    )

    if (invoices.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No outstanding invoices for this builder' },
        { status: 422 },
      )
    }

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + Number(inv.balanceDue),
      0,
    )

    const templateInvoices = invoices.map((inv) => ({
      number: inv.invoiceNumber,
      dueDate: inv.dueDate || inv.issuedAt || inv.createdAt,
      amount: Number(inv.balanceDue),
      daysPastDue: daysPastDueOf(inv.dueDate, inv.issuedAt || inv.createdAt),
    }))

    const rendered = await renderARReminder({
      builderName: builder.companyName,
      contactName,
      invoices: templateInvoices,
      totalOutstanding,
      contactPhoneFallback: builder.phone || undefined,
      senderName: 'Abel Lumber Accounting',
    })

    // Dry-run detection — no key OR explicit DRY_RUN flag.
    const dryRun =
      process.env.DRY_RUN === '1' || !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.length === 0

    if (dryRun) {
      await logAudit({
        staffId: session.staffId,
        staffName: `${session.firstName || ''} ${session.lastName || ''}`.trim() || session.email,
        action: 'SEND_REMINDER',
        entity: 'collections',
        entityId: builderId,
        details: {
          builderId,
          builderName: builder.companyName,
          to,
          subject: rendered.subject,
          invoiceCount: invoices.length,
          totalOutstanding,
          dryRun: true,
          reason: process.env.DRY_RUN === '1' ? 'DRY_RUN=1' : 'RESEND_API_KEY missing',
        },
        severity: 'INFO',
      })
      return NextResponse.json({
        ok: true,
        dryRun: true,
        would: {
          to,
          subject: rendered.subject,
          invoiceCount: invoices.length,
          total: totalOutstanding,
        },
      })
    }

    const sendResult = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      replyTo: 'billing@abellumber.com',
    })

    await logAudit({
      staffId: session.staffId,
      staffName: `${session.firstName || ''} ${session.lastName || ''}`.trim() || session.email,
      action: 'SEND_REMINDER',
      entity: 'collections',
      entityId: builderId,
      details: {
        builderId,
        builderName: builder.companyName,
        to,
        subject: rendered.subject,
        invoiceCount: invoices.length,
        totalOutstanding,
        success: sendResult.success,
        messageId: sendResult.success ? sendResult.id : null,
        error: sendResult.success ? null : sendResult.error || null,
      },
      severity: sendResult.success ? 'INFO' : 'WARN',
    })

    if (!sendResult.success) {
      return NextResponse.json(
        {
          ok: false,
          error: sendResult.error || 'Email send failed',
          invoiceCount: invoices.length,
          total: totalOutstanding,
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      messageId: sendResult.id,
      to,
      subject: rendered.subject,
      invoiceCount: invoices.length,
      total: totalOutstanding,
    })
  } catch (error: any) {
    console.error('POST /api/ops/collections/send-reminder error:', error)
    // Best-effort audit of the failure itself so forensic trail exists.
    try {
      await logAudit({
        staffId: session.staffId,
        action: 'SEND_REMINDER',
        entity: 'collections',
        entityId: builderId,
        details: {
          builderId,
          error: error?.message || String(error),
          stage: 'exception',
        },
        severity: 'WARN',
      })
    } catch {}
    return NextResponse.json(
      { ok: false, error: 'Failed to send reminder', detail: error?.message || null },
      { status: 500 },
    )
  }
}
