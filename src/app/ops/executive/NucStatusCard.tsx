'use client'

// ──────────────────────────────────────────────────────────────────────────
// NucStatusCard — Monday-morning glance for the NUC brain engine.
//
// Wave 2.1: Now reads from the DB-backed /api/ops/nuc/status endpoint
// which is populated by the NUC's push-based heartbeat cron. This solves
// the Tailscale routing problem — the old pull-based approach tried to
// reach 100.84.113.47 from Vercel which always failed.
//
// The NUC pushes health data to POST /api/v1/engine/heartbeat every 60s.
// This card polls GET /api/ops/nuc/status every 60s to read the latest
// heartbeat from the database.
//
// States:
//   - online:   coordinator heartbeat is fresh and status === 'online'
//   - degraded: coordinator reports degraded modules, or heartbeat is
//               slightly stale (< 5 min)
//   - offline:  no heartbeat received, or heartbeat stale (> 3 min),
//               or coordinator reports error
//   - loading:  initial fetch in progress
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, CardDescription, Badge, LiveDataIndicator } from '@/components/ui'
import { cn } from '@/lib/utils'

type NucState = 'loading' | 'online' | 'degraded' | 'offline'

interface NodeStatus {
  nodeId: string
  nodeRole: string
  engineVersion: string | null
  status: string
  moduleStatus: Record<string, 'ok' | 'degraded' | 'error'> | null
  latencyMs: number | null
  uptimeSeconds: number | null
  errorCount: number | null
  lastScanAt: string | null
  receivedAt: string
  staleSeconds: number
  isStale: boolean
}

interface StatusResponse {
  ok: boolean
  nodes: NodeStatus[]
  coordinator: NodeStatus | null
  checkedAt: string
  error?: string
}

const POLL_MS = 60_000

function classify(data: StatusResponse | null, fetchError: string | null): NucState {
  if (fetchError) return 'offline'
  if (!data) return 'loading'
  if (!data.coordinator) return 'offline'

  const coord = data.coordinator

  // Stale heartbeat = offline
  if (coord.isStale) return 'offline'

  // Coordinator reports error status
  if (coord.status === 'error') return 'offline'

  // Check module-level health
  const modules = Object.values(coord.moduleStatus ?? {})
  if (modules.some((s) => s === 'error')) return 'offline'
  if (modules.some((s) => s === 'degraded')) return 'degraded'

  // Coordinator reports degraded
  if (coord.status === 'degraded') return 'degraded'

  return 'online'
}

function toneFor(state: NucState) {
  switch (state) {
    case 'online':
      return {
        dot: 'bg-data-positive',
        label: 'text-data-positive-fg',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-data-positive" />,
        badge: 'success' as const,
      }
    case 'degraded':
      return {
        dot: 'bg-data-warning',
        label: 'text-data-warning-fg',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-data-warning" />,
        badge: 'warning' as const,
      }
    case 'offline':
      return {
        dot: 'bg-data-negative',
        label: 'text-data-negative-fg',
        icon: <WifiOff className="w-3.5 h-3.5 text-data-negative" />,
        badge: 'danger' as const,
      }
    default:
      return {
        dot: 'bg-fg-subtle',
        label: 'text-fg-muted',
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />,
        badge: 'neutral' as const,
      }
  }
}

function formatUptime(seconds: number | null): string | null {
  if (seconds == null) return null
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

export default function NucStatusCard({ className }: { className?: string }) {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
  const [manuallyRefreshing, setManuallyRefreshing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (isManual = false) => {
    if (isManual) setManuallyRefreshing(true)
    try {
      const res = await fetch('/api/ops/nuc/status', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const body: StatusResponse = await res.json()
      setData(body)
      setFetchError(null)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLastRefreshed(Date.now())
      if (isManual) setManuallyRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()

    function start() {
      stop()
      timerRef.current = setInterval(() => load(), POLL_MS)
    }
    function stop() {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    function onVisibility() {
      if (document.hidden) {
        stop()
      } else {
        load()
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const state = classify(data, fetchError)
  const tone = toneFor(state)
  const coord = data?.coordinator
  const moduleCount = coord?.moduleStatus ? Object.keys(coord.moduleStatus).length : null
  const latency = coord?.latencyMs ?? null
  const uptime = formatUptime(coord?.uptimeSeconds ?? null)

  const agoStr = (() => {
    if (!lastRefreshed) return ''
    const sec = Math.max(0, Math.floor((Date.now() - lastRefreshed) / 1000))
    if (sec < 5) return 'just now'
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    return `${min}m ago`
  })()

  // Headline text — executive glance
  let headline: string
  let detail: string | null = null
  switch (state) {
    case 'loading':
      headline = 'Checking NUC engine…'
      break
    case 'online':
      headline = moduleCount
        ? `Engine online — ${moduleCount} module${moduleCount === 1 ? '' : 's'}${latency != null ? ` · ${latency}ms` : ''}`
        : `Engine online${latency != null ? ` · ${latency}ms` : ''}`
      detail = [
        coord?.engineVersion ? `v${coord.engineVersion}` : null,
        uptime ? `uptime ${uptime}` : null,
      ].filter(Boolean).join(' · ') || null
      break
    case 'degraded':
      headline = 'Engine degraded — some modules unhealthy'
      detail = coord?.engineVersion ? `v${coord.engineVersion}` : null
      break
    case 'offline':
      if (fetchError) {
        headline = 'Status check failed'
        detail = fetchError
      } else if (!coord) {
        headline = 'Offline — no heartbeat received'
        detail = 'NUC brain engine has not reported in. Verify the heartbeat cron is running on the NUC coordinator.'
      } else if (coord.isStale) {
        headline = `Offline — last heartbeat ${Math.floor(coord.staleSeconds / 60)}m ago`
        detail = `Last seen: ${new Date(coord.receivedAt).toLocaleString()}`
      } else {
        headline = 'Offline — engine reporting errors'
        detail = coord?.engineVersion ? `v${coord.engineVersion}` : null
      }
      break
  }

  return (
    <Card
      variant="default"
      padding="none"
      className={cn('relative hover:border-l-2 hover:border-signal transition-all duration-200', className)}
    >
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="relative flex w-2 h-2 shrink-0">
            {state === 'online' && (
              <span className={cn('absolute inset-0 rounded-full animate-pulse-soft', tone.dot)} />
            )}
            <span className={cn('relative rounded-full w-2 h-2', tone.dot)} />
          </span>
          <div className="min-w-0">
            <CardTitle>NUC Engine</CardTitle>
            <CardDescription>Autonomous Claude worker cluster</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <LiveDataIndicator trigger={lastRefreshed} className="w-8 h-[2px]" />
          <Badge variant={tone.badge} size="xs" dot={state === 'online'}>
            {state.toUpperCase()}
          </Badge>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={manuallyRefreshing}
            aria-label="Refresh NUC status"
            className="w-6 h-6 rounded-md flex items-center justify-center text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3 h-3', manuallyRefreshing && 'animate-spin')} />
          </button>
        </div>
      </CardHeader>
      <CardBody className="pt-3 space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5">{tone.icon}</span>
          <div className={cn('text-sm font-medium leading-snug', tone.label)}>{headline}</div>
        </div>
        {detail && (
          <p className="text-[11px] text-fg-subtle leading-relaxed">{detail}</p>
        )}

        {/* Per-module strip */}
        {coord?.moduleStatus && Object.keys(coord.moduleStatus).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1.5">
            {Object.entries(coord.moduleStatus).map(([name, status]) => (
              <span
                key={name}
                title={`${name}: ${status}`}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-mono border',
                  status === 'ok'
                    ? 'border-data-positive/30 text-data-positive-fg bg-data-positive-bg/50'
                    : status === 'degraded'
                    ? 'border-data-warning/30 text-data-warning-fg bg-data-warning-bg/50'
                    : 'border-data-negative/30 text-data-negative-fg bg-data-negative-bg/50'
                )}
              >
                <Activity className="w-2.5 h-2.5" />
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Worker nodes (if any) */}
        {data && data.nodes.length > 1 && (
          <div className="flex items-center gap-2 pt-1.5 text-[11px] text-fg-subtle">
            <span>{data.nodes.length} node{data.nodes.length === 1 ? '' : 's'}</span>
            <span className="text-fg-muted">·</span>
            <span>{data.nodes.filter(n => !n.isStale && n.status === 'online').length} online</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border text-[11px] text-fg-subtle">
          <span>
            {state === 'loading' ? 'Loading…' : `Checked ${agoStr}`}
          </span>
          <span className="font-mono">auto-refresh 60s</span>
        </div>
      </CardBody>
    </Card>
  )
}
