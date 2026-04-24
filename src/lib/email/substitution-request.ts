/**
 * Substitution request email — sent to a Job's assigned PM (and cc'd to Clint)
 * when a staffer applies a CONDITIONAL substitution through the Material
 * Calendar drawer. CONDITIONAL swaps typically need a shim, different hinge
 * handing, a reveal change, or some other field adjustment — so the allocation
 * does not flip immediately. The request waits in a PENDING queue until a PM
 * (or manager) approves it.
 *
 * Keep the email itself light — the real work happens in the app on the
 * `/ops/substitutions/requests` queue, where the approver sees the full
 * request + conditions text and can approve or reject.
 */

import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

export interface SubstitutionRequestEmailParams {
  to: string
  recipientFirstName: string
  requestId: string
  jobId: string
  jobNumber: string
  builderName: string | null
  originalSku: string | null
  originalName: string | null
  substituteSku: string | null
  substituteName: string | null
  quantity: number
  conditions: string | null
  priceDelta: number | null
  requestedByName: string
  reason: string | null
}

export async function sendSubstitutionRequestEmail(
  p: SubstitutionRequestEmailParams
) {
  const queueUrl = `${APP_URL}/ops/substitutions/requests`
  const deltaStr =
    p.priceDelta == null
      ? '—'
      : `${p.priceDelta >= 0 ? '+' : ''}$${p.priceDelta.toFixed(2)}`

  return sendEmail({
    to: p.to,
    subject: `[Aegis] Substitution approval needed: Job ${p.jobNumber}`,
    replyTo: 'ops@abellumber.com',
    html: wrap(`
      <h2 style="color:#0f2a3e;margin-top:0;">Substitution approval needed</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Hi ${escapeHtml(p.recipientFirstName)},
      </p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        <strong>${escapeHtml(p.requestedByName)}</strong> requested a
        <strong style="color:#C0392B;">CONDITIONAL</strong> substitution on
        Job <strong>${escapeHtml(p.jobNumber)}</strong>${
          p.builderName ? ` (${escapeHtml(p.builderName)})` : ''
        }. It won't allocate until you approve — conditional swaps usually
        need a shim, handing change, or other field adjustment.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;color:#666;">Original</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">
              ${escapeHtml(p.originalSku ?? '—')}
              <div style="font-weight:400;color:#666;font-size:12px;">${escapeHtml(
                p.originalName ?? ''
              )}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Substitute</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">
              ${escapeHtml(p.substituteSku ?? '—')}
              <div style="font-weight:400;color:#666;font-size:12px;">${escapeHtml(
                p.substituteName ?? ''
              )}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Quantity</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${p.quantity}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Δ cost / unit</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${deltaStr}</td>
          </tr>
          ${
            p.conditions
              ? `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Conditions</td><td style="padding:6px 0;text-align:right;color:#555;font-size:13px;">${escapeHtml(
                  p.conditions
                )}</td></tr>`
              : ''
          }
          ${
            p.reason
              ? `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Reason</td><td style="padding:6px 0;text-align:right;color:#555;font-size:13px;">${escapeHtml(
                  p.reason
                )}</td></tr>`
              : ''
          }
        </table>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${queueUrl}" style="background-color:#0f2a3e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Review Approval Queue
        </a>
      </div>
      <p style="color:#666;font-size:13px;line-height:1.6;">
        Until you approve, no inventory moves. If the conditions can't be met
        on this job, reject and the requester will be notified.
      </p>
      <p style="color:#999;font-size:12px;margin-top:24px;">
        Request ID: <code>${escapeHtml(p.requestId)}</code>
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
