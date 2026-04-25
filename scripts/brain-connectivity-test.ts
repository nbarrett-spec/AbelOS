/**
 * Brain ↔ Aegis Connectivity Test — READ-ONLY
 * ---------------------------------------------------------------
 * Full round-trip verification of the plumbing between Aegis
 * (app.abellumber.com) and Brain (brain.abellumber.com via CF
 * Access + Jarvis proxy).
 *
 * Writes a diagnostic report to:
 *   C:\Users\natha\OneDrive\Abel Lumber\AEGIS-BRAIN-CONNECTIVITY.md
 *
 * Creates ONE InboxItem (source=BRAIN_CONNECTIVITY_TEST) summarising
 * pass/fail across every path. That is the only DB write.
 *
 * Nothing else is written. Brain receives zero writes — we only read
 * /health, /agents, /entities, etc., plus one optional cron GET.
 *
 * Usage:
 *   npx tsx scripts/brain-connectivity-test.ts
 *   npx tsx scripts/brain-connectivity-test.ts --no-cron     # skip cron trigger
 *   npx tsx scripts/brain-connectivity-test.ts --no-inbox    # skip InboxItem write
 *
 * Source tag: BRAIN_CONNECTIVITY_TEST
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'
import { runAegisToBrainSync } from './aegis-to-brain-sync'

// ──────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────

const BRAIN_DIRECT = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'
const JARVIS_PROXY =
  'https://jarvis-command-center-navy.vercel.app/api/brain?endpoint='
const AEGIS_BASE = process.env.AEGIS_BASE_URL || 'https://app.abellumber.com'
const REPORT_PATH =
  'C:\\Users\\natha\\OneDrive\\Abel Lumber\\AEGIS-BRAIN-CONNECTIVITY.md'

const FETCH_TIMEOUT_MS = 20_000

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

type TestResult = {
  name: string
  path: string
  status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN'
  httpStatus?: number
  latencyMs?: number
  detail: string
  sample?: any
}

type AgentsResp = {
  agents: Array<{
    role: string
    status: string
    last_run_start: string | null
    last_run_end: string | null
    last_run_events_processed: number
    consecutive_failures: number
  }>
  count: number
}

type HealthResp = {
  timestamp: string
  total_entities: number
  total_events: number
  total_connections: number
  total_gaps: number
  total_actions_pending: number
  events_ingested_today: number
  events_ingested_last_hour: number
  overall_health: string
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function cfHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-ConnectivityTest/1.0',
  }
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (id && secret) {
    h['CF-Access-Client-Id'] = id
    h['CF-Access-Client-Secret'] = secret
  }
  const brainKey = process.env.BRAIN_API_KEY
  if (brainKey) h['X-API-Key'] = brainKey
  return h
}

async function timedFetch(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; bodyText: string; bodyJson?: any; latencyMs: number; errorMsg?: string }> {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const bodyText = await res.text().catch(() => '')
    let bodyJson: any = undefined
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined
    } catch {
      /* not json */
    }
    return {
      ok: res.ok,
      status: res.status,
      bodyText: bodyText.slice(0, 600),
      bodyJson,
      latencyMs: Date.now() - started,
    }
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      bodyText: '',
      latencyMs: Date.now() - started,
      errorMsg: err?.message || String(err),
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Individual tests
// ──────────────────────────────────────────────────────────────────

async function testJarvisProxyHealth(): Promise<TestResult> {
  const url = `${JARVIS_PROXY}${encodeURIComponent('/brain/health')}`
  const r = await timedFetch(url)
  if (!r.ok) {
    return {
      name: 'Jarvis proxy → /brain/health',
      path: url,
      status: 'FAIL',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: r.errorMsg || `HTTP ${r.status}: ${r.bodyText}`,
    }
  }
  const h = r.bodyJson as HealthResp | undefined
  return {
    name: 'Jarvis proxy → /brain/health',
    path: url,
    status: 'PASS',
    httpStatus: r.status,
    latencyMs: r.latencyMs,
    detail: `entities=${h?.total_entities ?? '?'} events=${h?.total_events ?? '?'} health=${h?.overall_health ?? '?'}`,
    sample: h,
  }
}

async function testJarvisProxyAgents(): Promise<TestResult> {
  const url = `${JARVIS_PROXY}${encodeURIComponent('/brain/agents')}`
  const r = await timedFetch(url)
  if (!r.ok) {
    return {
      name: 'Jarvis proxy → /brain/agents',
      path: url,
      status: 'FAIL',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: r.errorMsg || `HTTP ${r.status}: ${r.bodyText}`,
    }
  }
  const a = r.bodyJson as AgentsResp | undefined
  const ingest = a?.agents?.find((x) => x.role === 'ingest')
  const feed = a?.agents?.find((x) => x.role === 'feed')
  const detail = [
    `count=${a?.count ?? 0}`,
    ingest
      ? `ingest: status=${ingest.status}, failures=${ingest.consecutive_failures}, last=${ingest.last_run_start || '-'}, events_processed=${ingest.last_run_events_processed}`
      : 'ingest agent: MISSING',
    feed
      ? `feed: status=${feed.status}, failures=${feed.consecutive_failures}, last=${feed.last_run_start || '-'}, events_processed=${feed.last_run_events_processed}`
      : 'feed agent: MISSING',
  ].join(' | ')
  const stalled = (ingest?.consecutive_failures || 0) > 0 || (feed?.consecutive_failures || 0) > 0
  return {
    name: 'Jarvis proxy → /brain/agents',
    path: url,
    status: stalled ? 'WARN' : 'PASS',
    httpStatus: r.status,
    latencyMs: r.latencyMs,
    detail,
    sample: a,
  }
}

async function testDirectBrainHealth(): Promise<TestResult> {
  const url = `${BRAIN_DIRECT}/brain/health`
  const headers = cfHeaders()
  const hasCreds = 'CF-Access-Client-Id' in headers
  const r = await timedFetch(url, { method: 'GET', headers })
  if (!hasCreds) {
    return {
      name: 'Direct brain.abellumber.com /brain/health (CF Access token)',
      path: url,
      status: 'SKIP',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: 'CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET not set in local env. CF-protected path cannot be tested from this shell.',
    }
  }
  if (!r.ok) {
    return {
      name: 'Direct brain.abellumber.com /brain/health (CF Access token)',
      path: url,
      status: 'FAIL',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: r.errorMsg || `HTTP ${r.status}: ${r.bodyText}`,
    }
  }
  const h = r.bodyJson as HealthResp | undefined
  return {
    name: 'Direct brain.abellumber.com /brain/health (CF Access token)',
    path: url,
    status: 'PASS',
    httpStatus: r.status,
    latencyMs: r.latencyMs,
    detail: `entities=${h?.total_entities ?? '?'} events=${h?.total_events ?? '?'}`,
    sample: h,
  }
}

async function testAegisBrainProxyHealth(): Promise<TestResult> {
  // Unauthenticated probe — middleware should block it with 401/403
  // if the proxy route is correctly wired. Anything else means misconfig.
  const url = `${AEGIS_BASE}/api/ops/brain/proxy?path=health`
  const r = await timedFetch(url)
  if (r.status === 401 || r.status === 403) {
    return {
      name: 'Aegis → Brain relay (/api/ops/brain/proxy?path=health) — unauth probe',
      path: url,
      status: 'PASS',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: `Correctly requires staff auth (HTTP ${r.status}). Relay is up.`,
    }
  }
  if (r.status === 0) {
    return {
      name: 'Aegis → Brain relay (/api/ops/brain/proxy?path=health) — unauth probe',
      path: url,
      status: 'FAIL',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: r.errorMsg || 'Network failure',
    }
  }
  return {
    name: 'Aegis → Brain relay (/api/ops/brain/proxy?path=health) — unauth probe',
    path: url,
    status: 'WARN',
    httpStatus: r.status,
    latencyMs: r.latencyMs,
    detail: `Expected 401/403 unauth. Got HTTP ${r.status}. Body=${r.bodyText.slice(0, 150)}`,
  }
}

async function testAegisToBrainDryRun(prisma: PrismaClient): Promise<TestResult> {
  const started = Date.now()
  try {
    const report = await runAegisToBrainSync(prisma, {
      commit: false,
      lookbackMs: 24 * 60 * 60 * 1000,
      limit: null,
    })
    const latencyMs = Date.now() - started
    const detail = [
      `totalEvents=${report.totalEvents}`,
      `types=${Object.entries(report.eventCounts).map(([k, v]) => `${k}:${v}`).join(',') || 'none'}`,
      `cfAuth=${report.cfAuth}`,
    ].join(' | ')
    return {
      name: 'Aegis → Brain sync (DRY RUN — builds events only)',
      path: 'scripts/aegis-to-brain-sync.ts',
      status: 'PASS',
      latencyMs,
      detail,
      sample: { eventCounts: report.eventCounts, cfAuth: report.cfAuth },
    }
  } catch (err: any) {
    return {
      name: 'Aegis → Brain sync (DRY RUN — builds events only)',
      path: 'scripts/aegis-to-brain-sync.ts',
      status: 'FAIL',
      latencyMs: Date.now() - started,
      detail: `Threw: ${err?.message || err}`,
    }
  }
}

async function testCronTrigger(): Promise<TestResult> {
  const cronSecret = process.env.CRON_SECRET
  const url = `${AEGIS_BASE}/api/cron/aegis-brain-sync`
  if (!cronSecret) {
    return {
      name: 'Manual cron trigger GET /api/cron/aegis-brain-sync',
      path: url,
      status: 'SKIP',
      detail: 'CRON_SECRET not set in local env. Skipping trigger.',
    }
  }
  const r = await timedFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  })
  if (r.status === 401) {
    return {
      name: 'Manual cron trigger GET /api/cron/aegis-brain-sync',
      path: url,
      status: 'FAIL',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: 'HTTP 401 — CRON_SECRET on Vercel does not match the one in this shell. Redeploy env vars or rotate secret.',
    }
  }
  if (r.ok || r.status === 207) {
    const body = r.bodyJson || {}
    return {
      name: 'Manual cron trigger GET /api/cron/aegis-brain-sync',
      path: url,
      status: r.status === 200 ? 'PASS' : 'WARN',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: `sent=${body.sent ?? '?'} totalEvents=${body.totalEvents ?? '?'} cfAuth=${body.cfAuth ?? '?'} errors=${(body.errors || []).length}`,
      sample: body,
    }
  }
  return {
    name: 'Manual cron trigger GET /api/cron/aegis-brain-sync',
    path: url,
    status: 'FAIL',
    httpStatus: r.status,
    latencyMs: r.latencyMs,
    detail: r.errorMsg || `HTTP ${r.status}: ${r.bodyText}`,
  }
}

async function testBrainEntitiesQuery(): Promise<TestResult> {
  const url = `${JARVIS_PROXY}${encodeURIComponent('/brain/entities?limit=5')}`
  const r = await timedFetch(url)
  if (!r.ok) {
    return {
      name: 'Brain /brain/entities?limit=5 via Jarvis',
      path: url,
      status: 'FAIL',
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      detail: r.errorMsg || `HTTP ${r.status}: ${r.bodyText.slice(0, 200)}`,
    }
  }
  const data = r.bodyJson
  const count = Array.isArray(data?.entities) ? data.entities.length : Array.isArray(data) ? data.length : '?'
  return {
    name: 'Brain /brain/entities?limit=5 via Jarvis',
    path: url,
    status: 'PASS',
    httpStatus: r.status,
    latencyMs: r.latencyMs,
    detail: `returned ${count} entities`,
    sample: Array.isArray(data?.entities) ? data.entities.slice(0, 2) : data,
  }
}

// ──────────────────────────────────────────────────────────────────
// Report writer
// ──────────────────────────────────────────────────────────────────

function renderReport(results: TestResult[], gitSha: string): string {
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const warned = results.filter((r) => r.status === 'WARN').length
  const skipped = results.filter((r) => r.status === 'SKIP').length

  const now = new Date().toISOString()
  const lines: string[] = []
  lines.push(`# Aegis ↔ Brain Connectivity Report`)
  lines.push(``)
  lines.push(`**Generated:** ${now}`)
  lines.push(`**Script:** \`scripts/brain-connectivity-test.ts\` (READ-ONLY)`)
  lines.push(`**Git SHA:** \`${gitSha}\``)
  lines.push(``)
  lines.push(`## Summary`)
  lines.push(``)
  lines.push(`| PASS | FAIL | WARN | SKIP | Total |`)
  lines.push(`|---|---|---|---|---|`)
  lines.push(`| ${passed} | ${failed} | ${warned} | ${skipped} | ${results.length} |`)
  lines.push(``)
  lines.push(`## Test Matrix`)
  lines.push(``)
  lines.push(`| # | Test | Status | HTTP | Latency | Detail |`)
  lines.push(`|---|---|---|---|---|---|`)
  results.forEach((r, i) => {
    const emoji =
      r.status === 'PASS' ? '[OK]' : r.status === 'FAIL' ? '[FAIL]' : r.status === 'WARN' ? '[WARN]' : '[SKIP]'
    lines.push(
      `| ${i + 1} | ${r.name} | ${emoji} ${r.status} | ${r.httpStatus ?? '-'} | ${r.latencyMs ?? '-'}ms | ${r.detail.replace(/\|/g, '\\|')} |`
    )
  })
  lines.push(``)
  lines.push(`## Test Details`)
  lines.push(``)
  results.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.name}`)
    lines.push(``)
    lines.push(`- **Status:** ${r.status}`)
    lines.push(`- **Path:** \`${r.path}\``)
    if (r.httpStatus !== undefined) lines.push(`- **HTTP:** ${r.httpStatus}`)
    if (r.latencyMs !== undefined) lines.push(`- **Latency:** ${r.latencyMs}ms`)
    lines.push(`- **Detail:** ${r.detail}`)
    if (r.sample !== undefined) {
      const s = typeof r.sample === 'string' ? r.sample : JSON.stringify(r.sample, null, 2)
      lines.push(``)
      lines.push(`\`\`\`json`)
      lines.push(s.length > 1200 ? s.slice(0, 1200) + '\n…truncated' : s)
      lines.push(`\`\`\``)
    }
    lines.push(``)
  })
  lines.push(`## Environment`)
  lines.push(``)
  lines.push(`| Var | Present |`)
  lines.push(`|---|---|`)
  lines.push(`| CF_ACCESS_CLIENT_ID | ${process.env.CF_ACCESS_CLIENT_ID ? 'yes' : 'NO'} |`)
  lines.push(`| CF_ACCESS_CLIENT_SECRET | ${process.env.CF_ACCESS_CLIENT_SECRET ? 'yes' : 'NO'} |`)
  lines.push(`| CRON_SECRET | ${process.env.CRON_SECRET ? 'yes' : 'NO'} |`)
  lines.push(`| NUC_BRAIN_URL | ${process.env.NUC_BRAIN_URL || '(default brain.abellumber.com)'} |`)
  lines.push(`| AEGIS_BASE_URL | ${process.env.AEGIS_BASE_URL || '(default app.abellumber.com)'} |`)
  lines.push(`| DATABASE_URL | ${process.env.DATABASE_URL ? 'yes' : 'NO'} |`)
  lines.push(``)
  return lines.join('\n')
}

function summaryForInbox(results: TestResult[]): string {
  const rows = results
    .map(
      (r) =>
        `- [${r.status}] ${r.name}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''} — ${r.detail.slice(0, 200)}`
    )
    .join('\n')
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const warned = results.filter((r) => r.status === 'WARN').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  return [
    `Aegis ↔ Brain connectivity test executed ${new Date().toISOString()}`,
    `PASS=${passed} FAIL=${failed} WARN=${warned} SKIP=${skipped} (of ${results.length})`,
    ``,
    rows,
  ].join('\n')
}

function getGitSha(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process')
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const skipCron = argv.includes('--no-cron')
  const skipInbox = argv.includes('--no-inbox')

  const prisma = new PrismaClient()
  const gitSha = getGitSha()

  console.log('Running Brain connectivity test — READ-ONLY')
  console.log(`Git SHA: ${gitSha}`)
  console.log('')

  const results: TestResult[] = []

  // 1. Jarvis proxy — health
  results.push(await testJarvisProxyHealth())
  console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)

  // 2. Jarvis proxy — agents (are they progressing?)
  results.push(await testJarvisProxyAgents())
  console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)

  // 3. Brain entities query
  results.push(await testBrainEntitiesQuery())
  console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)

  // 4. Direct CF Access probe
  results.push(await testDirectBrainHealth())
  console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)

  // 5. Aegis Brain proxy relay (unauth probe)
  results.push(await testAegisBrainProxyHealth())
  console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)

  // 6. Aegis → Brain sync dry-run
  try {
    results.push(await testAegisToBrainDryRun(prisma))
    console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)
  } catch (err: any) {
    results.push({
      name: 'Aegis → Brain sync (DRY RUN — builds events only)',
      path: 'scripts/aegis-to-brain-sync.ts',
      status: 'FAIL',
      detail: `Fatal: ${err?.message || err}`,
    })
  }

  // 7. Cron trigger (optional)
  if (!skipCron) {
    results.push(await testCronTrigger())
    console.log(`  [${results[results.length - 1].status}] ${results[results.length - 1].name}`)
  } else {
    results.push({
      name: 'Manual cron trigger GET /api/cron/aegis-brain-sync',
      path: `${AEGIS_BASE}/api/cron/aegis-brain-sync`,
      status: 'SKIP',
      detail: 'Skipped via --no-cron',
    })
  }

  // ──────────────────────────────────────────
  // Write report
  // ──────────────────────────────────────────
  const report = renderReport(results, gitSha)
  writeFileSync(REPORT_PATH, report, 'utf8')
  console.log('')
  console.log(`Wrote report: ${REPORT_PATH}`)

  // ──────────────────────────────────────────
  // Write ONE InboxItem
  // ──────────────────────────────────────────
  if (!skipInbox) {
    try {
      const passed = results.filter((r) => r.status === 'PASS').length
      const failed = results.filter((r) => r.status === 'FAIL').length
      const warned = results.filter((r) => r.status === 'WARN').length
      const skippedCount = results.filter((r) => r.status === 'SKIP').length
      const priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' =
        failed > 0 ? 'HIGH' : warned > 0 ? 'MEDIUM' : 'LOW'

      const title = `Brain connectivity: ${passed}/${results.length} PASS (${failed} FAIL, ${warned} WARN, ${skippedCount} SKIP)`
      const description = summaryForInbox(results)

      await prisma.inboxItem.create({
        data: {
          type: 'SYSTEM',
          source: 'BRAIN_CONNECTIVITY_TEST',
          priority,
          status: 'PENDING',
          title,
          description,
          actionData: {
            gitSha,
            reportPath: REPORT_PATH,
            results: results.map((r) => ({
              name: r.name,
              status: r.status,
              httpStatus: r.httpStatus,
              latencyMs: r.latencyMs,
              detail: r.detail,
            })),
          } as any,
        },
      })
      console.log('Wrote 1 InboxItem (source=BRAIN_CONNECTIVITY_TEST)')
    } catch (err: any) {
      console.error('InboxItem write failed (schema drift?):', err?.message || err)
    }
  }

  await prisma.$disconnect()

  // Exit non-zero if any FAIL
  const anyFail = results.some((r) => r.status === 'FAIL')
  process.exitCode = anyFail ? 1 : 0
}

main().catch((err) => {
  console.error('brain-connectivity-test fatal:', err)
  process.exit(1)
})
