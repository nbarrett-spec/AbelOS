/**
 * Day 60 — account hold notification
 *
 * Tone: factual, short. Account is on hold; deliveries paused; Nate will be
 * involved. Sent to both the builder contact AND Nate (cc via a second send).
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

export interface CollectionsDay60Params {
  to: string
  contactName: string
  builderName: string
  invoiceNumber: string
  balanceDue: number
  originalDueDate: Date
  daysPastDue: number
  totalOutstanding?: number
  invoiceUrl?: string
}

export function sendDay60HoldEmail(p: CollectionsDay60Params) {
  const invoiceUrl = p.invoiceUrl || `${APP_URL}/dashboard/invoices`
  return sendEmail({
    to: p.to,
    subject: `Account on hold — Invoice ${p.invoiceNumber} (${p.daysPastDue}+ days)`,
    replyTo: 'n.barrett@abellumber.com',
    html: wrap(`
      <h2 style="color:#C0392B;margin-top:0;">Your account has been placed on hold</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">Hi ${escapeHtml(p.contactName)},</p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        As of today, the <strong>${escapeHtml(p.builderName)}</strong> account is on delivery hold.
        New orders will not be released and open deliveries are paused until the balance clears.
      </p>
      <div style="background:#fef5f5;border:2px solid #C0392B;border-radius:8px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;color:#666;">Invoice triggering hold</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.invoiceNumber)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Original due date</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${fmtDate(p.originalDueDate)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Days past due</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#C0392B;">${p.daysPastDue}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Balance on this invoice</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#C0392B;">${fmtMoney(p.balanceDue)}</td>
          </tr>
          ${p.totalOutstanding !== undefined && p.totalOutstanding !== p.balanceDue ? `
          <tr>
            <td style="padding:6px 0;color:#666;">Total account balance</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;color:#C0392B;">${fmtMoney(p.totalOutstanding)}</td>
          </tr>
          ` : ''}
        </table>
      </div>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        To release the hold, we need payment or a signed payment schedule. I'm personally involved
        at this point — please reply to this email or call me direct so we can get this resolved.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${invoiceUrl}" style="background-color:#C0392B;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Pay Invoice
        </a>
      </div>
      <p style="color:#666;font-size:13px;line-height:1.6;margin-top:24px;">
        Nate Barrett, Owner/GM, Abel Lumber &middot; n.barrett@abellumber.com &middot; (940) 555-ABEL
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
