'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Activity } from 'lucide-react'

interface HealthState {
  status: 'green' | 'amber' | 'red' | 'unknown'
  uptime?: number
  version?: string
  timestamp?: string
  latencyMs?: number
}

/**
 * HealthChip — polls /api/health every 60s. Click pops open a small tray
 * showing uptime, version, and most-recent latency.
 */
export default function HealthChip({ className }: { className?: string }) {
  const [state, setState] = useState<HealthState>({ status: 'unknown' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const started = Date.now()
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        const latencyMs = Date.now() - started
        if (!res.ok) {
          if (!cancelled) setState({ status: 'red', latencyMs })
          return
        }
        const data = await res.json()
        const status: HealthState['status'] = latencyMs > 1500 ? 'amber' : 'green'
        if (!cancelled) {
          setState({
            status,
            latencyMs,
            uptime: data.uptime,
            timestamp: data.timestamp,
            version:
              typeof process !== 'undefined'
                ? process.env.NEXT_PUBLIC_DEPLOY_TAG || undefined
                : undefined,
          })
        }
      } catch {
        if (!cancelled) setState({ status: 'red' })
      }
    }

    check()
    const id = setInterval(check, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const color = {
    green: 'bg-data-positive',
    amber: 'bg-data-warning',
    red: 'bg-data-negative',
    unknown: 'bg-fg-subtle',
  }[state.status]

  const label = {
    green: 'healthy',
    amber: 'degraded',
    red: 'unreachable',
    unknown: 'checking…',
  }[state.status]

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-fg transition-colors"
        title={`Server ${label}`}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', color, state.status === 'green' && 'animate-pulse-soft')} />
        <span>{label}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-60 rounded-lg border border-border bg-surface shadow-elevation-4 p-3 z-[70] text-[11px]">
          <div className="flex items-center gap-1.5 mb-2 text-fg">
            <Activity className="w-3 h-3" />
            <span className="font-semibold">Server health</span>
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-fg-muted">
            <dt>Status</dt>
            <dd className="text-fg capitalize">{label}</dd>
            <dt>Latency</dt>
            <dd className="tabular-nums text-fg">{state.latencyMs ?? '—'} ms</dd>
            <dt>Uptime</dt>
            <dd className="tabular-nums text-fg">
              {state.uptime ? formatUptime(state.uptime) : '—'}
            </dd>
            {state.version && (
              <>
                <dt>Build</dt>
                <dd className="font-mono text-fg">{state.version}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  )
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
