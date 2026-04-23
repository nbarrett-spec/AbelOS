/**
 * Material-confirm request email — sent to a Job's assigned PM when the
 * T-7 Material Confirm Checkpoint cron has found the Job's allocation in
 * AMBER or RED state.
 *
 * Design: the PM has two actions (confirm or escalate) and must take one
 * before T-3 or the cron will auto-escalate to Clint on the next run.
 *
 * Keep the email itself small — it links into the Job detail page where
 * the banner renders the same two buttons on a surface the PM already
 * knows how to use. The email is the ping, the app is the work.
 */

import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

export interface MaterialConfirmRequestParams {
  to: string
  pmFirstName: string
  jobId: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  community: string | null
  scheduledDate: Date
  daysToDelivery: number
  materialStatus: 'AMBER' | 'RED'
  statusReason: string
}

export async function sendMaterialConfirmRequestEmail(
  p: MaterialConfirmRequestParams
) {
  const jobUrl = `${APP_URL}/ops/jobs/${p.jobId}`
  const statusColor = p.materialStatus === 'RED' ? '#C0392B' : '#D4B96A'
  const statusLabel = p.materialStatus === 'RED' ? 'RED — shortfall detected' : 'AMBER — partial coverage'
  const urgencyNote =
    p.daysToDelivery <= 3
      ? `<strong style="color:#C0392B;">Delivery is in ${p.daysToDelivery} day${p.daysToDelivery === 1 ? '' : 's'}. Act now or this will escalate to Clint.</strong>`
      : `You have until T-3 (${p.daysToDelivery - 3} day${p.daysToDelivery - 3 === 1 ? '' : 's'} from now) to confirm or escalate.`
  const scheduledStr = p.scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return sendEmail({
    to: p.to,
    subject: `[Aegis] Material confirm needed: Job ${p.jobNumber} delivers in ${p.daysToDelivery} day${p.daysToDelivery === 1 ? '' : 's'}`,
    replyTo: 'ops@abellumber.com',
    html: wrap(`
      <h2 style="color:#0f2a3e;margin-top:0;">Material confirm needed</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Hi ${p.pmFirstName},
      </p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Job <strong>${p.jobNumber}</strong> delivers in
        <strong>${p.daysToDelivery} day${p.daysToDelivery === 1 ? '' : 's'}</strong>
        and the material allocation check came back
        <span style="color:${statusColor};font-weight:700;">${statusLabel}</span>.
        You need to either confirm materials are good or escalate to Clint.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;">
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
          <tr>
            <td style="padding:6px 0;color:#666;">Material status</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:${statusColor};">${statusLabel}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;vertical-align:top;">Why</td>
            <td style="padding:6px 0;text-align:right;color:#555;font-size:13px;">${escapeHtml(p.statusReason)}</td>
          </tr>
        </table>
      </div>
      <p style="color:#333;font-size:14px;line-height:1.6;">${urgencyNote}</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${jobUrl}" style="background-color:#0f2a3e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Open Job &amp; Confirm
        </a>
      </div>
      <p style="color:#666;font-size:13px;line-height:1.6;">
        On the Job page you'll see a banner at the top with two buttons:
        <strong>Confirm Materials Allocated</strong> (if everything's covered or you've got a plan)
        or <strong>Escalate to Clint</strong> (if you need backup).
      </p>
      <p style="color:#999;font-size:12px;margin-top:24px;">
        If you don't act by T-3, the checkpoint will auto-escalate to Clint. This isn't punitive —
        it's the accountability gate that keeps us from eating a short on delivery day.
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
