export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/admin/test-alert-notify
//
// Smoke-test the critical alert notification pipeline without inducing a
// real outage. Sends a plainly-labeled [TEST] email to every recipient on
// ALERT_NOTIFY_EMAILS using the same sendEmail helper the real dispatcher
// uses. Does NOT touch the AlertIncident table — so it leaves no trace in
// alert history and can be run repeatedly during setup.
//
// Response shape:
//   {
//     ok: boolean,
//     recipients: string[],       // redacted if unset
//     sent:   Array<{ to: string, ok: true,  id?: string }>,
//     failed: Array<{ to: string, ok: false, error: string }>,
//     note?:  string              // e.g. "ALERT_NOTIFY_EMAILS unset"
//   }
//
// Staff-only. Returns 503 if no recipients are configured.
// ──────────────────────────────────────────────────────────────────────────

function parseRecipients(): string[] {
  const raw = process.env.ALERT_NOTIFY_EMAILS || ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
}

function renderTestHtml(requestedBy: string): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.abellumber.com'
      : 'http://localhost:3000')
  const now = new Date().toISOString()
  const safeBy = escapeHtml(requestedBy)
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#4338ca;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Alert notification smoke test</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">This is a test — no real incident is firing</div>
      </div>
      <div style="border:1px solid #c7d2fe;border-top:none;border-radius:0 0 8px 8px;padding:20px;color:#374151;font-size:13px;">
        <p style="margin-top:0;">
          If you're seeing this, the <code>ALERT_NOTIFY_EMAILS</code> pipeline
          is wired correctly and Resend is delivering mail to this address.
        </p>
        <p>
          Real critical incident notifications will arrive with subject
          <code>[CRITICAL] &lt;alert title&gt;</code> and include the peak
          count, tick count, and a deep link to
          <a href="${appUrl}/admin/alert-history" style="color:#4338ca;">/admin/alert-history</a>.
        </p>
        <table style="font-size:12px;width:100%;border-collapse:collapse;color:#6b7280;margin-top:16px;">
          <tr><td style="padding:3px 0;width:140px;">Requested by</td><td style="color:#374151;">${safeBy}</td></tr>
          <tr><td style="padding:3px 0;">Sent at</td><td style="color:#374151;">${now}</td></tr>
          <tr><td style="padding:3px 0;">Source</td><td style="color:#374151;">/api/admin/test-alert-notify</td></tr>
        </table>
        <div style="margin-top:16px;font-size:11px;color:#9ca3af;">
          This test leaves no record in AlertIncident and does not affect
          the notifiedAt stamping used by real dispatch.
        </div>
      </div>
    </div>
  `.trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const recipients = parseRecipients()
  if (recipients.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        recipients: [],
        sent: [],
        failed: [],
        note: 'ALERT_NOTIFY_EMAILS is unset or empty — set it in the environment and redeploy',
      },
      { status: 503 }
    )
  }

  // Best-effort attribution for the email body. checkStaffAuth has already
  // vouched that this is a staff caller; pick whichever header is present.
  const requestedBy =
    request.headers.get('x-user-email') ||
    request.headers.get('x-staff-email') ||
    'admin (unknown)'

  const html = renderTestHtml(requestedBy)
  const subject = '[TEST] Abel OS alert notification smoke test'

  const sent: Array<{ to: string; ok: true; id?: string }> = []
  const failed: Array<{ to: string; ok: false; error: string }> = []

  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html })
    if (result.success) {
      sent.push({ to, ok: true, id: result.id })
    } else {
      failed.push({ to, ok: false, error: result.error || 'unknown' })
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    recipients,
    sent,
    failed,
  })
}

// GET is a dry-run that tells the caller what WOULD happen without
// actually sending. Useful for verifying configuration during setup.
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const recipients = parseRecipients()
  return NextResponse.json({
    recipients,
    count: recipients.length,
    configured: recipients.length > 0,
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    note:
      recipients.length === 0
        ? 'ALERT_NOTIFY_EMAILS is unset or empty'
        : 'POST to this endpoint to send a test email to every recipient',
  })
}
