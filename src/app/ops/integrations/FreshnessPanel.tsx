'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// FreshnessPanel — Wave-3 C10
//
// Real-time freshness dashboard across Aegis's 39 crons + 8 integration
// freshness signals. Renders at the top of /ops/integrations so Nate /
// ops can answer "is Hyphen syncing? any failures?" at a glance.
//
// Data sources:
//   - GET /api/health/crons               per-cron health (W1 A7)
//   - GET /api/ops/admin/integrations-freshness    per-integration cadence
//
// Both are called in parallel, merged intelligently by mapping cron ->
// integration name. Auto-refreshes every 30s; interval is cleared on
// unmount to avoid memory leaks.
//
// Feature flag: NEXT_PUBLIC_FEATURE_INTEGRATIONS_DASH. Default on; set to
// 'off' to hide the panel.
// ──────────────────────────────────────────────────────────────────────────

type HealthColor = 'GREEN' | 'YELLOW' | 'RED'
type CronStatus = 'SUCCESS' | 'FAILURE' | 'RUNNING' | null

interface CronHealth {
  name: string
  lastRunAt: string | null
  lastStatus: CronStatus
  lastDurationMs: number | null
  lastError: string | null
  successCount24h: number
  failureCount24h: number
  consecutiveFailures: number
  avgDurationMs7d: number | null
  health: HealthColor
}

interface CronHealthResponse {
  generatedAt: string
  cronCount: number
  healthy: number
  degraded: number
  zombies: number
  crons: CronHealth[]
  note?: string
}

type FreshnessStatus = 'green' | 'amber' | 'red' | 'not-wired'

interface IntegrationFreshness {
  key: string
  label: string
  description: string
  status: FreshnessStatus
  lastSyncAt: string | null
  lastSuccessAt: string | null
  secondarySignalAt: string | null
  signalSource: string
  cadenceMinutes: number | null
  nextExpectedAt: string | null
  minutesSinceLast: number | null
  cronName: string | null
  notes: string | null
}

interface FreshnessResponse {
  atdateTime: string
  summary: { green: number; amber: number; red: number; notWired: number }
  integrations: IntegrationFreshness[]
}

// ── Cron name → display metadata ─────────────────────────────────────────
// Covers every cron under src/app/api/cron plus a few aliases seen in
// vercel.json. Unknown names fall back to a humanized version of the slug.
const CRON_META: Record<
  string,
  { label: string; description?: string; detailsHref?: string }
> = {
  'inflow-sync': {
    label: 'InFlow Inventory',
    description: 'Catalog + stock-level sync',
    detailsHref: '/ops/integrations/inflow',
  },
  'hyphen-sync': {
    label: 'Hyphen (Brookfield)',
    description: 'BuildPro/SupplyPro PO ingestion',
  },
  'gmail-sync': {
    label: 'Gmail',
    description: 'Email thread → comms log',
  },
  'buildertrend-sync': {
    label: 'BuilderTrend',
    description: 'Project + schedule pull',
    detailsHref: '/ops/integrations/buildertrend',
  },
  'bolt-sync': {
    label: 'ECI Bolt',
    description: 'Legacy work-order scrape',
  },
  'bpw-sync': {
    label: 'BWP Ingest',
    description: 'Brookfield-Winchester-Pulte exports',
  },
  'shortage-forecast': {
    label: 'MRP Shortage Forecast',
    description: 'Nightly shortage projection',
  },
  'allocation-health': {
    label: 'Allocation Integrity',
    description: 'Reserve vs. on-hand reconciliation',
  },
  'zombie-sweep': {
    label: 'Cron Watchdog',
    description: 'Stale-RUNNING row sweep',
  },
  'collections-email': {
    label: 'Collections Email',
    description: 'AR reminder dispatch',
  },
  'collections-ladder': {
    label: 'Collections Ladder',
    description: 'Dunning-step advance',
  },
  'collections-cycle': {
    label: 'Collections Cycle',
    description: 'Full AR cycle pass',
  },
  'cross-dock-scan': {
    label: 'Cross-Dock Scan',
    description: 'Inbound PO pass-through detection',
  },
  'webhook-retry': {
    label: 'Webhook DLQ Replay',
    description: 'Failed webhook redelivery',
  },
  'vendor-scorecard-daily': {
    label: 'Vendor Scorecards',
    description: 'Daily OTIF + quality rollup',
  },
  'cycle-count-schedule': {
    label: 'Cycle-Count Scheduler',
    description: 'ABC-class count plan',
  },
  'demand-forecast-weekly': {
    label: 'Demand Forecast',
    description: 'Weekly builder demand refresh',
  },
  'gold-stock-monitor': {
    label: 'Gold Stock Monitor',
    description: 'Critical-stock guardrail',
  },
  'mrp-nightly': {
    label: 'MRP Nightly',
    description: 'Full MRP projection',
  },
  'morning-briefing': {
    label: 'Morning Briefing',
    description: 'Daily ops summary digest',
  },
  'daily-digest': {
    label: 'Daily Digest',
    description: 'Per-user inbox digest',
  },
  'weekly-report': {
    label: 'Weekly Report',
    description: 'Exec weekly KPI pack',
  },
  'financial-snapshot': {
    label: 'Financial Snapshot',
    description: 'AR/AP/cash position capture',
  },
  'pm-daily-tasks': {
    label: 'PM Daily Tasks',
    description: 'Project-manager task roll',
  },
  'quote-followups': {
    label: 'Quote Follow-ups',
    description: 'Stale-quote chase logic',
  },
  'process-outreach': {
    label: 'Outreach Processor',
    description: 'Queued outreach dispatch',
  },
  'run-automations': {
    label: 'Automation Runner',
    description: 'User-defined automations',
  },
  'uptime-probe': {
    label: 'Uptime Probe',
    description: 'Synthetic-canary ping',
  },
  'observability-gc': {
    label: 'Observability GC',
    description: 'Log + audit trim',
  },
  'inbox-feed': {
    label: 'Inbox Feed',
    description: 'Background inbox builder',
  },
  'material-watch': {
    label: 'Material Watch',
    description: 'Price/lead-time watcher',
  },
  'material-confirm-checkpoint': {
    label: 'Material Confirm Checkpoint',
    description: 'Builder confirmation sweep',
  },
  'agent-opportunities': {
    label: 'Agent Opportunities',
    description: 'NUC opportunity ingest',
  },
  'brain-sync': {
    label: 'NUC Brain Sync',
    description: 'Aegis ↔ NUC engine sync',
  },
  'brain-sync-staff': {
    label: 'NUC Brain (staff)',
    description: 'Staff-scoped brain sync',
  },
  'aegis-brain-sync': {
    label: 'Aegis → Brain',
    description: 'Aegis payload to NUC',
  },
  'nuc-alerts': {
    label: 'NUC Alerts',
    description: 'NUC alert ingestion',
  },
  'data-quality': {
    label: 'Data Quality',
    description: 'Quick integrity checks',
  },
  'data-quality-watchdog': {
    label: 'Data Quality Watchdog',
    description: 'Nightly integrity scan',
  },
}

// Map the freshness-endpoint integration key → the dedicated page, when we
// have one. Bolt / Stripe / NUC don't have dedicated ops pages yet.
const INTEGRATION_DETAILS_HREF: Record<string, string | undefined> = {
  inflow: '/ops/integrations/inflow',
  quickbooks: '/ops/integrations/quickbooks',
  buildertrend: '/ops/integrations/buildertrend',
  hyphen: undefined,
  gmail: undefined,
  bolt: undefined,
  stripe: undefined,
  nuc_brain: undefined,
  data_quality_watchdog: undefined,
}

const REFRESH_INTERVAL_MS = 30_000

function humanizeCronName(name: string): string {
  return name
    .split(/[-_]/)
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

function relative(ts: string | null): string {
  if (!ts) return 'never'
  const ms = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatAbsolute(ts: string | null): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

const HEALTH_COLOR: Record<HealthColor, { dot: string; chip: string; text: string; border: string }> = {
  GREEN: {
    dot: '#10B981',
    chip: '#D1FAE5',
    text: '#065F46',
    border: '#A7F3D0',
  },
  YELLOW: {
    dot: '#F59E0B',
    chip: '#FEF3C7',
    text: '#92400E',
    border: '#FDE68A',
  },
  RED: {
    dot: '#EF4444',
    chip: '#FEE2E2',
    text: '#991B1B',
    border: '#FCA5A5',
  },
}

const SORT_ORDER: Record<HealthColor, number> = { RED: 0, YELLOW: 1, GREEN: 2 }

interface IntegrationCard {
  cronName: string
  label: string
  description?: string
  health: HealthColor
  lastRunAt: string | null
  lastStatus: CronStatus
  lastDurationMs: number | null
  lastError: string | null
  successCount24h: number
  failureCount24h: number
  consecutiveFailures: number
  detailsHref?: string
  freshnessNote?: string | null
}

// Map freshness endpoint key → a cron name so we can overlay its notes onto
// the matching card. Some integrations (e.g. nuc_brain) map to a specific
// cron name we know about.
const FRESHNESS_TO_CRON: Record<string, string> = {
  inflow: 'inflow-sync',
  hyphen: 'hyphen-sync',
  gmail: 'gmail-sync',
  bolt: 'bolt-sync',
  nuc_brain: 'brain-sync',
  data_quality_watchdog: 'data-quality-watchdog',
}

export default function FreshnessPanel() {
  const enabled = process.env.NEXT_PUBLIC_FEATURE_INTEGRATIONS_DASH !== 'off'

  const [cronHealth, setCronHealth] = useState<CronHealthResponse | null>(null)
  const [freshness, setFreshness] = useState<FreshnessResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchAll() {
    try {
      const [cronRes, freshRes] = await Promise.all([
        fetch('/api/health/crons', { cache: 'no-store' }).catch(() => null),
        fetch('/api/ops/admin/integrations-freshness', { cache: 'no-store' }).catch(
          () => null
        ),
      ])

      if (cronRes && cronRes.ok) {
        const data: CronHealthResponse = await cronRes.json()
        setCronHealth(data)
      } else if (cronRes) {
        setError(`Cron health endpoint: ${cronRes.status}`)
      }

      if (freshRes && freshRes.ok) {
        const data: FreshnessResponse = await freshRes.json()
        setFreshness(data)
      }
      // Freshness endpoint requires staff auth — we swallow its failure and
      // fall back to cron-health only so the panel still renders for any
      // staff viewer who can hit /api/health/crons.

      setLastFetchedAt(new Date().toISOString())
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled) return
    fetchAll()
    intervalRef.current = setInterval(fetchAll, REFRESH_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const cards = useMemo<IntegrationCard[]>(() => {
    if (!cronHealth) return []

    // Build a freshness lookup by cron name so per-integration notes can
    // overlay onto the matching cron card.
    const freshnessNotesByCron = new Map<string, string>()
    if (freshness) {
      for (const f of freshness.integrations) {
        const mappedCron = f.cronName ?? FRESHNESS_TO_CRON[f.key]
        if (mappedCron && f.notes) freshnessNotesByCron.set(mappedCron, f.notes)
      }
    }

    return cronHealth.crons
      .map<IntegrationCard>((c) => {
        const meta = CRON_META[c.name]
        return {
          cronName: c.name,
          label: meta?.label ?? humanizeCronName(c.name),
          description: meta?.description,
          health: c.health,
          lastRunAt: c.lastRunAt,
          lastStatus: c.lastStatus,
          lastDurationMs: c.lastDurationMs,
          lastError: c.lastError,
          successCount24h: c.successCount24h,
          failureCount24h: c.failureCount24h,
          consecutiveFailures: c.consecutiveFailures,
          detailsHref: meta?.detailsHref,
          freshnessNote: freshnessNotesByCron.get(c.name) ?? null,
        }
      })
      .sort((a, b) => {
        const byHealth = SORT_ORDER[a.health] - SORT_ORDER[b.health]
        if (byHealth !== 0) return byHealth
        return a.label.localeCompare(b.label)
      })
  }, [cronHealth, freshness])

  if (!enabled) return null

  const summary = cronHealth
    ? {
        cronCount: cronHealth.cronCount,
        healthy: cronHealth.healthy,
        degraded: cronHealth.degraded,
        zombies: cronHealth.zombies,
        red: cards.filter((c) => c.health === 'RED').length,
        yellow: cards.filter((c) => c.health === 'YELLOW').length,
        green: cards.filter((c) => c.health === 'GREEN').length,
      }
    : null

  return (
    <section
      aria-label="Integration freshness dashboard"
      style={{ marginBottom: 24 }}
    >
      {/* Top strip */}
      <div
        style={{
          padding: 16,
          backgroundColor: 'var(--navy, #0a1a28)',
          borderRadius: 12,
          color: 'white',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.65, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Integration Cluster Health
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
            {loading
              ? 'Loading…'
              : summary
                ? `${summary.cronCount} crons monitored`
                : 'No data'}
          </div>
          {error && (
            <div style={{ fontSize: 11, color: '#FCA5A5', marginTop: 4 }}>{error}</div>
          )}
        </div>

        {summary && (
          <>
            <TopStat label="Green" value={summary.green} color="#10B981" />
            <TopStat label="Yellow" value={summary.yellow} color="#F59E0B" />
            <TopStat label="Red" value={summary.red} color="#EF4444" />
            <TopStat
              label="Zombies"
              value={summary.zombies}
              color={summary.zombies > 0 ? '#EF4444' : '#6B7280'}
            />
          </>
        )}

        <div
          aria-live="polite"
          aria-atomic="true"
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.7)',
            marginLeft: 'auto',
            textAlign: 'right',
            minWidth: 150,
          }}
        >
          {lastFetchedAt ? (
            <>
              <div>Last refresh: {relative(lastFetchedAt)}</div>
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
                Auto-refreshing every 30s
              </div>
            </>
          ) : (
            <div>Fetching…</div>
          )}
        </div>
      </div>

      {/* Card grid */}
      {loading && cards.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#9ca3af',
            backgroundColor: 'white',
            borderRadius: 12,
            border: '1px solid #e5e7eb',
          }}
        >
          Loading integration health…
        </div>
      ) : cards.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#9ca3af',
            backgroundColor: 'white',
            borderRadius: 12,
            border: '1px solid #e5e7eb',
          }}
        >
          No cron runs recorded yet. Once a cron fires its status will appear here.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 12,
          }}
        >
          {cards.map((card) => (
            <IntegrationCardView key={card.cronName} card={card} />
          ))}
        </div>
      )}
    </section>
  )
}

function TopStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 72 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.7)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function IntegrationCardView({ card }: { card: IntegrationCard }) {
  const colors = HEALTH_COLOR[card.health]
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: `1px solid ${colors.border}`,
        borderLeft: `4px solid ${colors.dot}`,
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: '0 1px 2px rgba(10,26,40,0.04)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: colors.dot,
            marginTop: 5,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#0a1a28',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={card.label}
          >
            {card.label}
          </div>
          {card.description && (
            <div
              style={{
                fontSize: 11,
                color: '#6b7280',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={card.description}
            >
              {card.description}
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
            backgroundColor: colors.chip,
            color: colors.text,
            letterSpacing: 0.5,
            whiteSpace: 'nowrap',
          }}
          aria-label={`Health status: ${card.health}`}
        >
          {card.health}
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          fontSize: 11,
          color: '#374151',
        }}
      >
        <Metric
          label="Last sync"
          value={relative(card.lastRunAt)}
          title={formatAbsolute(card.lastRunAt)}
        />
        <Metric label="Duration" value={formatDuration(card.lastDurationMs)} />
        <Metric
          label="Status"
          value={card.lastStatus ?? '—'}
          valueColor={
            card.lastStatus === 'SUCCESS'
              ? '#10B981'
              : card.lastStatus === 'FAILURE'
                ? '#EF4444'
                : card.lastStatus === 'RUNNING'
                  ? '#F59E0B'
                  : '#6B7280'
          }
        />
        <Metric
          label="Consec. fails"
          value={String(card.consecutiveFailures)}
          valueColor={card.consecutiveFailures > 0 ? '#EF4444' : '#374151'}
        />
        <Metric
          label="24h success"
          value={String(card.successCount24h)}
          valueColor="#10B981"
        />
        <Metric
          label="24h failed"
          value={String(card.failureCount24h)}
          valueColor={card.failureCount24h > 0 ? '#EF4444' : '#374151'}
        />
      </div>

      {/* Error snippet when present */}
      {card.lastError && (
        <div
          style={{
            fontSize: 10,
            color: '#991B1B',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 4,
            padding: '4px 6px',
            maxHeight: 32,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={card.lastError}
        >
          {card.lastError}
        </div>
      )}

      {/* Freshness note from /integrations-freshness */}
      {card.freshnessNote && (
        <div
          style={{
            fontSize: 10,
            color: '#92400E',
            backgroundColor: '#FFFBEB',
            border: '1px solid #FDE68A',
            borderRadius: 4,
            padding: '4px 6px',
          }}
        >
          {card.freshnessNote}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid #f3f4f6',
          paddingTop: 8,
          marginTop: 'auto',
        }}
      >
        <code style={{ fontSize: 10, color: '#9ca3af' }}>{card.cronName}</code>
        {card.detailsHref ? (
          <a
            href={card.detailsHref}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#0f2a3e',
              textDecoration: 'none',
            }}
          >
            View details →
          </a>
        ) : (
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>No details page</span>
        )}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  valueColor,
  title,
}: {
  label: string
  value: string
  valueColor?: string
  title?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: '#9ca3af',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: valueColor ?? '#1f2937',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={title ?? value}
      >
        {value}
      </span>
    </div>
  )
}
