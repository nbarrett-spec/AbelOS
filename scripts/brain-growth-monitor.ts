/**
 * Brain Growth Monitor — READ-ONLY
 * ---------------------------------------------------------------
 * Polls the Brain proxy for /brain/health + /brain/agents, captures
 * the headline metrics, appends a markdown row to the growth log.
 *
 * No DB writes, no Brain writes — pure observability.
 *
 * Writes to:
 *   C:\Users\natha\OneDrive\Abel Lumber\AEGIS-BRAIN-GROWTH-LOG.md
 *
 * Usage:
 *   npx tsx scripts/brain-growth-monitor.ts                   # single snapshot
 *   npx tsx scripts/brain-growth-monitor.ts --note "label"    # with label
 *
 * Source tag: BRAIN_GROWTH_MONITOR
 */

import { appendFileSync, existsSync, writeFileSync } from 'fs'

const PROXY_BASE =
  'https://jarvis-command-center-navy.vercel.app/api/brain?endpoint='
const LOG_PATH =
  'C:\\Users\\natha\\OneDrive\\Abel Lumber\\AEGIS-BRAIN-GROWTH-LOG.md'

type Health = {
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

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${PROXY_BASE}${encodeURIComponent(path)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return (await res.json()) as T
}

async function snapshot(note?: string): Promise<void> {
  const [health, agents] = await Promise.all([
    fetchJson<Health>('/brain/health'),
    fetchJson<AgentsResp>('/brain/agents'),
  ])

  const now = new Date().toISOString()
  const ingest = agents.agents.find((a) => a.role === 'ingest')
  const feed = agents.agents.find((a) => a.role === 'feed')

  const header =
    '| Timestamp (UTC) | Note | Entities | Conn | Gaps | Actions | Events/hr | Events/day | Health | Ingest last run |'
  const sep =
    '|---|---|---|---|---|---|---|---|---|---|'
  const row = `| ${now} | ${note || ''} | ${health.total_entities} | ${health.total_connections} | ${health.total_gaps} | ${health.total_actions_pending} | ${health.events_ingested_last_hour} | ${health.events_ingested_today} | ${health.overall_health} | ${ingest?.last_run_start || '-'} |`

  if (!existsSync(LOG_PATH)) {
    writeFileSync(
      LOG_PATH,
      `# Aegis → Brain Growth Log\n\nSource: \`scripts/brain-growth-monitor.ts\` (READ-ONLY).\nProxy: \`${PROXY_BASE}\`\n\n${header}\n${sep}\n${row}\n`,
      'utf8'
    )
  } else {
    appendFileSync(LOG_PATH, `${row}\n`, 'utf8')
  }

  console.log(row)
  console.log(
    `ingest agent: status=${ingest?.status} failures=${ingest?.consecutive_failures} last_events=${ingest?.last_run_events_processed}`
  )
  console.log(
    `feed agent:   status=${feed?.status} failures=${feed?.consecutive_failures} last_events=${feed?.last_run_events_processed}`
  )
}

async function main() {
  const args = process.argv.slice(2)
  const noteIdx = args.indexOf('--note')
  const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
  await snapshot(note)
}

main().catch((err) => {
  console.error('brain-growth-monitor error:', err)
  process.exit(1)
})
