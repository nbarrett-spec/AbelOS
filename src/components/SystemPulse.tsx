'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// SystemPulse — compact platform health widget for admin dashboards.
//
// Pulls from three existing endpoints:
//   - /api/health/ready      → database + critical env vars
//   - /api/ops/system-alerts → errors, crons, DLQ, AR, inventory
//
// Auto-refreshes every 30s. Click any alert to jump to its detail page.
// Designed to live in the corner of /admin or /ops without stealing focus.
// ──────────────────────────────────────────────────────────────────────────

type HealthStatus = 'ready' | 'not_ready' | 'loading' | 'error'

interface CheckRow {
  name: string
  ok: boolean
  ms?: number
  error?: string
}

interface ReadyPayload {
  status: HealthStatus
  service: string
  timestamp: string
  totalMs: number
  checks: CheckRow[]
}

interface SystemAlert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  count: number
  href: string
  description?: string
}

const severityRank: Record<SystemAlert['type'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
  success: 0,
}

function overallSeverity(alerts: SystemAlert[]): SystemAlert['type'] | 'ok' {
  if (alerts.length === 0) return 'ok'
  return alerts.reduce<SystemAlert['type']>(
    (worst, a) => (severityRank[a.type] > severityRank[worst] ? a.type : worst),
    'success'
  )
}

function dotClass(type: HealthStatus | SystemAlert['type'] | 'ok'): string {
  switch (type) {
    case 'ready':
    case 'ok':
    case 'success':
      return 'bg-green-500'
    case 'info':
      return 'bg-blue-500'
    case 'warning':
      return 'bg-signal'
    case 'critical':
    case 'not_ready':
    case 'error':
      return 'bg-red-500'
    case 'loading':
    default:
      return 'bg-gray-300 animate-pulse'
  }
}

export function SystemPulse() {
  const [ready, setReady] = useState<ReadyPayload | null>(null)
  const [readyStatus, setReadyStatus] = useState<HealthStatus>('loading')
  const [alerts, setAlerts] = useState<SystemAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const [readyResp, alertsResp] = await Promise.all([
        fetch('/api/health/ready'),
        fetch('/api/ops/system-alerts'),
      ])

      if (readyResp.ok) {
        const data: ReadyPayload = await readyResp.json()
        setReady(data)
        setReadyStatus(data.status === 'ready' ? 'ready' : 'not_ready')
      } else {
        setReadyStatus(readyResp.status === 503 ? 'not_ready' : 'error')
      }

      if (alertsResp.ok) {
        const data = await alertsResp.json()
        setAlerts(data.alerts || [])
      }
    } catch {
      setReadyStatus('error')
    } finally {
      setLoading(false)
      setLastRefresh(new Date())
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const severity = overallSeverity(alerts)
  const headlineType: HealthStatus | SystemAlert['type'] | 'ok' =
    readyStatus === 'not_ready' || readyStatus === 'error'
      ? 'critical'
      : readyStatus === 'loading'
      ? 'loading'
      : severity

  const headlineLabel =
    readyStatus === 'loading'
      ? 'Checking…'
      : readyStatus === 'not_ready' || readyStatus === 'error'
      ? 'Platform degraded'
      : severity === 'critical'
      ? 'Incidents active'
      : severity === 'warning'
      ? 'Degraded'
      : severity === 'info'
      ? 'Minor issues'
      : 'All systems normal'

  return (
    <div className="card p-5 border border-gray-200 bg-white">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-3 h-3 rounded-full ${dotClass(headlineType)}`} />
          <div>
            <h2 className="text-base font-semibold text-gray-900">System Pulse</h2>
            <p className="text-xs text-gray-500">
              {headlineLabel}
              {lastRefresh && (
                <>
                  {' · refreshed '}
                  {lastRefresh.toLocaleTimeString()}
                </>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="text-xs text-gray-500 hover:text-gray-900 underline"
        >
          Refresh
        </button>
      </div>

      {/* Readiness checks */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
          Readiness
        </div>
        {loading && !ready ? (
          <div className="text-xs text-gray-400">Loading…</div>
        ) : ready ? (
          <div className="space-y-1.5">
            {ready.checks.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      c.ok ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-gray-700">{c.name}</span>
                </div>
                <div className="text-gray-400 font-mono">
                  {c.ms != null ? `${c.ms}ms` : c.error || 'ok'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-red-600">Readiness probe unreachable</div>
        )}
      </div>

      {/* Alerts */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
          Active Alerts
        </div>
        {loading && alerts.length === 0 ? (
          <div className="text-xs text-gray-400">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="text-xs text-gray-500">Nothing to report — quiet on all fronts.</div>
        ) : (
          <div className="space-y-1.5">
            {alerts.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="flex items-center justify-between text-xs group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass(a.type)}`} />
                  <span className="text-gray-700 truncate group-hover:text-gray-900">
                    {a.title}
                  </span>
                </div>
                <span
                  className={`font-bold font-mono ml-2 ${
                    a.type === 'critical'
                      ? 'text-red-600'
                      : a.type === 'warning'
                      ? 'text-signal'
                      : 'text-blue-600'
                  }`}
                >
                  {a.count}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
