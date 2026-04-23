/**
 * Material-escalation email — sent to Clint (COO) and Nate when the
 * T-7 Material Confirm Checkpoint either
 *   (a) auto-escalates because the PM didn't act by T-3, or
 *   (b) is explicitly escalated by the PM via /material-escalate.
 *
 * The "reason" field is load-bearing — it tells Clint whether this was
 * a timeout (PM MIA) or a judgment call the PM flagged up. He'll
 * triage differently based on that.
 */

import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

export interface MaterialEscalationParams {
  to: string
  recipientFirstName: string
  jobId: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  community: string | null
  scheduledDate: Date
  daysToDelivery: number
  materialStatus: 'AMBER' | 'RED' | 'UNKNOWN'
  statusReason: string
  escalationReason: string // "auto-escalated (T-3 timeout)" or whatever PM wrote
  pmName: string | null
  trigger: 'AUTO_TIMEOUT' | 'PM_REQUESTED'
}

export async function sendMaterialEscalationEmail(
  p: MaterialEscalationParams
) {
  const jobUrl = `${APP_URL}/ops/jobs/${p.jobId}`
  const scheduledStr = p.scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const triggerLabel =
    p.trigger === 'AUTO_TIMEOUT'
      ? 'auto-escalated (PM did not confirm by T-3)'
      : 'escalated by PM'
  const triggerColor = p.trigger === 'AUTO_TIMEOUT' ? '#C0392B' : '#D4B96A'

  return sendEmail({
    to: p.to,
    subject: `[Aegis] ESCALATION: Material confirm missed — Job ${p.jobNumber}`,
    replyTo: 'ops@abellumber.com',
    html: wrap(`
      <h2 style="color:#C0392B;margin-top:0;">Material-confirm escalation</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Hi ${p.recipientFirstName},
      </p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Job <strong>${p.jobNumber}</strong> has been
        <strong style="color:${triggerColor};">${triggerLabel}</strong>.
        Delivery is in <strong>${p.daysToDelivery} day${p.daysToDelivery === 1 ? '' : 's'}</strong>
        and materials are not confirmed. You need to take over or hand it back to the PM with a decision.
      </p>
      <div style="background:#fef5f5;border:1px solid #f5c6c6;border-radius:8px;padding:20px;margin:24px 0;">
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
            <td style="padding:6px 0;color:#666;">Assigned PM</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(p.pmName || 'unassigned')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Material status</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#C0392B;">${escapeHtml(p.materialStatus)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;vertical-align:top;">Allocation detail</td>
            <td style="padding:6px 0;text-align:right;color:#555;font-size:13px;">${escapeHtml(p.statusReason)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;vertical-align:top;">Escalation reason</td>
            <td style="padding:6px 0;text-align:right;color:#555;font-size:13px;">${escapeHtml(p.escalationReason)}</td>
          </tr>
        </table>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${jobUrl}" style="background-color:#C0392B;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Take Over — Open Job
        </a>
      </div>
      <p style="color:#666;font-size:13px;line-height:1.6;">
        The Material Confirm banner on the Job page lets you confirm-on-behalf (effectively clearing the flag)
        or trigger your own escalation note. The audit trail will capture whichever action you take.
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
