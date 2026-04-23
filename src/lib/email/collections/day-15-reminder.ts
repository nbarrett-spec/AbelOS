/**
 * Day 15 — friendly reminder
 *
 * Tone: casual, no pressure. Most builders just need a nudge at this stage.
 * Sent automatically by /api/cron/collections-ladder when an invoice is
 * 15 days past due and no prior REMINDER has been logged for it.
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

export interface CollectionsDay15Params {
  to: string
  contactName: string
  builderName: string
  invoiceNumber: string
  balanceDue: number
  originalDueDate: Date
  daysPastDue: number
  invoiceUrl?: string
}

export function sendDay15ReminderEmail(p: CollectionsDay15Params) {
  const invoiceUrl = p.invoiceUrl || `${APP_URL}/dashboard/invoices`
  return sendEmail({
    to: p.to,
    subject: `Friendly reminder — Invoice ${p.invoiceNumber}`,
    replyTo: 'billing@abellumber.com',
    html: wrap(`
      <h2 style="color:#0f2a3e;margin-top:0;">Quick reminder</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">Hi ${escapeHtml(p.contactName)},</p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Hope the projects are moving well. Just a heads-up that invoice <strong>${escapeHtml(p.invoiceNumber)}</strong>
        is showing as unpaid in our system — it was due <strong>${fmtDate(p.originalDueDate)}</strong>.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;color:#666;">Invoice</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.invoiceNumber)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Account</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.builderName)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Balance due</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#0f2a3e;">${fmtMoney(p.balanceDue)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Days past due</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${p.daysPastDue}</td>
          </tr>
        </table>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${invoiceUrl}" style="background-color:#C6A24E;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          View &amp; Pay Invoice
        </a>
      </div>
      <p style="color:#666;font-size:13px;line-height:1.6;">
        If this has already been sent or there's a question about the charges, just reply here and we'll
        sort it out. Thanks for the business.
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
