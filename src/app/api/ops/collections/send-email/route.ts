export const dynamic = 'force-dynamic'

/**
 * POST /api/ops/collections/send-email
 *
 * Bulk collections email sender — wires up the "Send collection" buttons
 * on /ops/finance/cash (AR aging heatmap) and any future per-invoice fan-out.
 *
 * Body:
 *   {
 *     invoiceIds: string[]                    // required, one+ Invoice.id values
 *     tier?: 'friendly' | 'firm' | 'final'    // default 'friendly'
 *   }
 *
 * Behaviour (per invoice):
 *   1. Look up Invoice → Builder → primary BuilderContact (preferring
 *      receivesInvoice=true, then isPrimary=true). Same lookup pattern as the
 *      collections-email cron and send-reminder route.
 *   2. Render email body using an inlined version of the cron template
 *      (src/app/api/cron/collections-email/route.ts:generateEmail). The cron
 *      template was internal to that file and groups by builder; here we
 *      render once per invoice (one row in the heatmap → one email).
 *   3. Send via sendEmail() from @/lib/email (wrapped in the std HTML shell).
 *   4. Write a CommunicationLog row (channel=EMAIL, direction=OUTBOUND) — the
 *      platform's canonical email-tracking table.
 *   5. Write a CollectionAction row (actionType=EMAIL, notes=<tier>).
 *   6. After success, audit() the bulk operation.
 *
 * Returns:
 *   { ok: true, sent: N, failed: [{ invoiceId, error }] }
 *
 * Auth: checkStaffAuth(request) — ADMIN, MANAGER, ACCOUNTING, PROJECT_MANAGER.
 *
 * Kill switch: COLLECTIONS_EMAILS_ENABLED !== 'true' returns 503 without
 * sending — same gate the cron and per-invoice action route use.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit, getStaffFromHeaders } from '@/lib/audit'
import { sendEmail, wrap } from '@/lib/email'

type Tier = 'friendly' | 'firm' | 'final'

interface InvoiceLookup {
  id: string
  invoiceNumber: string
  builderId: string
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: Date | null
  issuedAt: Date | null
  createdAt: Date
  status: string
  builderName: string | null
  builderEmail: string | null
  builderContactName: string | null
  contactEmail: string | null
  contactName: string | null
}

function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return 'unknown date'
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function daysPastDueOf(dueDate: Date | null, fallback: Date): number {
  const ref = dueDate || fallback
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24)),
  )
}

/**
 * Render the email body. Adapted from src/app/api/cron/collections-email/
 * route.ts (generateEmail function) — same visual treatment, simplified for
 * single-invoice scope. Tier mapping: friendly → friendly, firm → firm,
 * final → warning (matches the cron's escalation tone for FINAL NOTICE).
 */
function renderEmail(
  invoice: InvoiceLookup,
  tier: Tier,
  daysOverdue: number,
): { subject: string; html: string } {
  const balance = Number(invoice.balanceDue)
  const builderLabel = invoice.builderName || 'there'
  const paymentLink = `https://app.abellumber.com/dashboard/invoices/${invoice.id}`

  let subject: string
  let greeting: string
  let body: string
  let cta: string

  switch (tier) {
    case 'friendly':
      subject = `Friendly reminder: Invoice ${invoice.invoiceNumber} is past due`
      greeting = `Hi ${builderLabel},`
      body = `Just a quick reminder that invoice <strong>#${invoice.invoiceNumber}</strong> for <strong>${formatUSD(balance)}</strong> was due on <strong>${formatDate(invoice.dueDate)}</strong>. We'd appreciate payment at your earliest convenience.`
      cta = 'Submit Payment'
      break

    case 'firm':
      subject = `Action Required: Invoice #${invoice.invoiceNumber} — ${daysOverdue} days past due`
      greeting = `${builderLabel},`
      body = `This is a formal notice that invoice <strong>#${invoice.invoiceNumber}</strong> for <strong>${formatUSD(balance)}</strong> is now <strong>${daysOverdue} days past due</strong>. Please remit payment within 7 business days to avoid further action.`
      cta = 'Pay Now'
      break

    case 'final':
      subject = `FINAL NOTICE: Invoice #${invoice.invoiceNumber} — Immediate Payment Required`
      greeting = `${builderLabel},`
      body = `Despite previous reminders, invoice <strong>#${invoice.invoiceNumber}</strong> for <strong>${formatUSD(balance)}</strong> remains unpaid at <strong>${daysOverdue} days past due</strong>. Failure to remit payment within 5 business days may result in account restrictions including credit hold.`
      cta = 'Pay Immediately'
      break
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #333;">
      <p>${greeting}</p>

      <p style="margin: 20px 0; line-height: 1.6;">
        ${body}
      </p>

      <p style="margin: 20px 0;">
        <a href="${paymentLink}" style="background-color: #C6A24E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600;">${cta}</a>
      </p>

      <p style="margin-top: 24px; font-size: 14px; color: #666;">
        If you have questions or need to discuss payment arrangements, please reply to this email or contact us at <strong>accounting@abellumber.com</strong>.
      </p>

      <p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999;">
        Abel Lumber — Doors, Trim &amp; Hardware
      </p>
    </div>
  `

  return { subject, html }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Kill switch — same gate the cron + per-invoice action route use.
  if (process.env.COLLECTIONS_EMAILS_ENABLED !== 'true') {
    return NextResponse.json(
      {
        ok: false,
        disabled: true,
        error:
          'Collections emails disabled (set COLLECTIONS_EMAILS_ENABLED=true in env to enable)',
      },
      { status: 503 },
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const invoiceIds: string[] = Array.isArray(body?.invoiceIds)
    ? body.invoiceIds.filter((x: any) => typeof x === 'string' && x.trim().length > 0)
    : []
  if (invoiceIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'invoiceIds required (non-empty string array)' },
      { status: 400 },
    )
  }

  const tierRaw = String(body?.tier ?? 'friendly').toLowerCase()
  const tier: Tier =
    tierRaw === 'firm' ? 'firm' : tierRaw === 'final' ? 'final' : 'friendly'

  const staff = getStaffFromHeaders(request.headers)

  // Bulk-load all invoices + builder + best contact in one query. Same
  // BuilderContact preference as send-reminder + per-invoice action route.
  const invoices = await prisma.$queryRawUnsafe<InvoiceLookup[]>(
    `
    SELECT
      i."id",
      i."invoiceNumber",
      i."builderId",
      i."total"::float AS "total",
      COALESCE(i."amountPaid", 0)::float AS "amountPaid",
      (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
      i."dueDate",
      i."issuedAt",
      i."createdAt",
      i."status"::text AS "status",
      b."companyName" AS "builderName",
      b."email" AS "builderEmail",
      b."contactName" AS "builderContactName",
      ic."email" AS "contactEmail",
      TRIM(CONCAT(ic."firstName", ' ', ic."lastName")) AS "contactName"
    FROM "Invoice" i
    LEFT JOIN "Builder" b ON b."id" = i."builderId"
    LEFT JOIN LATERAL (
      SELECT "email", "firstName", "lastName"
      FROM "BuilderContact"
      WHERE "builderId" = i."builderId"
        AND "active" = true
        AND "email" IS NOT NULL
      ORDER BY "receivesInvoice" DESC, "isPrimary" DESC, "createdAt" ASC
      LIMIT 1
    ) ic ON true
    WHERE i."id" = ANY($1::text[])
    `,
    invoiceIds,
  )

  const foundIds = new Set(invoices.map((i) => i.id))
  const failed: Array<{ invoiceId: string; error: string }> = []

  // Mark missing invoices as failures so the caller knows we didn't silently
  // drop them.
  for (const id of invoiceIds) {
    if (!foundIds.has(id)) {
      failed.push({ invoiceId: id, error: 'Invoice not found' })
    }
  }

  let sent = 0

  for (const invoice of invoices) {
    const to = invoice.contactEmail || invoice.builderEmail
    if (!to) {
      failed.push({ invoiceId: invoice.id, error: 'No email on file for builder' })
      continue
    }

    const refDate = invoice.dueDate || invoice.issuedAt || invoice.createdAt
    const daysOverdue = daysPastDueOf(invoice.dueDate, invoice.issuedAt || invoice.createdAt)
    const { subject, html } = renderEmail(invoice, tier, daysOverdue)

    let messageId: string | null = null
    let sendError: string | null = null
    try {
      const res = await sendEmail({
        to,
        subject,
        html: wrap(html),
        replyTo: 'accounting@abellumber.com',
      })
      if (res.success) {
        messageId = res.id ?? null
      } else {
        sendError = res.error || 'Email send failed'
      }
    } catch (e: any) {
      sendError = e?.message || String(e)
    }

    if (sendError) {
      failed.push({ invoiceId: invoice.id, error: sendError })
      // Still log the attempted send for forensic trail.
    }

    // CommunicationLog row — the platform's canonical email-tracking table.
    // (No EmailEvent model exists; this is the equivalent.)
    try {
      await prisma.communicationLog.create({
        data: {
          builderId: invoice.builderId,
          staffId: staff.staffId !== 'unknown' ? staff.staffId : null,
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          subject,
          bodyHtml: html,
          fromAddress:
            process.env.RESEND_FROM_EMAIL || 'Abel Lumber <noreply@abellumber.com>',
          toAddresses: [to],
          sentAt: sendError ? null : new Date(),
          status: 'LOGGED',
        },
      })
    } catch (e) {
      // Non-fatal — we don't want logging hiccups to block other sends.
      console.warn(
        '[collections/send-email] CommunicationLog write failed:',
        e instanceof Error ? e.message : String(e),
      )
    }

    // CollectionAction row — per spec, one per invoice, actionType=EMAIL,
    // notes carries the tier (and any send error for forensic trail).
    const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    try {
      const noteParts = [
        `tier=${tier}`,
        `daysOverdue=${daysOverdue}`,
        `to=${to}`,
        sendError ? `error=${sendError}` : `messageId=${messageId || 'none'}`,
      ]
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CollectionAction"
           ("id", "invoiceId", "actionType", "channel", "sentBy", "notes", "sentAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        actionId,
        invoice.id,
        'EMAIL',
        'EMAIL',
        staff.staffId !== 'unknown' ? staff.staffId : null,
        noteParts.join(' | '),
      )
    } catch (e) {
      console.warn(
        '[collections/send-email] CollectionAction write failed:',
        e instanceof Error ? e.message : String(e),
      )
    }

    if (!sendError) sent++

    // Promote ISSUED/SENT past-due invoices to OVERDUE — same behaviour as
    // the cron once an email has gone out and the builder has been notified.
    if (!sendError && daysOverdue > 0) {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Invoice"
           SET "status" = 'OVERDUE', "updatedAt" = NOW()
           WHERE "id" = $1 AND "status"::text IN ('ISSUED', 'SENT')`,
          invoice.id,
        )
      } catch (e) {
        // Non-fatal.
        console.warn(
          '[collections/send-email] OVERDUE promotion failed:',
          e instanceof Error ? e.message : String(e),
        )
      }
    }

    // Suppress unused warning on refDate — kept for future use if we expand
    // the template to surface more invoice context.
    void refDate
  }

  await audit(request, 'SEND_EMAIL', 'CollectionAction', undefined, {
    tier,
    requestedCount: invoiceIds.length,
    sent,
    failedCount: failed.length,
    failedSample: failed.slice(0, 5),
  })

  return NextResponse.json({
    ok: true,
    sent,
    failed,
  })
}
