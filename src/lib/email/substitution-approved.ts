/**
 * Substitution approved/rejected email — sent to the original requester after
 * a PM (or manager) clears a PENDING CONDITIONAL substitution request. The
 * same template handles both outcomes so the requester has one consistent
 * notification surface — the only thing that changes is the tone, the subject
 * line, and whether we show the rejection note or the new allocation ID.
 */

import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

export interface SubstitutionDecisionEmailParams {
  to: string
  recipientFirstName: string
  requestId: string
  jobId: string
  jobNumber: string
  originalSku: string | null
  substituteSku: string | null
  quantity: number
  decision: 'APPROVED' | 'REJECTED'
  decidedByName: string
  decisionNote: string | null // rejection note, or optional approval comment
  newAllocationId: string | null
}

export async function sendSubstitutionDecisionEmail(
  p: SubstitutionDecisionEmailParams
) {
  const jobUrl = `${APP_URL}/ops/jobs/${p.jobId}`
  const approved = p.decision === 'APPROVED'
  const headline = approved ? 'Substitution approved' : 'Substitution rejected'
  const headlineColor = approved ? '#2E7D32' : '#C0392B'
  const subject = approved
    ? `[Aegis] Approved: Substitution on Job ${p.jobNumber}`
    : `[Aegis] Rejected: Substitution on Job ${p.jobNumber}`

  return sendEmail({
    to: p.to,
    subject,
    replyTo: 'ops@abellumber.com',
    html: wrap(`
      <h2 style="color:${headlineColor};margin-top:0;">${headline}</h2>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        Hi ${escapeHtml(p.recipientFirstName)},
      </p>
      <p style="color:#333;font-size:15px;line-height:1.6;">
        <strong>${escapeHtml(p.decidedByName)}</strong>
        ${approved ? 'approved' : 'rejected'} the substitution you submitted
        on Job <strong>${escapeHtml(p.jobNumber)}</strong>.
        ${
          approved
            ? `Inventory has been allocated against the substitute SKU
               — the original allocation (if any) was released.`
            : 'No inventory was moved. Please pick a different substitute or talk to the approver.'
        }
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;color:#666;">Original SKU</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(
              p.originalSku ?? '—'
            )}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Substitute SKU</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(
              p.substituteSku ?? '—'
            )}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Quantity</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${p.quantity}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">Decision</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:${headlineColor};">${p.decision}</td>
          </tr>
          ${
            p.decisionNote
              ? `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">${
                  approved ? 'Note' : 'Reason'
                }</td><td style="padding:6px 0;text-align:right;color:#555;font-size:13px;">${escapeHtml(
                  p.decisionNote
                )}</td></tr>`
              : ''
          }
          ${
            p.newAllocationId
              ? `<tr><td style="padding:6px 0;color:#666;">New allocation</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-size:12px;">${escapeHtml(
                  p.newAllocationId
                )}</td></tr>`
              : ''
          }
        </table>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${jobUrl}" style="background-color:#0f2a3e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
          Open Job
        </a>
      </div>
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
