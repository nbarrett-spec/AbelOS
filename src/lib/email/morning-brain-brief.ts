/**
 * Morning Brain Brief — email + SMS template
 *
 * Pure-function template module. Takes a `BrainBriefData` payload (already
 * normalized from the NUC Brain API by the cron handler) and returns
 * { html, text, subject } for Resend, plus a 160-char SMS string for Twilio.
 *
 * Brand: dark navy bg (#0a0e1a), cyan #00d4ff, violet #a855f7 — matches the
 * brain.abellumber.com/command UI. NOT the same palette as the existing
 * `morning-briefing` cron (which uses Abel walnut/gold for the operations
 * audience). This brief is the "Brain output" — a different product surface
 * targeting Nate alone.
 *
 * Inline CSS only. No external stylesheets, no <link>, no <script>. Email
 * clients (Gmail, Apple Mail, Outlook) ignore <head> styles inconsistently.
 *
 * Mobile-responsive via max-width: 600px container + table layout.
 */

export interface BrainInsight {
  id?: string
  kind?: string // e.g. "anomaly", "trend", "opportunity"
  narrative?: string // human-readable summary
  confidence?: number // 0..1
  entity_ids?: string[]
  source?: string
  created_at?: string
}

export interface BrainAction {
  id?: string
  title?: string
  description?: string
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string
  entity_id?: string
  due_at?: string
}

export interface BrainAnomaly {
  id?: string
  kind?: string // "spike", "silence", "drift", "anomaly"
  narrative?: string
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string
  entity_id?: string
  detected_at?: string
}

export interface BrainCalendarEvent {
  id?: string
  title?: string
  start_at?: string
  attendees?: string[]
  location?: string
}

export interface BrainHealth {
  events_ingested_today?: number
  total_actions_pending?: number
  agents_online?: number
  total_gaps?: number
  uptime_seconds?: number
}

export interface BrainBriefData {
  date: Date
  insights: BrainInsight[]
  actions: BrainAction[]
  anomalies: BrainAnomaly[]
  calendar: BrainCalendarEvent[]
  health: BrainHealth
  // True if /brain/brief/today returned 200; false if we synthesized from
  // /brain/insights instead. Surfaced in the email footer for transparency.
  fromCachedBrief: boolean
  // Total recommended-actions count (top 3 are shown; total is mentioned in SMS)
  totalActions: number
  totalAlerts: number
}

// ─── Brand tokens (inline-only, email-safe) ────────────────────────────────
const COLORS = {
  bg: '#0a0e1a',
  panel: '#111827',
  border: '#1f2937',
  text: '#e5e7eb',
  muted: '#9ca3af',
  cyan: '#00d4ff',
  violet: '#a855f7',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtTime(s?: string): string {
  if (!s) return ''
  try {
    return new Date(s).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    })
  } catch {
    return s
  }
}

function pct(n?: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}%`
}

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function kindIcon(kind?: string): string {
  const k = (kind || '').toLowerCase()
  if (k.includes('anomaly') || k.includes('spike')) return '⚡'
  if (k.includes('silence')) return '🔕'
  if (k.includes('trend')) return '📈'
  if (k.includes('opportunity')) return '✨'
  if (k.includes('risk')) return '⚠'
  if (k.includes('finding')) return '🔎'
  return '◆'
}

function priorityColor(p?: string): string {
  const v = (p || '').toUpperCase()
  if (v === 'CRITICAL') return COLORS.red
  if (v === 'HIGH') return COLORS.amber
  if (v === 'MEDIUM') return COLORS.cyan
  return COLORS.muted
}

function severityColor(s?: string): string {
  return priorityColor(s)
}

// ─── Public API ────────────────────────────────────────────────────────────

export function buildMorningBrainBrief(data: BrainBriefData): {
  html: string
  text: string
  subject: string
} {
  const dateStr = fmtDate(data.date)
  const subject = `Abel Brain · Daily Brief — ${fmtShortDate(data.date)}`

  const html = renderHtml(data, dateStr)
  const text = renderText(data, dateStr)

  return { html, text, subject }
}

export function buildMorningBrainSms(data: BrainBriefData): string {
  const date = fmtShortDate(data.date)
  const top = data.insights[0]?.narrative || 'No new insights'
  // Trim top to fit total budget of 160 chars including framing.
  // Frame: "🧠 Abel Brain {date}: {top} · {a} actions, {x} alerts. View: brain.abellumber.com/command"
  const frame = `🧠 Abel Brain ${date}: %TOP% · ${data.totalActions} actions, ${data.totalAlerts} alerts. View: brain.abellumber.com/command`
  const overhead = frame.length - '%TOP%'.length
  const room = Math.max(20, 160 - overhead)
  const trimmed = top.length > room ? top.slice(0, room - 1).trimEnd() + '…' : top
  return frame.replace('%TOP%', trimmed)
}

// ─── HTML renderer ─────────────────────────────────────────────────────────

function renderHtml(data: BrainBriefData, dateStr: string): string {
  const top5 = data.insights.slice(0, 5)
  const topActions = data.actions
    .filter((a) => {
      const p = (a.priority || '').toUpperCase()
      return p === 'CRITICAL' || p === 'HIGH'
    })
    .slice(0, 3)
  const top5Anomalies = data.anomalies.slice(0, 5)
  const calendar = data.calendar.slice(0, 6)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(`Abel Brain · ${dateStr}`)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">

          ${renderHeader(dateStr)}
          ${renderInsights(top5)}
          ${renderHealth(data.health)}
          ${renderAnomalies(top5Anomalies)}
          ${renderCalendar(calendar, data.date)}
          ${renderActions(topActions)}
          ${renderFooter(data.fromCachedBrief)}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function renderHeader(dateStr: string): string {
  return `
<tr>
  <td style="padding:32px 32px 24px 32px;border-bottom:1px solid ${COLORS.border};background:linear-gradient(135deg,${COLORS.bg} 0%,${COLORS.panel} 100%);">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.cyan};margin-bottom:8px;">
            Abel Brain · Daily Brief
          </div>
          <div style="font-size:24px;font-weight:700;color:${COLORS.text};line-height:1.2;">
            ${escapeHtml(dateStr)}
          </div>
          <div style="font-size:13px;color:${COLORS.muted};margin-top:6px;">
            Generated by the NUC autonomous engine
          </div>
        </td>
        <td align="right" valign="top" style="width:64px;">
          <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,${COLORS.cyan} 0%,${COLORS.violet} 100%);text-align:center;line-height:48px;font-size:24px;">
            🧠
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`
}

function renderInsights(insights: BrainInsight[]): string {
  const body = insights.length === 0
    ? `<div style="padding:16px;color:${COLORS.muted};font-size:14px;font-style:italic;">No high-confidence insights for today.</div>`
    : insights.map((i, idx) => {
        const chips = (i.entity_ids || []).slice(0, 4).map(id =>
          `<span style="display:inline-block;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;color:${COLORS.cyan};background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.3);padding:2px 8px;border-radius:10px;margin-right:4px;margin-top:4px;">${escapeHtml(id)}</span>`
        ).join('')
        return `
<div style="padding:14px 16px;${idx > 0 ? `border-top:1px solid ${COLORS.border};` : ''}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td valign="top" style="width:32px;font-size:18px;line-height:1.2;color:${COLORS.violet};padding-top:2px;">${kindIcon(i.kind)}</td>
      <td valign="top">
        <div style="font-size:14px;line-height:1.5;color:${COLORS.text};">
          ${escapeHtml(i.narrative || '(no narrative)')}
        </div>
        <div style="margin-top:6px;font-size:11px;color:${COLORS.muted};">
          <span style="color:${COLORS.cyan};font-weight:600;">${pct(i.confidence)}</span> confidence
          ${i.kind ? `· <span style="text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(i.kind)}</span>` : ''}
        </div>
        ${chips ? `<div style="margin-top:6px;">${chips}</div>` : ''}
      </td>
    </tr>
  </table>
</div>`
      }).join('')

  return section('Top 5 Insights', body)
}

function renderHealth(h: BrainHealth): string {
  const stat = (label: string, value: string | number | undefined, color: string) => `
<td valign="top" style="width:25%;padding:8px 6px;">
  <div style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:8px;padding:12px;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:${color};line-height:1.1;">${escapeHtml(String(value ?? '—'))}</div>
    <div style="font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:${COLORS.muted};margin-top:4px;">${escapeHtml(label)}</div>
  </div>
</td>`
  const body = `
<div style="padding:8px 10px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      ${stat('Events Today', h.events_ingested_today, COLORS.cyan)}
      ${stat('Pending Actions', h.total_actions_pending, COLORS.amber)}
      ${stat('Agents Online', h.agents_online, COLORS.green)}
      ${stat('Open Gaps', h.total_gaps, COLORS.violet)}
    </tr>
  </table>
</div>`
  return section('System Health', body)
}

function renderAnomalies(anomalies: BrainAnomaly[]): string {
  const body = anomalies.length === 0
    ? `<div style="padding:16px;color:${COLORS.muted};font-size:14px;font-style:italic;">No anomalies detected.</div>`
    : anomalies.map((a, idx) => {
        const sev = severityColor(a.severity)
        return `
<div style="padding:12px 16px;${idx > 0 ? `border-top:1px solid ${COLORS.border};` : ''}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td valign="top" style="width:8px;padding:6px 0;"><div style="width:4px;height:32px;background:${sev};border-radius:2px;"></div></td>
      <td valign="top" style="padding-left:12px;">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:${sev};margin-bottom:3px;">
          ${escapeHtml(a.kind || 'anomaly')} · ${escapeHtml(a.severity || 'med')}
        </div>
        <div style="font-size:13px;line-height:1.5;color:${COLORS.text};">
          ${escapeHtml(a.narrative || '(no detail)')}
        </div>
      </td>
    </tr>
  </table>
</div>`
      }).join('')
  return section('Watchlist · Anomalies', body)
}

function renderCalendar(events: BrainCalendarEvent[], date: Date): string {
  if (events.length === 0) {
    return section(
      'Calendar Today',
      `<div style="padding:16px;color:${COLORS.muted};font-size:14px;font-style:italic;">No calendar events captured for ${escapeHtml(fmtShortDate(date))}.</div>`
    )
  }
  const body = events.map((e, idx) => `
<div style="padding:10px 16px;${idx > 0 ? `border-top:1px solid ${COLORS.border};` : ''}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td valign="top" style="width:80px;font-size:12px;font-family:'SF Mono',Menlo,Consolas,monospace;color:${COLORS.cyan};padding-top:2px;">
        ${escapeHtml(fmtTime(e.start_at) || '—')}
      </td>
      <td valign="top">
        <div style="font-size:13px;font-weight:600;color:${COLORS.text};line-height:1.4;">${escapeHtml(e.title || '(untitled)')}</div>
        ${e.location ? `<div style="font-size:11px;color:${COLORS.muted};margin-top:2px;">${escapeHtml(e.location)}</div>` : ''}
      </td>
    </tr>
  </table>
</div>`).join('')
  return section('Calendar Today', body)
}

function renderActions(actions: BrainAction[]): string {
  const body = actions.length === 0
    ? `<div style="padding:16px;color:${COLORS.muted};font-size:14px;font-style:italic;">No critical or high-priority actions queued.</div>`
    : actions.map((a, idx) => {
        const c = priorityColor(a.priority)
        return `
<div style="padding:12px 16px;${idx > 0 ? `border-top:1px solid ${COLORS.border};` : ''}">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${c};margin-bottom:4px;">
    ${escapeHtml(a.priority || 'MEDIUM')}
  </div>
  <div style="font-size:14px;font-weight:600;color:${COLORS.text};line-height:1.4;">
    ${escapeHtml(a.title || '(untitled action)')}
  </div>
  ${a.description ? `<div style="font-size:12px;color:${COLORS.muted};margin-top:4px;line-height:1.5;">${escapeHtml(a.description)}</div>` : ''}
</div>`
      }).join('')
  return section('Recommended Actions', body)
}

function renderFooter(fromCachedBrief: boolean): string {
  return `
<tr>
  <td style="padding:24px 32px;border-top:1px solid ${COLORS.border};background:${COLORS.bg};">
    <div style="text-align:center;">
      <a href="https://brain.abellumber.com/command" style="display:inline-block;background:linear-gradient(135deg,${COLORS.cyan} 0%,${COLORS.violet} 100%);color:#0a0e1a;font-weight:700;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
        Open Brain Command
      </a>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:11px;color:${COLORS.muted};line-height:1.6;">
      Auto-generated by Abel Brain · ${fromCachedBrief ? 'cached daily brief' : 'synthesized from live insights'}<br>
      <a href="https://brain.abellumber.com/command" style="color:${COLORS.cyan};text-decoration:none;">brain.abellumber.com/command</a>
    </div>
  </td>
</tr>`
}

function section(title: string, body: string): string {
  return `
<tr>
  <td style="padding:24px 24px 8px 24px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${COLORS.cyan};margin-bottom:12px;padding-left:8px;border-left:3px solid ${COLORS.violet};">
      ${escapeHtml(title)}
    </div>
    <div style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
      ${body}
    </div>
  </td>
</tr>`
}

// ─── Plaintext renderer (for email clients that prefer it) ─────────────────

function renderText(data: BrainBriefData, dateStr: string): string {
  const lines: string[] = []
  lines.push(`ABEL BRAIN · DAILY BRIEF — ${dateStr}`)
  lines.push('='.repeat(60))
  lines.push('')

  lines.push('TOP INSIGHTS')
  lines.push('-'.repeat(60))
  if (data.insights.length === 0) {
    lines.push('(none)')
  } else {
    data.insights.slice(0, 5).forEach((i, idx) => {
      lines.push(`${idx + 1}. [${pct(i.confidence)}] ${i.narrative || '(no narrative)'}`)
      if (i.entity_ids?.length) lines.push(`   entities: ${i.entity_ids.slice(0, 4).join(', ')}`)
    })
  }
  lines.push('')

  lines.push('SYSTEM HEALTH')
  lines.push('-'.repeat(60))
  lines.push(`Events today:    ${data.health.events_ingested_today ?? '—'}`)
  lines.push(`Pending actions: ${data.health.total_actions_pending ?? '—'}`)
  lines.push(`Agents online:   ${data.health.agents_online ?? '—'}`)
  lines.push(`Open gaps:       ${data.health.total_gaps ?? '—'}`)
  lines.push('')

  lines.push('WATCHLIST')
  lines.push('-'.repeat(60))
  if (data.anomalies.length === 0) {
    lines.push('(no anomalies)')
  } else {
    data.anomalies.slice(0, 5).forEach((a) => {
      lines.push(`[${(a.severity || 'med').toUpperCase()}] ${a.kind || 'anomaly'}: ${a.narrative || ''}`)
    })
  }
  lines.push('')

  lines.push('CALENDAR TODAY')
  lines.push('-'.repeat(60))
  if (data.calendar.length === 0) {
    lines.push('(no events)')
  } else {
    data.calendar.slice(0, 6).forEach((e) => {
      lines.push(`${fmtTime(e.start_at) || '—'}  ${e.title || '(untitled)'}`)
    })
  }
  lines.push('')

  lines.push('RECOMMENDED ACTIONS')
  lines.push('-'.repeat(60))
  const top = data.actions
    .filter((a) => ['CRITICAL', 'HIGH'].includes((a.priority || '').toUpperCase()))
    .slice(0, 3)
  if (top.length === 0) {
    lines.push('(none critical/high)')
  } else {
    top.forEach((a) => {
      lines.push(`[${a.priority}] ${a.title || ''}`)
      if (a.description) lines.push(`  ${a.description}`)
    })
  }
  lines.push('')

  lines.push('-'.repeat(60))
  lines.push('Open Brain Command: https://brain.abellumber.com/command')
  lines.push(
    `Auto-generated · source=${data.fromCachedBrief ? 'cached brief' : 'synthesized from insights'}`
  )

  return lines.join('\n')
}
