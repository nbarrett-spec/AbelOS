/**
 * Day 30 — past-due notice (firm)
 *
 * Tone: professional, direct. No apology, no hedge. Invoice is a month late;
 * we want a response. Also creates an InboxItem for Dawn so she follows up
 * with a call if no response lands in 48h.
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

export interface CollectionsDay30Params {
  to: string
  contactName: string
  builderName: string
  invoiceNumber: string
  balanceDue: number
  originalDueDate: Date
  daysPastDue: number
  invoiceUrl?: string
}

export function sendDay30PastDueEmail(p: CollectionsDay30Params) {
  const invoiceUrl = p.invoiceUrl || `${APP_URL}/dashboard/invoices`
  return sendEmail({
    to: p.to,
    subject: `Past due — Invoice ${p.invoiceNumber} (${p.daysPastDue} days)`,
    replyTo: 'billing@abellumber.com',
    html: wrap(`
      <h2 style="color:#C6A24E;margin-top:0;">Invoice past due</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">Hi ${escapeHtml(p.contactName)},</p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Invoice <strong>${escapeHtml(p.invoiceNumber)}</strong> for <strong>${escapeHtml(p.builderName)}</strong>
        is now <strong>${p.daysPastDue} days past due</strong>. We need either payment or a firm date when
        payment will clear.
      </p>
      <div style="background:#fff8f0;border:1px solid #f0d0a0;border-radius:8px;padding:20px;margin:24px 0;">
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
            <td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;color:#C6A24E;">${fmtMoney(p.balanceDue)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Days past due</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#C6A24E;">${p.daysPastDue}</td>
          </tr>
        </table>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${invoiceUrl}" style="background-color:#C6A24E;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Pay Invoice
        </a>
      </div>
      <p style="color:#333;font-size:14px;line-height:1.6;">
        Our terms don't include finance charges yet, but continued accounts past due will prompt a review
        of your credit terms and delivery schedule. If there's a dispute or a missing PO on your side,
        reply and tell us — the sooner we know, the sooner we can clear it.
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
