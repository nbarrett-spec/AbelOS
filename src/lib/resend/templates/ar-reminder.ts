/**
 * AR Reminder template — outstanding-balance email for the Collections
 * dashboard (Wave 3). Tone is intentionally flat: direct, factual, no
 * guilt, no threats, no "hope you're doing well." Pulls from Nate's
 * voice guide in `memory/brand/voice.md`:
 *   "Quiet competence, dry wit, no oversell." / "Lead with the number."
 *
 * Returns { subject, html, text }. The caller hands the result to
 * `sendEmail(...)` from `@/lib/resend/client`; this file does not send.
 */

export interface ARReminderInvoice {
  number: string
  /** ISO string or Date. */
  dueDate: string | Date
  amount: number
  daysPastDue: number
}

export interface ARReminderArgs {
  builderName: string
  contactName: string
  invoices: ARReminderInvoice[]
  totalOutstanding: number
  /** Shown in the closing line when present. */
  contactPhoneFallback?: string
  /** Shown in the signature; defaults to 'Abel Lumber Accounting'. */
  senderName?: string
}

export interface ARReminderOutput {
  subject: string
  html: string
  text: string
}

export async function renderARReminder(
  args: ARReminderArgs,
): Promise<ARReminderOutput> {
  const sender = args.senderName || 'Abel Lumber Accounting'
  const phone = args.contactPhoneFallback || '(940) 555-ABEL'
  const formattedTotal = fmtMoney(args.totalOutstanding)
  const firstName = firstNameOf(args.contactName)

  const subject = `Outstanding balance — ${args.builderName} — ${formattedTotal}`

  // Sort invoices oldest first — per voice guide, lead with the hard number
  // and show the work. A super who sees "112 days past due" at the top
  // acts faster than one who has to scan the whole table.
  const invoices = [...args.invoices].sort(
    (a, b) => b.daysPastDue - a.daysPastDue,
  )

  const html = renderHtml({
    firstName,
    builderName: args.builderName,
    invoices,
    totalOutstanding: args.totalOutstanding,
    phone,
    sender,
  })

  const text = renderText({
    firstName,
    builderName: args.builderName,
    invoices,
    totalOutstanding: args.totalOutstanding,
    phone,
    sender,
  })

  return { subject, html, text }
}

// ─── Rendering ─────────────────────────────────────────────────────────────

interface RenderCtx {
  firstName: string
  builderName: string
  invoices: ARReminderInvoice[]
  totalOutstanding: number
  phone: string
  sender: string
}

function renderHtml(ctx: RenderCtx): string {
  const rows = ctx.invoices
    .map(
      (inv) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#0f2a3e;">${escapeHtml(inv.number)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(fmtDate(inv.dueDate))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:right;">${inv.daysPastDue}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#0f2a3e;">${escapeHtml(fmtMoney(inv.amount))}</td>
        </tr>`,
    )
    .join('')

  const summary =
    ctx.invoices.length === 1
      ? `one open invoice`
      : `${ctx.invoices.length} open invoices`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Outstanding balance</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f5f5f5;color:#111;">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;margin-top:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="padding:32px 32px 8px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111;">Dear ${escapeHtml(ctx.firstName)},</p>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#111;">
        ${escapeHtml(ctx.builderName)} has ${summary} totaling <strong>${escapeHtml(fmtMoney(ctx.totalOutstanding))}</strong> past the terms on file. Details below. Please confirm payment timing or reach out if any of these are in dispute.
      </p>

      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th align="left" style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600;">Invoice</th>
            <th align="left" style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600;">Due</th>
            <th align="right" style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600;">Days past due</th>
            <th align="right" style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td colspan="3" style="padding:12px;text-align:right;font-weight:600;color:#0f2a3e;">Total outstanding</td>
            <td style="padding:12px;text-align:right;font-weight:700;color:#0f2a3e;font-size:16px;">${escapeHtml(fmtMoney(ctx.totalOutstanding))}</td>
          </tr>
        </tbody>
      </table>

      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#111;">
        Questions or a dispute on any line — call ${escapeHtml(ctx.phone)} or reply here.
      </p>

      <p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#111;">
        Thank you,<br />
        ${escapeHtml(ctx.sender)}
      </p>
    </div>
  </div>
</body>
</html>`
}

function renderText(ctx: RenderCtx): string {
  const lines: string[] = []
  lines.push(`Dear ${ctx.firstName},`)
  lines.push('')
  const summary =
    ctx.invoices.length === 1
      ? `one open invoice`
      : `${ctx.invoices.length} open invoices`
  lines.push(
    `${ctx.builderName} has ${summary} totaling ${fmtMoney(ctx.totalOutstanding)} past the terms on file. Details below. Please confirm payment timing or reach out if any of these are in dispute.`,
  )
  lines.push('')
  lines.push('Invoice        Due Date        Days Past Due   Amount')
  for (const inv of ctx.invoices) {
    const number = padRight(inv.number, 14)
    const due = padRight(fmtDate(inv.dueDate), 16)
    const days = padLeft(String(inv.daysPastDue), 13)
    const amt = padLeft(fmtMoney(inv.amount), 12)
    lines.push(`${number}${due}${days}   ${amt}`)
  }
  lines.push('')
  lines.push(`Total outstanding: ${fmtMoney(ctx.totalOutstanding)}`)
  lines.push('')
  lines.push(
    `Questions or a dispute on any line - call ${ctx.phone} or reply here.`,
  )
  lines.push('')
  lines.push('Thank you,')
  lines.push(ctx.sender)
  return lines.join('\n')
}

// ─── Format helpers ────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number.isFinite(n) ? n : 0)
}

function fmtDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function firstNameOf(full: string): string {
  const trimmed = (full || '').trim()
  if (!trimmed) return 'there'
  const first = trimmed.split(/\s+/)[0]
  return first || trimmed
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + ' '
  return s + ' '.repeat(n - s.length)
}

function padLeft(s: string, n: number): string {
  if (s.length >= n) return s
  return ' '.repeat(n - s.length) + s
}
