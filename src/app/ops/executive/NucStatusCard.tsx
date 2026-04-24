'use client'

// ──────────────────────────────────────────────────────────────────────────
// NucStatusCard — Monday-morning glance for the NUC brain engine.
//
// Calls /api/integrations/nuc/health (Wave 2) on mount + every 60s.
// That endpoint always returns HTTP 200 (by design) — so we key off the
// `ok` field in the body, not the status code. When Aegis is running on
// Vercel the Tailscale IP 100.84.113.47 isn't routable and `ok` will be
// false with error=NUC_UNREACHABLE; we render that as RED with Tailscale
// context rather than a scary "app is broken" error. On Nate's local
// browser (which has Tailscale) it renders GREEN with latency + engine
// version. The `note` field in the response explains how to enable via
// Cloudflare Tunnel when reachable from Vercel becomes a priority.
//
// Auto-refresh: 60s interval, paused when the tab is hidden to avoid
// pointless fetches. Manual refresh via the small refresh glyph.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, CardDescription, Badge } from '@/components/ui'
import { cn } from '@/lib/utils'

type NucState = 'loading' | 'online' | 'degraded' | 'offline'

interface HealthResponse {
  ok: boolean
  latencyMs?: number | null
  engineVersion?: string
  moduleStatus?: Record<string, 'ok' | 'degraded' | 'error'>
  error?: string
  detail?: string
  checkedAt?: string
  note?: string
}

const POLL_MS = 60_000

function classify(data: HealthResponse | null, fetchError: string | null): NucState {
  if (fetchError) return 'offline'
  if (!data) return 'loading'
  if (!data.ok) return 'offline'
  // Any module in error = degraded; otherwise online.
  const modules = Object.values(data.moduleStatus ?? {})
  if (modules.some((s) => s === 'error')) return 'offline'
  if (modules.some((s) => s === 'degraded')) return 'degraded'
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

export default function NucStatusCard({ className }: { className?: string }) {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
  const [manuallyRefreshing, setManuallyRefreshing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (isManual = false) => {
    if (isManual) setManuallyRefreshing(true)
    try {
      const res = await fetch('/api/integrations/nuc/health', { cache: 'no-store' })
      // Route always returns 200 (by design). A non-200 here means network/auth,
      // not NUC offline — surface as fetch error.
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const body: HealthResponse = await res.json()
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
    // Initial fetch + 60s poll, paused when tab hidden.
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
        // Immediate refresh on return; resume polling.
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
  const moduleCount = data?.moduleStatus ? Object.keys(data.moduleStatus).length : null
  const latency = data?.latencyMs ?? null

  // Human-friendly "seconds ago" — recomputed on render so it stays fresh
  // within the card's re-render cadence. A separate ticker isn't worth the
  // extra re-renders for this secondary metric.
  const agoStr = (() => {
    if (!lastRefreshed) return ''
    const sec = Math.max(0, Math.floor((Date.now() - lastRefreshed) / 1000))
    if (sec < 5) return 'just now'
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    return `${min}m ago`
  })()

  // Headline text for each state — executive glance, one phrase.
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
      detail = data?.engineVersion ? `v${data.engineVersion}` : null
      break
    case 'degraded':
      headline = 'Engine degraded — some modules unhealthy'
      detail = data?.detail ?? null
      break
    case 'offline':
      if (fetchError) {
        headline = 'Health check failed'
        detail = fetchError
      } else if (data?.error === 'NUC_UNREACHABLE' || data?.error === 'NUC_OFFLINE') {
        headline = 'Offline — NUC unreachable from this environment'
        detail = 'Tailscale-only IP (100.84.113.47) is not routable here. Configure NUC_BRAIN_URL to a Cloudflare Tunnel to enable on Vercel.'
      } else {
        headline = 'Offline'
        detail = data?.detail ?? data?.error ?? 'NUC brain engine not responding.'
      }
      break
  }

  return (
    <Card variant="default" padding="none" className={cn('relative', className)}>
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

        {/* Per-module strip — only when we have moduleStatus data */}
        {data?.moduleStatus && Object.keys(data.moduleStatus).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1.5">
            {Object.entries(data.moduleStatus).map(([name, status]) => (
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
