export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, wrap } from '@/lib/email'
import crypto from 'crypto'
import { withCronRun } from '@/lib/cron'

interface OverdueInvoice {
  id: string
  invoiceNumber: string
  total: number
  dueDate: Date
  daysOverdue: number
  builderName: string
  builderId: string
  billingEmail: string | null
  email: string | null
}

interface BuilderInvoices {
  builderId: string
  builderName: string
  contactEmail: string
  invoices: OverdueInvoice[]
  maxDaysOverdue: number
  totalAmount: number
}

type CollectionTier = 'friendly' | 'firm' | 'warning' | 'hold'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun('collections-email', async () => {
    // ── Kill switch: collections emails are OFF until explicitly enabled ──
    // Recorded as SUCCESS skipped=true so /admin/crons shows the cron is alive
    // even when the kill switch is on (mirrors pm-daily-digest pattern).
    if (process.env.COLLECTIONS_EMAILS_ENABLED !== 'true') {
      return NextResponse.json({
        success: true,
        skipped: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skippedCount: 1,
        notes: 'Kill switch off: COLLECTIONS_EMAILS_ENABLED !== "true"',
        reason: 'Collections emails disabled (set COLLECTIONS_EMAILS_ENABLED=true to enable)',
      })
    }

    try {
      // Query overdue invoices with builder contact info
      const overdueInvoices = await prisma.$queryRawUnsafe<OverdueInvoice[]>(`
      SELECT
        i."id",
        i."invoiceNumber",
        i."total"::float AS "total",
        i."dueDate",
        EXTRACT(DAY FROM (NOW() - i."dueDate"))::int AS "daysOverdue",
        b."companyName" AS "builderName",
        b."id" AS "builderId",
        b."email",
        b."email"
      FROM "Invoice" i
      JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'OVERDUE', 'PARTIALLY_PAID')
        AND i."dueDate" < NOW()
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      ORDER BY "daysOverdue" DESC
    `)

    if (overdueInvoices.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No overdue invoices found',
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        notes: 'No overdue invoices found in scan window',
        emailsSent: { friendly: 0, firm: 0, warning: 0, hold: 0 },
        totalOutstanding: 0,
        timestamp: new Date().toISOString(),
      })
    }

    // Group invoices by builder
    const builderMap = new Map<string, BuilderInvoices>()

    for (const invoice of overdueInvoices) {
      const key = invoice.builderId
      if (!builderMap.has(key)) {
        builderMap.set(key, {
          builderId: invoice.builderId,
          builderName: invoice.builderName,
          contactEmail: invoice.billingEmail || invoice.email || '',
          invoices: [],
          maxDaysOverdue: 0,
          totalAmount: 0,
        })
      }

      const builder = builderMap.get(key)!
      builder.invoices.push(invoice)
      builder.maxDaysOverdue = Math.max(builder.maxDaysOverdue, invoice.daysOverdue)
      builder.totalAmount += invoice.total
    }

    const emailsSent = { friendly: 0, firm: 0, warning: 0, hold: 0 }
    let totalOutstanding = 0
    let failedSends = 0
    let skippedNoEmail = 0

    // Send one email per builder with their tier
    for (const builder of builderMap.values()) {
      if (!builder.contactEmail) {
        console.warn(`No contact email for builder ${builder.builderId}`)
        skippedNoEmail++
        continue
      }

      const tier = determineTier(builder.maxDaysOverdue)
      const { subject, html, tone } = generateEmail(
        builder,
        tier
      )

      try {
        await sendEmail({
          to: builder.contactEmail,
          subject,
          html: wrap(html),
          replyTo: 'accounting@abellumber.com',
        })

        // Note: CommunicationLog table does not exist in schema.
        // Communication audit trail should be tracked through CollectionAction records instead.
        // Optionally, log to invoice's CollectionAction for audit trail.

        // Promote non-terminal pre-overdue statuses to OVERDUE once past due.
        // ISSUED or SENT invoices that are past due become OVERDUE. PARTIALLY_PAID
        // is left alone because it carries its own meaning (a partial payment
        // has been applied) which we don't want to clobber with OVERDUE.
        for (const invoice of builder.invoices) {
          if (invoice.daysOverdue > 0) {
            await prisma.$executeRawUnsafe(
              `
              UPDATE "Invoice"
              SET "status" = 'OVERDUE', "updatedAt" = NOW()
              WHERE "id" = $1 AND "status"::text IN ('ISSUED', 'SENT')
              `,
              invoice.id
            )
          }
        }

        emailsSent[tier]++
        totalOutstanding += builder.totalAmount

        console.log(
          `[Collections Email] Sent ${tier} notice to ${builder.builderName} (${builder.builderId})`
        )
      } catch (emailError) {
        console.error(
          `Failed to send email to ${builder.contactEmail} for builder ${builder.builderId}:`,
          emailError
        )
        failedSends++
      }
    }

    const totalSent = emailsSent.friendly + emailsSent.firm + emailsSent.warning + emailsSent.hold
    return NextResponse.json({
      success: true,
      message: 'Collections emails sent successfully',
      processed: builderMap.size,
      succeeded: totalSent,
      failed: failedSends,
      skipped: skippedNoEmail,
      notes: `${totalSent}/${builderMap.size} sent (friendly:${emailsSent.friendly} firm:${emailsSent.firm} warning:${emailsSent.warning} hold:${emailsSent.hold}); ${skippedNoEmail} skipped no-email; ${failedSends} send-fail`,
      emailsSent,
      totalOutstanding: parseFloat(totalOutstanding.toFixed(2)),
      buildersProcessed: builderMap.size,
      timestamp: new Date().toISOString(),
    })
    } catch (error) {
      console.error('[Collections Email Cron] Error:', error)
      // Re-throw so withCronRun marks the run FAILURE.
      throw error instanceof Error ? error : new Error(String(error))
    }
  })
}

function determineTier(daysOverdue: number): CollectionTier {
  if (daysOverdue >= 90) return 'hold'
  if (daysOverdue >= 60) return 'warning'
  if (daysOverdue >= 30) return 'firm'
  return 'friendly'
}

interface EmailContent {
  subject: string
  html: string
  tone: string
}

function generateEmail(builder: BuilderInvoices, tier: CollectionTier): EmailContent {
  const invoiceTable = builder.invoices
    .map(
      (inv) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">#${inv.invoiceNumber}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">$${inv.total.toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: center;">${inv.daysOverdue}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">
          <a href="https://app.abellumber.com/dashboard/invoices/${inv.id}" style="color: #C6A24E; text-decoration: none;">Pay Invoice</a>
        </td>
      </tr>
    `
    )
    .join('')

  const paymentLink = `https://app.abellumber.com/dashboard/invoices/${builder.invoices[0]?.id || ''}`

  let subject: string
  let greeting: string
  let body: string
  let cta: string

  switch (tier) {
    case 'friendly':
      subject = `Friendly reminder: Invoice ${builder.invoices[0]?.invoiceNumber} is past due`
      greeting = `Hi ${builder.builderName},`
      body = `Just a quick reminder that invoice <strong>#${builder.invoices[0]?.invoiceNumber}</strong> for <strong>$${builder.invoices[0]?.total.toFixed(2)}</strong> was due on <strong>${formatDate(builder.invoices[0]?.dueDate)}</strong>. We'd appreciate payment at your earliest convenience.`
      cta = 'Submit Payment'
      break

    case 'firm':
      subject = `Action Required: Invoice #${builder.invoices[0]?.invoiceNumber} — ${builder.maxDaysOverdue} days past due`
      greeting = `${builder.builderName},`
      body = `This is a formal notice that invoice <strong>#${builder.invoices[0]?.invoiceNumber}</strong> for <strong>$${builder.invoices[0]?.total.toFixed(2)}</strong> is now <strong>${builder.maxDaysOverdue} days past due</strong>. Please remit payment within 7 business days to avoid further action.`
      cta = 'Pay Now'
      break

    case 'warning':
      subject = `FINAL NOTICE: Invoice #${builder.invoices[0]?.invoiceNumber} — Immediate Payment Required`
      greeting = `${builder.builderName},`
      body = `Despite previous reminders, invoice <strong>#${builder.invoices[0]?.invoiceNumber}</strong> for <strong>$${builder.invoices[0]?.total.toFixed(2)}</strong> remains unpaid at <strong>${builder.maxDaysOverdue} days past due</strong>. Failure to remit payment within 5 business days may result in account restrictions including credit hold.`
      cta = 'Pay Immediately'
      break

    case 'hold':
      subject = `Credit Hold Notice: Account ${builder.builderName}`
      greeting = `${builder.builderName},`
      body = `Your account has been placed on credit hold due to invoice <strong>#${builder.invoices[0]?.invoiceNumber}</strong> (<strong>${builder.maxDaysOverdue} days past due</strong>, <strong>$${builder.invoices[0]?.total.toFixed(2)}</strong>). New orders will not be processed until the outstanding balance is resolved. Please contact accounting at <strong>accounting@abellumber.com</strong> immediately.`
      cta = 'Resolve Now'
      break
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #333;">
      <p>${greeting}</p>

      <p style="margin: 20px 0; line-height: 1.6;">
        ${body}
      </p>

      ${builder.invoices.length > 1 ? `
        <h3 style="color: #0f2a3e; font-size: 16px; margin-top: 24px; margin-bottom: 12px;">Outstanding Invoices</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f5f5f5; border-bottom: 2px solid #0f2a3e;">
              <th style="padding: 10px; text-align: left; color: #0f2a3e; font-weight: 600;">Invoice</th>
              <th style="padding: 10px; text-align: right; color: #0f2a3e; font-weight: 600;">Amount</th>
              <th style="padding: 10px; text-align: center; color: #0f2a3e; font-weight: 600;">Days Due</th>
              <th style="padding: 10px; text-align: left; color: #0f2a3e; font-weight: 600;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${invoiceTable}
          </tbody>
        </table>
      ` : ''}

      <p style="margin: 20px 0;">
        <a href="${paymentLink}" style="background-color: #C6A24E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600;">${cta}</a>
      </p>

      ${tier !== 'hold' ? `
        <p style="margin-top: 24px; font-size: 14px; color: #666;">
          If you have questions or need to discuss payment arrangements, please reply to this email or contact us at <strong>accounting@abellumber.com</strong>.
        </p>
      ` : `
        <p style="margin-top: 24px; font-size: 14px; color: #666;">
          Contact <strong>accounting@abellumber.com</strong> to resolve this matter and restore your account.
        </p>
      `}

      <p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999;">
        Abel Lumber — Doors, Trim & Hardware<br>
        ${tier === 'hold' ? '<strong style="color: #d32f2f;">Account on Credit Hold</strong>' : ''}
      </p>
    </div>
  `

  return { subject, html, tone: tier }
}

function formatDate(date: Date | undefined): string {
  if (!date) return 'unknown date'
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
