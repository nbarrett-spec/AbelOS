/**
 * Material-arrived email — sent to a Job's assigned PM when a vendor
 * receipt (Receive-against-PO at /ops/receiving) clears every backorder
 * on that job.  The backorder→RESERVED flip is what moves a job from
 * RED to GREEN in the PM Material Status dashboard, so the message is
 * the "green light" the PM has been waiting on.
 *
 * Keep it small.  Deep-link into the Job page — that surface already
 * shows the full allocation ledger and pick-list readiness banner.
 */

import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

export interface MaterialArrivedParams {
  to: string
  pmFirstName: string
  jobId: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  community: string | null
  scheduledDate: Date | null
  poNumber: string
  vendorName: string
  clearedItems: Array<{ sku: string | null; description: string; quantity: number }>
}

export async function sendMaterialArrivedEmail(p: MaterialArrivedParams) {
  const jobUrl = `${APP_URL}/ops/jobs/${p.jobId}`
  const scheduledStr = p.scheduledDate
    ? p.scheduledDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'unscheduled'

  const itemRows = p.clearedItems
    .slice(0, 20)
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 0;color:#555;font-size:13px;">${escapeHtml(it.description)}${it.sku ? ` <span style="color:#888;">(${escapeHtml(it.sku)})</span>` : ''}</td>
          <td style="padding:6px 0;text-align:right;color:#0f2a3e;font-weight:600;font-size:13px;">${it.quantity}</td>
        </tr>`,
    )
    .join('')
  const more = p.clearedItems.length > 20 ? `<tr><td colspan="2" style="padding:6px 0;color:#999;font-size:12px;font-style:italic;">+${p.clearedItems.length - 20} more…</td></tr>` : ''

  return sendEmail({
    to: p.to,
    subject: `[Aegis] Material arrived — Job ${p.jobNumber} now GREEN`,
    replyTo: 'ops@abellumber.com',
    html: wrap(`
      <h2 style="color:#0f2a3e;margin-top:0;">Material arrived — you're GREEN</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Hi ${p.pmFirstName},
      </p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        PO <strong>${escapeHtml(p.poNumber)}</strong> from
        <strong>${escapeHtml(p.vendorName)}</strong> was just received and cleared
        every outstanding backorder on
        <strong>Job ${escapeHtml(p.jobNumber)}</strong>.
        The job has flipped from <span style="color:#C0392B;font-weight:700;">RED</span>
        to <span style="color:#1E8E3E;font-weight:700;">GREEN</span> in the PM Material Status dashboard —
        the pick list is ready to run.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;color:#666;">Builder</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.builderName)}</td>
          </tr>
          ${p.community ? `<tr><td style="padding:6px 0;color:#666;">Community</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.community)}</td></tr>` : ''}
          ${p.jobAddress ? `<tr><td style="padding:6px 0;color:#666;">Address</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.jobAddress)}</td></tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#666;">Scheduled</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${scheduledStr}</td>
          </tr>
        </table>
      </div>
      <h3 style="color:#0f2a3e;font-size:15px;margin:24px 0 8px 0;">Materials released</h3>
      <table style="width:100%;border-collapse:collapse;">
        ${itemRows}${more}
      </table>
      <div style="text-align:center;margin:32px 0;">
        <a href="${jobUrl}" style="background-color:#0f2a3e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Open Job
        </a>
      </div>
      <p style="color:#999;font-size:12px;margin-top:24px;">
        This is an automatic notification from the receiving workflow at /ops/receiving.
        Allocations flipped from BACKORDERED to RESERVED and the pick list is queued.
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
