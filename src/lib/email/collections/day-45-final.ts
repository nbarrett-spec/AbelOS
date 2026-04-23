/**
 * Day 45 — final notice (urgent)
 *
 * Tone: direct, consequences named. This is the last email before we move to
 * account hold + Nate personally calling. Dawn gets a phone-call task in the
 * inbox in parallel.
 */

import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export interface CollectionsDay45Params {
  to: string
  contactName: string
  builderName: string
  invoiceNumber: string
  balanceDue: number
  originalDueDate: Date
  daysPastDue: number
  invoiceUrl?: string
}

export function sendDay45FinalNoticeEmail(p: CollectionsDay45Params) {
  const invoiceUrl = p.invoiceUrl || `${APP_URL}/dashboard/invoices`
  return sendEmail({
    to: p.to,
    subject: `FINAL NOTICE — Invoice ${p.invoiceNumber} (${p.daysPastDue} days past due)`,
    replyTo: 'billing@abellumber.com',
    html: wrap(`
      <h2 style="color:#C0392B;margin-top:0;">Final notice before account hold</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">Hi ${escapeHtml(p.contactName)},</p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Invoice <strong>${escapeHtml(p.invoiceNumber)}</strong> for <strong>${escapeHtml(p.builderName)}</strong>
        is <strong style="color:#C0392B;">${p.daysPastDue} days past due</strong>. We've sent reminders and
        a past-due notice without a response.
      </p>
      <div style="background:#fef5f5;border:1px solid #f5c6c6;border-radius:8px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;color:#666;">Invoice</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.invoiceNumber)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Original due date</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${fmtDate(p.originalDueDate)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Balance due</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;color:#C0392B;">${fmtMoney(p.balanceDue)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Days past due</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#C0392B;">${p.daysPastDue}</td>
          </tr>
        </table>
      </div>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        <strong>If this balance isn't paid or a firm payment schedule isn't confirmed within 5 business days,
        your account will be placed on delivery hold.</strong> New orders and open deliveries stop until the
        account clears.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${invoiceUrl}" style="background-color:#C0392B;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Pay Invoice Now
        </a>
      </div>
      <p style="color:#333;font-size:14px;line-height:1.6;">
        If there's a dispute or a payment issue on your end, I'd rather hear it from you than put your
        account on hold. Reply to this email or call me direct.
      </p>
      <p style="color:#666;font-size:13px;line-height:1.6;margin-top:24px;">
        Dawn Meehan, Accounting Manager &middot; billing@abellumber.com &middot; (940) 555-ABEL
      </p>
    `),
  })
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
