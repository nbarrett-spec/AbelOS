'use client'

import { useEffect, useState, useCallback } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// /admin/slo — Service Level Objective dashboard.
//
// Shows each SLO as a card with a budget gauge, burn rate, and current
// measured value. Polls every 60s — SLO budgets don't swing on a 10s
// timescale so a slower cadence is fine and keeps the load down.
//
// Colour scheme:
//   healthy  → green (budget >= 50%)
//   warning  → amber (budget 20–50%, burning faster than sustainable)
//   critical → red   (budget < 20%, on track to blow the SLO)
//   no_data  → gray  (not enough data points to compute)
// ──────────────────────────────────────────────────────────────────────────

type SloStatus = 'healthy' | 'warning' | 'critical' | 'no_data'

interface SloResult {
  id: string
  name: string
  description: string
  target: number
  unit: string
  windowDays: number
  status: SloStatus
  currentValue: number | null
  budgetTotal: number
  budgetUsed: number
  budgetRemainingPct: number
  burnRate: number | null
  dataPoints: number
  computedAt: string
}

interface SloPayload {
  slos: SloResult[]
  meta: {
    computedAt: string
    total: number
    healthy: number
    warning: number
    critical: number
    noData: number
  }
}

const POLL_INTERVAL_MS = 60_000

const STATUS_COLORS: Record<
  SloStatus,
  { bg: string; border: string; text: string; badge: string; gaugeFill: string }
> = {
  healthy: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    badge: 'bg-green-100 text-green-700 border-green-300',
    gaugeFill: 'bg-green-500',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    badge: 'bg-amber-100 text-amber-700 border-amber-300',
    gaugeFill: 'bg-signal',
  },
  critical: {
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    text: 'text-rose-800',
    badge: 'bg-rose-100 text-rose-700 border-rose-300',
    gaugeFill: 'bg-rose-500',
  },
  no_data: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-500',
    badge: 'bg-gray-100 text-gray-500 border-gray-300',
    gaugeFill: 'bg-gray-300',
  },
}

function formatTarget(slo: SloResult): string {
  if (slo.unit === '%') return `${(slo.target * 100).toFixed(1)}%`
  return `≤ ${slo.target} ${slo.unit}`
}

function formatCurrent(slo: SloResult): string {
  if (slo.currentValue == null) return '—'
  if (slo.unit === '%') return `${slo.currentValue}%`
  return `${slo.currentValue} ${slo.unit}`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function SloPage() {
  const [data, setData] = useState<SloPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/slo', { credentials: 'same-origin' })
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      const payload = (await res.json()) as SloPayload
      setData(payload)
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Service Level Objectives
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Error budgets over a rolling {data?.slos?.[0]?.windowDays ?? 30}-day
            window.
            {data?.meta?.computedAt && (
              <span className="ml-1">
                · computed {fmtTime(data.meta.computedAt)}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm bg-rose-50 text-rose-700 border border-rose-200 rounded-lg">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-gray-400 animate-pulse">
          Computing SLOs…
        </div>
      )}

      {/* Summary bar */}
      {data && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {(
            [
              ['healthy', data.meta.healthy, 'Healthy', 'bg-green-100 text-green-700'],
              ['warning', data.meta.warning, 'Warning', 'bg-amber-100 text-amber-700'],
              ['critical', data.meta.critical, 'Critical', 'bg-rose-100 text-rose-700'],
              ['no_data', data.meta.noData, 'No Data', 'bg-gray-100 text-gray-500'],
            ] as const
          ).map(([key, count, label, cls]) => (
            <div
              key={key}
              className={`text-center py-3 rounded-lg font-semibold text-sm ${cls}`}
            >
              {count} {label}
            </div>
          ))}
        </div>
      )}

      {/* SLO cards */}
      {data && (
        <div className="grid gap-4">
          {data.slos.map((slo) => {
            const c = STATUS_COLORS[slo.status]
            return (
              <div
                key={slo.id}
                className={`rounded-xl border-2 ${c.border} ${c.bg} p-5 transition-colors`}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-gray-900">
                        {slo.name}
                      </h2>
                      <span
                        className={`inline-flex px-2 py-0.5 text-[11px] font-bold uppercase rounded border ${c.badge}`}
                      >
                        {slo.status === 'no_data' ? 'NO DATA' : slo.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">
                      {slo.description}
                    </p>
                  </div>
                </div>

                {/* Budget gauge */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className={c.text}>
                      Budget remaining: {slo.budgetRemainingPct.toFixed(1)}%
                    </span>
                    <span className="text-gray-500">
                      {slo.budgetUsed} / {slo.budgetTotal} used
                    </span>
                  </div>
                  <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${c.gaugeFill}`}
                      style={{
                        width: `${Math.min(100, Math.max(0, slo.budgetRemainingPct))}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Metrics row */}
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500 font-medium">
                      Current
                    </div>
                    <div className="font-semibold text-gray-900">
                      {formatCurrent(slo)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-medium">
                      Target
                    </div>
                    <div className="font-semibold text-gray-900">
                      {formatTarget(slo)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-medium">
                      Burn Rate
                    </div>
                    <div className="font-semibold text-gray-900">
                      {slo.burnRate != null ? (
                        <span
                          className={
                            slo.burnRate > 1
                              ? 'text-rose-600'
                              : slo.burnRate > 0.7
                                ? 'text-signal'
                                : 'text-green-600'
                          }
                        >
                          {slo.burnRate}×
                        </span>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-medium">
                      Data Points
                    </div>
                    <div className="font-semibold text-gray-900">
                      {slo.dataPoints.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Help text */}
      <div className="mt-6 p-4 bg-white border border-gray-200 rounded-lg text-xs text-gray-500">
        <strong className="text-gray-700">How budget alerts work:</strong> When
        an SLO's error budget drops below 50%, a <em>warning</em> alert fires in
        the system-alerts pipeline. Below 20%, it escalates to{' '}
        <em>critical</em>, which triggers email notifications and the escalation
        sequence. The <strong>burn rate</strong> shows how fast the budget is
        being consumed relative to the sustainable rate (1× = exactly on pace;
        {'>'} 1× = burning faster than the window allows).
      </div>
    </div>
  )
}
