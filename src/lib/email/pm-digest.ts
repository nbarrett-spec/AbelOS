/**
 * PM Daily Digest — template + sender for the 7 AM CT PM briefing.
 *
 * Why this exists: PMs run their day from the truck, not a dashboard. The
 * digest gives them everything they need to triage the morning before they
 * open the app: today's jobs, tomorrow's prep, red-material watch, overdue
 * task backlog, closings this week, and pending substitution approvals.
 *
 * Tone: factual, concise, no exclamation marks, no emoji. Anything alarming
 * is alarming because of the data, not because of the copy. Matches
 * memory/brand/voice.md: quiet competence, dry, direct.
 *
 * Called from /api/cron/pm-daily-digest. Not exported to the builder portal.
 */
import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

// ─────────────────────────────────────────────────────────────────────────────
// Payload types — mirror the shape the cron hands us.
// ─────────────────────────────────────────────────────────────────────────────

export interface PmDigestJob {
  jobId: string
  jobNumber: string
  builderName: string | null
  community: string | null
  jobAddress: string | null
  status: string
  scheduledDate: Date | null
  jobType: string | null
}

export interface PmDigestRedJob {
  jobId: string
  jobNumber: string
  builderName: string | null
  scheduledDate: Date | null
  /** Short reason line — shortage count, worst line, etc. */
  reason: string
}

export interface PmDigestTask {
  taskId: string
  title: string
  priority: string
  dueDate: Date | null
  daysOverdue: number
  jobNumber: string | null
}

export interface PmDigestClosing {
  jobId: string
  jobNumber: string
  builderName: string | null
  community: string | null
  closingDate: Date
}

export interface PmDigestSubstitution {
  requestId: string
  jobNumber: string | null
  originalSku: string | null
  substituteSku: string | null
  quantity: number
  reason: string | null
  requestedAt: Date
}

export interface PmDigestPayload {
  pmFirstName: string
  pmLastName: string
  pmStaffId: string
  todayJobs: PmDigestJob[]
  tomorrowJobs: PmDigestJob[]
  redJobsThisWeek: PmDigestRedJob[]
  overdueTasks: PmDigestTask[]
  closingsThisWeek: PmDigestClosing[]
  pendingSubstitutions: PmDigestSubstitution[]
}

export interface RenderedDigest {
  subject: string
  html: string
  text: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtShort(d: Date | null): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(d))
}

function fmtWeekdayShort(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function jobUrl(jobId: string): string {
  return `${APP_URL}/ops/jobs/${jobId}`
}

function pmBookUrl(staffId: string): string {
  return `${APP_URL}/ops/pm/book/${staffId}`
}

function opsTodayUrl(): string {
  return `${APP_URL}/ops/today`
}

function substitutionsUrl(): string {
  return `${APP_URL}/ops/substitutions/requests`
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML section builders
// ─────────────────────────────────────────────────────────────────────────────

function sectionHeader(title: string, count: number): string {
  return `
    <h2 style="font-size:14px;font-weight:600;color:#0f2a3e;margin:24px 0 8px 0;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;">
      ${escapeHtml(title)} <span style="color:#6b7280;font-weight:500;">(${count})</span>
    </h2>
  `
}

function emptyLine(msg: string): string {
  return `<p style="color:#6b7280;font-size:13px;margin:4px 0 16px 0;">${escapeHtml(msg)}</p>`
}

function renderJobsTable(jobs: PmDigestJob[]): string {
  const rows = jobs
    .map((j) => {
      const loc = j.community
        ? `${escapeHtml(j.community)}${j.builderName ? ` (${escapeHtml(j.builderName)})` : ''}`
        : escapeHtml(j.builderName || '—')
      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 8px 8px 0;font-weight:600;">
            <a href="${jobUrl(j.jobId)}" style="color:#0f2a3e;text-decoration:none;">${escapeHtml(j.jobNumber)}</a>
          </td>
          <td style="padding:8px;color:#374151;">${loc}</td>
          <td style="padding:8px;color:#6b7280;font-size:12px;">${escapeHtml(j.jobAddress || '')}</td>
          <td style="padding:8px;color:#374151;font-size:12px;">${escapeHtml(j.jobType || '')}</td>
          <td style="padding:8px;color:#6b7280;font-size:12px;text-align:right;">${escapeHtml(j.status)}</td>
        </tr>
      `
    })
    .join('')
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <thead>
        <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
          <th style="padding:6px 8px 6px 0;font-weight:600;">Job</th>
          <th style="padding:6px 8px;font-weight:600;">Builder / Community</th>
          <th style="padding:6px 8px;font-weight:600;">Address</th>
          <th style="padding:6px 8px;font-weight:600;">Type</th>
          <th style="padding:6px 8px;font-weight:600;text-align:right;">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderRedJobsTable(jobs: PmDigestRedJob[]): string {
  const rows = jobs
    .map((j) => {
      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 8px 8px 0;font-weight:600;">
            <a href="${jobUrl(j.jobId)}" style="color:#C0392B;text-decoration:none;">${escapeHtml(j.jobNumber)}</a>
          </td>
          <td style="padding:8px;color:#374151;">${escapeHtml(j.builderName || '—')}</td>
          <td style="padding:8px;color:#6b7280;font-size:12px;">${fmtShort(j.scheduledDate)}</td>
          <td style="padding:8px;color:#555;font-size:12px;">${escapeHtml(j.reason)}</td>
        </tr>
      `
    })
    .join('')
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <thead>
        <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
          <th style="padding:6px 8px 6px 0;font-weight:600;">Job</th>
          <th style="padding:6px 8px;font-weight:600;">Builder</th>
          <th style="padding:6px 8px;font-weight:600;">Scheduled</th>
          <th style="padding:6px 8px;font-weight:600;">Signal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderTaskList(tasks: PmDigestTask[]): string {
  const items = tasks
    .map((t) => {
      const overdue =
        t.daysOverdue > 0
          ? `<span style="color:#C0392B;font-weight:600;">${t.daysOverdue}d overdue</span>`
          : `<span style="color:#6b7280;">due ${fmtShort(t.dueDate)}</span>`
      return `
        <li style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <div style="color:#111827;font-weight:500;">${escapeHtml(t.title)}</div>
          <div style="color:#6b7280;font-size:12px;margin-top:2px;">
            ${escapeHtml(t.priority)} · ${overdue}${t.jobNumber ? ` · Job ${escapeHtml(t.jobNumber)}` : ''}
          </div>
        </li>
      `
    })
    .join('')
  return `<ul style="list-style:none;padding:0;margin:0 0 16px 0;">${items}</ul>`
}

function renderClosingsTable(closings: PmDigestClosing[]): string {
  const rows = closings
    .map((c) => {
      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 8px 8px 0;font-weight:600;">
            <a href="${jobUrl(c.jobId)}" style="color:#0f2a3e;text-decoration:none;">${escapeHtml(c.jobNumber)}</a>
          </td>
          <td style="padding:8px;color:#374151;">${escapeHtml(c.builderName || '—')}</td>
          <td style="padding:8px;color:#6b7280;font-size:12px;">${escapeHtml(c.community || '')}</td>
          <td style="padding:8px;color:#111827;font-weight:600;font-size:12px;text-align:right;">
            ${fmtWeekdayShort(new Date(c.closingDate))}
          </td>
        </tr>
      `
    })
    .join('')
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <thead>
        <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
          <th style="padding:6px 8px 6px 0;font-weight:600;">Job</th>
          <th style="padding:6px 8px;font-weight:600;">Builder</th>
          <th style="padding:6px 8px;font-weight:600;">Community</th>
          <th style="padding:6px 8px;font-weight:600;text-align:right;">Closing</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderSubstitutionsTable(subs: PmDigestSubstitution[]): string {
  const rows = subs
    .map((s) => {
      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 8px 8px 0;font-weight:600;color:#0f2a3e;">${escapeHtml(s.jobNumber || '—')}</td>
          <td style="padding:8px;color:#374151;font-size:12px;">${escapeHtml(s.originalSku || '?')}</td>
          <td style="padding:8px;color:#374151;font-size:12px;">${escapeHtml(s.substituteSku || '?')}</td>
          <td style="padding:8px;color:#6b7280;font-size:12px;text-align:center;">${s.quantity}</td>
          <td style="padding:8px;color:#555;font-size:12px;">${escapeHtml(s.reason || '')}</td>
        </tr>
      `
    })
    .join('')
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
      <thead>
        <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
          <th style="padding:6px 8px 6px 0;font-weight:600;">Job</th>
          <th style="padding:6px 8px;font-weight:600;">From</th>
          <th style="padding:6px 8px;font-weight:600;">To</th>
          <th style="padding:6px 8px;font-weight:600;text-align:center;">Qty</th>
          <th style="padding:6px 8px;font-weight:600;">Reason</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:0 0 16px 0;font-size:12px;">
      <a href="${substitutionsUrl()}" style="color:#C6A24E;">Review and approve &rarr;</a>
    </p>
  `
}

// ─────────────────────────────────────────────────────────────────────────────
// Text-version builders (plain-text mirror for fallback clients)
// ─────────────────────────────────────────────────────────────────────────────

function textJobs(jobs: PmDigestJob[], emptyMsg: string): string {
  if (jobs.length === 0) return `  ${emptyMsg}\n`
  return jobs
    .map((j) => {
      const loc = j.community
        ? `${j.community}${j.builderName ? ` (${j.builderName})` : ''}`
        : j.builderName || '—'
      return `  • ${j.jobNumber} — ${loc}${j.jobAddress ? ' — ' + j.jobAddress : ''} [${j.status}${j.jobType ? ' / ' + j.jobType : ''}]`
    })
    .join('\n')
}

function textRedJobs(jobs: PmDigestRedJob[]): string {
  if (jobs.length === 0) return '  No red-material jobs this week.\n'
  return jobs
    .map(
      (j) =>
        `  • ${j.jobNumber} — ${j.builderName || '—'} — ${fmtShort(j.scheduledDate)} — ${j.reason}`
    )
    .join('\n')
}

function textTasks(tasks: PmDigestTask[]): string {
  if (tasks.length === 0) return '  No overdue tasks.\n'
  return tasks
    .map((t) => {
      const suffix =
        t.daysOverdue > 0
          ? `${t.daysOverdue}d overdue`
          : `due ${fmtShort(t.dueDate)}`
      return `  • [${t.priority}] ${t.title} — ${suffix}${t.jobNumber ? ` — Job ${t.jobNumber}` : ''}`
    })
    .join('\n')
}

function textClosings(closings: PmDigestClosing[]): string {
  if (closings.length === 0) return '  No closings this week.\n'
  return closings
    .map(
      (c) =>
        `  • ${c.jobNumber} — ${c.builderName || '—'}${c.community ? ' / ' + c.community : ''} — closing ${fmtWeekdayShort(new Date(c.closingDate))}`
    )
    .join('\n')
}

function textSubs(subs: PmDigestSubstitution[]): string {
  if (subs.length === 0) return '  No pending substitution requests.\n'
  return subs
    .map(
      (s) =>
        `  • Job ${s.jobNumber || '—'} — ${s.originalSku || '?'} → ${s.substituteSku || '?'} × ${s.quantity}${s.reason ? ' — ' + s.reason : ''}`
    )
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function renderPmDigest(payload: PmDigestPayload): RenderedDigest {
  const today = new Date()
  const dateLabel = fmtWeekdayShort(today)
  const jobCount = payload.todayJobs.length

  const subject = `[Abel Ops] Today's plan — ${dateLabel} — ${jobCount} job${jobCount === 1 ? '' : 's'}`

  // ── HTML body ──
  const body = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;line-height:1.5;">
      <p style="margin:0 0 4px 0;color:#111827;font-size:15px;">Morning, ${escapeHtml(payload.pmFirstName)}.</p>
      <p style="margin:0 0 20px 0;color:#6b7280;font-size:13px;">Your plan for ${dateLabel}. Reply with questions; this is a daily summary.</p>

      ${sectionHeader("Today", payload.todayJobs.length)}
      ${
        payload.todayJobs.length === 0
          ? emptyLine("Nothing on today's schedule yet.")
          : renderJobsTable(payload.todayJobs)
      }

      ${sectionHeader("Tomorrow — prep", payload.tomorrowJobs.length)}
      ${
        payload.tomorrowJobs.length === 0
          ? emptyLine("Nothing booked for tomorrow yet.")
          : renderJobsTable(payload.tomorrowJobs)
      }

      ${sectionHeader("Red materials — this week", payload.redJobsThisWeek.length)}
      ${
        payload.redJobsThisWeek.length === 0
          ? emptyLine("No red-material jobs on the 7-day radar.")
          : renderRedJobsTable(payload.redJobsThisWeek)
      }

      ${sectionHeader("Overdue tasks", payload.overdueTasks.length)}
      ${
        payload.overdueTasks.length === 0
          ? emptyLine("No overdue tasks. Inbox clear.")
          : renderTaskList(payload.overdueTasks)
      }

      ${sectionHeader("Closings — this week", payload.closingsThisWeek.length)}
      ${
        payload.closingsThisWeek.length === 0
          ? emptyLine("No Hyphen closings on the calendar for this week.")
          : renderClosingsTable(payload.closingsThisWeek)
      }

      ${sectionHeader("Substitutions — awaiting you", payload.pendingSubstitutions.length)}
      ${
        payload.pendingSubstitutions.length === 0
          ? emptyLine("No substitution requests waiting on approval.")
          : renderSubstitutionsTable(payload.pendingSubstitutions)
      }

      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:left;">
        <a href="${opsTodayUrl()}" style="display:inline-block;background:#0f2a3e;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin-right:8px;">
          Open today's board
        </a>
        <a href="${pmBookUrl(payload.pmStaffId)}" style="display:inline-block;background:#C6A24E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">
          My book
        </a>
      </div>
    </div>
  `

  const html = wrap(body)

  // ── Plain-text mirror ──
  const lines: string[] = []
  lines.push(`ABEL OPS — ${dateLabel}`)
  lines.push(`Morning, ${payload.pmFirstName}.`)
  lines.push('')
  lines.push(`TODAY (${payload.todayJobs.length})`)
  lines.push(textJobs(payload.todayJobs, "Nothing on today's schedule yet."))
  lines.push('')
  lines.push(`TOMORROW — PREP (${payload.tomorrowJobs.length})`)
  lines.push(textJobs(payload.tomorrowJobs, 'Nothing booked for tomorrow yet.'))
  lines.push('')
  lines.push(`RED MATERIALS — THIS WEEK (${payload.redJobsThisWeek.length})`)
  lines.push(textRedJobs(payload.redJobsThisWeek))
  lines.push('')
  lines.push(`OVERDUE TASKS (${payload.overdueTasks.length})`)
  lines.push(textTasks(payload.overdueTasks))
  lines.push('')
  lines.push(`CLOSINGS — THIS WEEK (${payload.closingsThisWeek.length})`)
  lines.push(textClosings(payload.closingsThisWeek))
  lines.push('')
  lines.push(`SUBSTITUTIONS — AWAITING YOU (${payload.pendingSubstitutions.length})`)
  lines.push(textSubs(payload.pendingSubstitutions))
  lines.push('')
  lines.push(`Open today: ${opsTodayUrl()}`)
  lines.push(`My book:    ${pmBookUrl(payload.pmStaffId)}`)

  const text = lines.join('\n')

  return { subject, html, text }
}

/**
 * Send the digest to a single PM. Thin wrapper over sendEmail; kept here
 * so the cron route can stay focused on query + orchestration.
 */
export async function sendPmDigest(params: {
  to: string
  payload: PmDigestPayload
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const rendered = renderPmDigest(params.payload)
  return sendEmail({
    to: params.to,
    subject: rendered.subject,
    html: rendered.html,
    replyTo: 'ops@abellumber.com',
  })
}
