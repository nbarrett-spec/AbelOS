/**
 * scripts/cron-history-audit.ts
 *
 * READ-ONLY historical health analysis of every cron registered in
 * vercel.json, joined against the CronRun table for the last 30 days.
 *
 * For each configured cron we compute:
 *   - total runs, success/failure counts, success rate
 *   - average duration (ms), p95 duration (ms)
 *   - latest error message (if the most recent run failed)
 *   - last success timestamp
 *   - "stale" flag when no run landed inside its expected window
 *     (hourly crons > 90 minutes, daily crons > 25 hours, etc.)
 *   - composite health score (successRate weighted by expected frequency)
 *
 * Ranks all crons by health score, flags the at-risk tail, and writes:
 *   - stdout report
 *   - AEGIS-CRON-HISTORY.md next to the repo root
 *   - a single InboxItem summarising overall health + top-5 at-risk
 *
 * Source tag: CRON_HISTORY_AUDIT
 *
 * Constraints:
 *   - CronRun is READ-ONLY here. Only InboxItem writes are allowed.
 *
 * Usage:
 *   npx tsx scripts/cron-history-audit.ts          # DRY-RUN (no inbox write)
 *   npx tsx scripts/cron-history-audit.ts --commit # also write InboxItem
 */

import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const SOURCE_TAG = 'CRON_HISTORY_AUDIT'
const COMMIT = process.argv.includes('--commit')

const REPO_ROOT = path.resolve(__dirname, '..')
const VERCEL_JSON = path.join(REPO_ROOT, 'vercel.json')
const REPORT_PATH = path.resolve(REPO_ROOT, '..', 'AEGIS-CRON-HISTORY.md')

const prisma = new PrismaClient()

const LOOKBACK_DAYS = 30

// Path → CronRun.name convention: the handlers instrument themselves as the
// trailing path segment (e.g. "/api/cron/inflow-sync" → "inflow-sync"). A few
// handlers also use a dashed-with-dash variant; we try the last segment first,
// then fall back to scanning by LIKE match. Still all reads.
function pathToCronName(p: string): string {
  return p.split('/').filter(Boolean).pop() || p
}

type CronCfg = {
  path: string
  schedule: string
  name: string
  // Expected maximum gap between runs in minutes. Derived from the schedule.
  expectedMaxGapMin: number
  // Human-readable cadence label
  cadence: string
}

type RunRow = {
  id: string
  name: string
  status: string
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  error: string | null
}

type CronHealth = {
  cfg: CronCfg
  runs: RunRow[]
  total: number
  successes: number
  failures: number
  running: number
  successRate: number
  avgDurationMs: number | null
  p95DurationMs: number | null
  lastSuccessAt: Date | null
  lastRunAt: Date | null
  lastRunStatus: string | null
  latestError: string | null
  stale: boolean
  neverRan: boolean
  minutesSinceLastRun: number | null
  score: number
}

/**
 * Parse a vercel-style cron schedule string (5-field cron: m h dom mon dow)
 * and return the tightest expected gap between runs in minutes. This is a
 * conservative estimate used only for staleness flagging, not a full parser.
 */
function deriveExpectedGap(schedule: string): { gap: number; cadence: string } {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return { gap: 24 * 60, cadence: schedule }
  const [min, hr /*, dom, mon, dow */] = parts

  // */N in minutes field → every N minutes
  const minStep = min.match(/^\*\/(\d+)$/)
  if (minStep) {
    const n = parseInt(minStep[1], 10)
    return { gap: n, cadence: `every ${n}m` }
  }
  // */N in hour field → every N hours
  const hrStep = hr.match(/^\*\/(\d+)$/)
  if (hrStep) {
    const n = parseInt(hrStep[1], 10)
    return { gap: n * 60, cadence: `every ${n}h` }
  }
  // minute=0 and hour='*' → hourly
  if (min === '0' && hr === '*') return { gap: 60, cadence: 'hourly' }
  // numeric minute and hour='*' (e.g. "30 * * * *") → hourly-offset
  if (/^\d+$/.test(min) && hr === '*') return { gap: 60, cadence: 'hourly' }
  // comma-list of hours (e.g. "0 8,13,17 * * 1-5")
  if (/^\d+$/.test(min) && hr.includes(',')) {
    return { gap: 24 * 60, cadence: `${hr.split(',').length}x/day (weekdays)` }
  }
  // specific daily time (e.g. "0 4 * * *")
  if (/^\d+$/.test(min) && /^\d+$/.test(hr)) {
    // weekly if dow narrows
    if (parts[4] && /^[0-6]$/.test(parts[4])) return { gap: 7 * 24 * 60, cadence: 'weekly' }
    if (parts[4] && parts[4].includes('-')) return { gap: 24 * 60, cadence: 'weekdays' }
    return { gap: 24 * 60, cadence: 'daily' }
  }
  return { gap: 24 * 60, cadence: schedule }
}

function staleGraceFor(gap: number): number {
  // Grace window: 50% over expected, floor 15m, cap 1h for sub-hourly,
  // 1h floor for hourly, 1h floor for daily+.
  if (gap <= 15) return Math.max(15, Math.round(gap * 0.5))
  if (gap <= 60) return Math.max(30, Math.round(gap * 0.5))
  if (gap <= 24 * 60) return 60
  return 60
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return sorted[Math.max(0, idx)]
}

function fmtMs(v: number | null): string {
  if (v == null) return '—'
  if (v < 1000) return `${v}ms`
  return `${(v / 1000).toFixed(1)}s`
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z'
}

/**
 * Health score in [0..100]. successRate is the core signal; we then multiply
 * by a frequency weight so an hourly cron that's 95% green counts for more
 * than a weekly cron that's 95% green. Stale / never-ran crons bottom out.
 */
function scoreCron(h: Omit<CronHealth, 'score'>): number {
  if (h.neverRan) return 0
  const base = h.successRate // 0..1
  // frequency weight: daily=1, hourly=1.25, <=30m=1.5, weekly=0.75
  const gap = h.cfg.expectedMaxGapMin
  let freqWeight = 1
  if (gap <= 30) freqWeight = 1.5
  else if (gap <= 90) freqWeight = 1.25
  else if (gap >= 7 * 24 * 60) freqWeight = 0.75
  const staleness = h.stale ? 0.5 : 1 // halve score if stale
  const raw = base * freqWeight * staleness
  return Math.max(0, Math.min(100, Math.round(raw * 100)))
}

async function loadVercelCrons(): Promise<CronCfg[]> {
  const raw = await fs.readFile(VERCEL_JSON, 'utf8')
  const json = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> }
  const crons = json.crons ?? []
  return crons.map((c) => {
    const { gap, cadence } = deriveExpectedGap(c.schedule)
    return {
      path: c.path,
      schedule: c.schedule,
      name: pathToCronName(c.path),
      expectedMaxGapMin: gap,
      cadence,
    }
  })
}

async function fetchRunsForName(name: string, since: Date): Promise<RunRow[]> {
  // Primary lookup: CronRun.name === pathSegment. Also match common prefixed
  // forms just in case: "cron/<name>" or legacy "<name>-cron".
  const candidates = [name, `cron/${name}`, `${name}-cron`]
  const rows = await prisma.cronRun.findMany({
    where: {
      name: { in: candidates },
      startedAt: { gte: since },
    },
    select: {
      id: true,
      name: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      error: true,
    },
    orderBy: { startedAt: 'desc' },
  })
  return rows as RunRow[]
}

async function main() {
  console.log(`[cron-history-audit] mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'} sourceTag=${SOURCE_TAG}`)
  const now = new Date()
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  console.log(`Window: ${since.toISOString()} → ${now.toISOString()} (${LOOKBACK_DAYS}d)`)

  const crons = await loadVercelCrons()
  console.log(`Configured crons (vercel.json): ${crons.length}`)

  const healths: CronHealth[] = []

  for (const cfg of crons) {
    const runs = await fetchRunsForName(cfg.name, since)
    // Schema comment says FAILED but actual cron handlers write 'FAILURE'.
    // Accept both so the audit stays correct if either convention is used.
    const isFail = (s: string) => s === 'FAILED' || s === 'FAILURE'
    const successes = runs.filter((r) => r.status === 'SUCCESS').length
    const failures = runs.filter((r) => isFail(r.status)).length
    const running = runs.filter((r) => r.status === 'RUNNING').length
    const total = runs.length
    const successRate = total === 0 ? 0 : successes / total

    const durations = runs
      .filter((r) => r.durationMs != null && r.status === 'SUCCESS')
      .map((r) => r.durationMs!) as number[]
    const avgDurationMs =
      durations.length === 0
        ? null
        : Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
    const p95DurationMs = p95(durations)

    const lastSuccess = runs.find((r) => r.status === 'SUCCESS') ?? null
    const lastRun = runs[0] ?? null
    const latestError =
      lastRun && isFail(lastRun.status) ? lastRun.error ?? '(no error text)' : null

    const minutesSinceLastRun = lastRun
      ? Math.round((now.getTime() - lastRun.startedAt.getTime()) / (1000 * 60))
      : null
    const grace = staleGraceFor(cfg.expectedMaxGapMin)
    const stale =
      lastRun == null
        ? true
        : minutesSinceLastRun! > cfg.expectedMaxGapMin + grace

    const partial: Omit<CronHealth, 'score'> = {
      cfg,
      runs,
      total,
      successes,
      failures,
      running,
      successRate,
      avgDurationMs,
      p95DurationMs,
      lastSuccessAt: lastSuccess ? lastSuccess.startedAt : null,
      lastRunAt: lastRun ? lastRun.startedAt : null,
      lastRunStatus: lastRun ? lastRun.status : null,
      latestError,
      stale,
      neverRan: total === 0,
      minutesSinceLastRun,
    }
    healths.push({ ...partial, score: scoreCron(partial) })
  }

  // Rank ascending by health score (worst first for at-risk)
  const ranked = [...healths].sort((a, b) => a.score - b.score)

  const neverRan = healths.filter((h) => h.neverRan)
  const staleButRan = healths.filter((h) => h.stale && !h.neverRan)
  const failingLast = healths.filter(
    (h) => h.lastRunStatus === 'FAILED' || h.lastRunStatus === 'FAILURE',
  )
  const healthy = healths.filter((h) => !h.stale && h.successRate >= 0.95 && !h.neverRan)
  const overallHealthPct =
    healths.length === 0 ? 0 : Math.round((healthy.length / healths.length) * 100)

  // Today's success = any run started within the last 24h that SUCCEEDED.
  const d1 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const ranToday = healths.filter((h) =>
    h.runs.some((r) => r.startedAt >= d1 && r.status === 'SUCCESS'),
  )
  const ranTodayPct =
    healths.length === 0 ? 0 : Math.round((ranToday.length / healths.length) * 100)

  // ── Build report ───────────────────────────────────────────────────
  const lines: string[] = []
  lines.push('# Aegis Cron History Audit')
  lines.push('')
  lines.push(`Source tag: **${SOURCE_TAG}**`)
  lines.push(`Generated: ${now.toISOString()}`)
  lines.push(`Lookback: ${LOOKBACK_DAYS} days`)
  lines.push(`Configured crons: **${healths.length}**`)
  lines.push(`Ran successfully in last 24h: **${ranToday.length} (${ranTodayPct}%)**`)
  lines.push(`Healthy (95%+ success, not stale): **${healthy.length} (${overallHealthPct}%)**`)
  lines.push(`Stale (missed expected window): **${staleButRan.length}**`)
  lines.push(`Never ran in window: **${neverRan.length}**`)
  lines.push(`Last run FAILED: **${failingLast.length}**`)
  lines.push('')

  lines.push('## Top 5 at-risk crons (lowest health score)')
  const top5 = ranked.slice(0, 5)
  for (const h of top5) {
    lines.push(
      `- \`${h.cfg.name}\` (score=${h.score}, ${h.cfg.cadence}) — ` +
        `runs=${h.total} success=${h.successes} fail=${h.failures} ` +
        `lastRun=${fmtDate(h.lastRunAt)} ${h.stale ? '**STALE**' : ''}${h.neverRan ? ' **NEVER RAN**' : ''}`,
    )
    if (h.latestError) lines.push(`    - latest error: \`${h.latestError.slice(0, 200)}\``)
  }
  lines.push('')

  if (neverRan.length) {
    lines.push('## Configured but NEVER RAN in 30d window')
    for (const h of neverRan) {
      lines.push(`- \`${h.cfg.name}\` — schedule \`${h.cfg.schedule}\` (${h.cfg.cadence})`)
    }
    lines.push('')
  }

  if (staleButRan.length) {
    lines.push('## Stale (ran recently but missed their window)')
    for (const h of staleButRan) {
      lines.push(
        `- \`${h.cfg.name}\` — expected every ${h.cfg.expectedMaxGapMin}m, last run ${h.minutesSinceLastRun}m ago`,
      )
    }
    lines.push('')
  }

  lines.push('## Full ranking (worst → best)')
  lines.push('')
  lines.push('| Cron | Cadence | Runs | Success | Fail | Rate | AvgDur | p95Dur | LastRun | LastStatus | Score |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|')
  for (const h of ranked) {
    lines.push(
      `| \`${h.cfg.name}\` | ${h.cfg.cadence} | ${h.total} | ${h.successes} | ${h.failures} | ` +
        `${(h.successRate * 100).toFixed(0)}% | ${fmtMs(h.avgDurationMs)} | ${fmtMs(h.p95DurationMs)} | ` +
        `${fmtDate(h.lastRunAt)} | ${h.lastRunStatus ?? '—'}${h.stale ? ' (stale)' : ''} | ${h.score} |`,
    )
  }
  lines.push('')

  lines.push('## Latest failure messages')
  const withErrors = healths.filter((h) => h.latestError)
  if (!withErrors.length) lines.push('- None — no most-recent-run failures.')
  for (const h of withErrors) {
    lines.push(`- \`${h.cfg.name}\` — ${h.latestError!.slice(0, 300)}`)
  }
  lines.push('')

  lines.push('---')
  lines.push(
    'READ-ONLY analysis of the CronRun table. Only InboxItem writes occur, and only with `--commit`.',
  )
  lines.push(`Generated by \`scripts/cron-history-audit.ts\` (source tag: ${SOURCE_TAG}).`)
  lines.push('Specific git add: `git add scripts/cron-history-audit.ts`.')

  const body = lines.join('\n')
  await fs.writeFile(REPORT_PATH, body, 'utf8')
  console.log('\n' + body)
  console.log(`\nReport written to: ${REPORT_PATH}`)

  // ── InboxItem summary ──────────────────────────────────────────────
  const inboxPayload = {
    type: 'SYSTEM',
    source: 'cron-history-audit',
    title: `[Cron Health] ${overallHealthPct}% healthy — ${neverRan.length} never ran, ${staleButRan.length} stale`,
    description:
      `30-day CronRun audit across ${healths.length} configured crons.\n\n` +
      `Healthy: ${healthy.length}/${healths.length} (${overallHealthPct}%). ` +
      `Ran successfully in last 24h: ${ranToday.length}/${healths.length} (${ranTodayPct}%).\n\n` +
      `Top 5 at-risk:\n` +
      top5
        .map(
          (h, i) =>
            `${i + 1}. ${h.cfg.name} (score ${h.score}, ${h.total} runs, ${h.failures} fails` +
            `${h.neverRan ? ', NEVER RAN' : h.stale ? ', STALE' : ''})`,
        )
        .join('\n'),
    priority: overallHealthPct < 70 || neverRan.length >= 5 ? 'HIGH' : 'MEDIUM',
    actionData: {
      sourceTag: SOURCE_TAG,
      kind: 'summary',
      scannedAt: now.toISOString(),
      lookbackDays: LOOKBACK_DAYS,
      configuredCount: healths.length,
      healthyCount: healthy.length,
      overallHealthPct,
      ranTodayCount: ranToday.length,
      ranTodayPct,
      neverRan: neverRan.map((h) => h.cfg.name),
      stale: staleButRan.map((h) => h.cfg.name),
      top5AtRisk: top5.map((h) => ({
        name: h.cfg.name,
        score: h.score,
        total: h.total,
        successes: h.successes,
        failures: h.failures,
        stale: h.stale,
        neverRan: h.neverRan,
        lastRunAt: h.lastRunAt ? h.lastRunAt.toISOString() : null,
        latestError: h.latestError ? h.latestError.slice(0, 500) : null,
      })),
    } as unknown,
  }

  console.log(`\nInboxItem staged: 1 (priority=${inboxPayload.priority})`)

  if (!COMMIT) {
    console.log('\n[DRY-RUN] No InboxItem written. Re-run with --commit to persist.')
    await prisma.$disconnect()
    return
  }

  await prisma.inboxItem.create({
    data: {
      type: inboxPayload.type,
      source: inboxPayload.source,
      title: inboxPayload.title,
      description: inboxPayload.description,
      priority: inboxPayload.priority,
      status: 'PENDING',
      actionData: inboxPayload.actionData as never,
    },
  })
  console.log(`\n[COMMIT] Created 1 InboxItem (sourceTag=${SOURCE_TAG}).`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[cron-history-audit] FAILED', e)
  process.exit(1)
})
