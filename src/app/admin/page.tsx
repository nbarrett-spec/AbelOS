'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SystemPulse } from '@/components/SystemPulse'

interface Stats {
  totalBuilders: number
  totalProducts: number
  totalProjects: number
  totalQuotes: number
  totalRevenue: number
}

interface Quote {
  id: string
  quoteNumber: string
  builderName: string
  total: number
  status: string
  createdAt: string
}

// ── Ops status grid types ─────────────────────────────────────────────────
interface SloResult {
  id: string
  name: string
  status: 'healthy' | 'warning' | 'critical' | 'no_data'
  currentValue: number | null
  budgetRemainingPct: number
  burnRate: number | null
  unit: string
  target: number
}

interface AlertIncidentRow {
  id: string
  alertId: string
  title: string
  peakSeverity: string
  endedAt: string | null
  durationSeconds: number | null
  escalationCount: number
}

interface CronEntry {
  name: string
  status: string
  lastRun: string | null
}

type TileStatus = 'green' | 'yellow' | 'red' | 'gray'

// ── Ops status helpers ─────────────────────────────────────────────────────

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`
  return `${Math.round(ms / 86400_000)}d ago`
}

const TILE_COLORS: Record<TileStatus, string> = {
  green: 'bg-green-100 border-green-300 text-green-800',
  yellow: 'bg-amber-100 border-amber-300 text-amber-800',
  red: 'bg-rose-100 border-rose-300 text-rose-800',
  gray: 'bg-gray-100 border-gray-300 text-gray-500',
}

const TILE_DOTS: Record<TileStatus, string> = {
  green: 'bg-green-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-gray-400',
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Ops grid state
  const [slos, setSlos] = useState<SloResult[]>([])
  const [incidents, setIncidents] = useState<AlertIncidentRow[]>([])
  const [crons, setCrons] = useState<CronEntry[]>([])
  const [opsLoading, setOpsLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/admin/stats')
        if (!res.ok) throw new Error('Failed to fetch stats')
        const data = await res.json()
        setStats(data.stats)
        setRecentQuotes(data.recentQuotes)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching stats')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  const loadOps = useCallback(async () => {
    try {
      const [sloRes, alertRes, cronRes] = await Promise.all([
        fetch('/api/admin/slo', { credentials: 'same-origin' }).catch(() => null),
        fetch('/api/admin/alert-history?since=24', { credentials: 'same-origin' }).catch(() => null),
        fetch('/api/admin/crons', { credentials: 'same-origin' }).catch(() => null),
      ])
      if (sloRes?.ok) {
        const d = await sloRes.json()
        setSlos(d.slos || [])
      }
      if (alertRes?.ok) {
        const d = await alertRes.json()
        setIncidents(d.incidents || [])
      }
      if (cronRes?.ok) {
        const d = await cronRes.json()
        setCrons(d.crons || d.jobs || [])
      }
    } catch {
      // swallow — ops grid is secondary info
    } finally {
      setOpsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOps()
    const id = setInterval(loadOps, 30_000)
    return () => clearInterval(id)
  }, [loadOps])

  const statCards = [
    {
      label: 'Total Builders',
      value: stats?.totalBuilders || 0,
      color: 'bg-blue-50 border-blue-200',
      textColor: 'text-blue-900',
    },
    {
      label: 'Active Projects',
      value: stats?.totalProjects || 0,
      color: 'bg-green-50 border-green-200',
      textColor: 'text-green-900',
    },
    {
      label: 'Quotes Generated',
      value: stats?.totalQuotes || 0,
      color: 'bg-purple-50 border-purple-200',
      textColor: 'text-purple-900',
    },
    {
      label: 'Total Revenue',
      value: formatCurrency(stats?.totalRevenue || 0),
      color: 'bg-amber-50 border-amber-200',
      textColor: 'text-amber-900',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-2">Overview of your Abel platform metrics</p>
      </div>

      {/* Stats + Health */}
      {loading ? (
        <div className="text-sm text-gray-400 animate-pulse py-4">Loading business metrics…</div>
      ) : error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          Stats unavailable: {error}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              {statCards.map((stat, idx) => (
                <div
                  key={idx}
                  className={`card p-6 border ${stat.color}`}
                >
                  <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                  <p className={`text-3xl font-bold mt-2 ${stat.textColor}`}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="lg:col-span-1">
              <SystemPulse />
            </div>
          </div>

          {/* Recent Quotes Table */}
          <div className="card p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Quotes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr className="text-gray-600 font-semibold">
                    <th className="text-left py-3 px-4">Quote #</th>
                    <th className="text-left py-3 px-4">Builder</th>
                    <th className="text-left py-3 px-4">Total</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuotes.length > 0 ? (
                    recentQuotes.map((quote) => (
                      <tr
                        key={quote.id}
                        className="border-b border-gray-100 hover:bg-gray-50 transition"
                      >
                        <td className="py-3 px-4 font-medium text-abel-navy">
                          {quote.quoteNumber}
                        </td>
                        <td className="py-3 px-4">{quote.builderName}</td>
                        <td className="py-3 px-4 font-semibold">
                          {formatCurrency(quote.total)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                              quote.status === 'APPROVED'
                                ? 'bg-green-100 text-green-800'
                                : quote.status === 'SENT'
                                ? 'bg-blue-100 text-blue-800'
                                : quote.status === 'DRAFT'
                                ? 'bg-gray-100 text-gray-800'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {quote.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-600">
                          {formatDate(quote.createdAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">
                        No quotes yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Ops Status Grid ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Ops Overview</h2>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/health"
              className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
            >
              Full health →
            </Link>
            <Link
              href="/admin/slo"
              className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
            >
              SLO details →
            </Link>
          </div>
        </div>

        {opsLoading ? (
          <div className="text-sm text-gray-400 animate-pulse">
            Loading ops data…
          </div>
        ) : (
          <>
            {/* SLO tiles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {slos.length > 0 ? (
                slos.map((slo) => {
                  const tileStatus: TileStatus =
                    slo.status === 'critical'
                      ? 'red'
                      : slo.status === 'warning'
                        ? 'yellow'
                        : slo.status === 'healthy'
                          ? 'green'
                          : 'gray'
                  return (
                    <Link
                      key={slo.id}
                      href="/admin/slo"
                      className={`block border-2 rounded-xl p-4 transition-colors hover:opacity-90 ${TILE_COLORS[tileStatus]}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${TILE_DOTS[tileStatus]} ${tileStatus === 'red' ? 'animate-pulse' : ''}`}
                        />
                        <span className="font-bold text-sm">{slo.name}</span>
                      </div>
                      <div className="text-xs opacity-80">
                        {slo.status === 'no_data'
                          ? 'Awaiting data'
                          : `${slo.budgetRemainingPct.toFixed(0)}% budget · ${slo.burnRate != null ? `${slo.burnRate}× burn` : '—'}`}
                      </div>
                    </Link>
                  )
                })
              ) : (
                <div className="col-span-3 text-sm text-gray-400">
                  No SLO data available yet.
                </div>
              )}
            </div>

            {/* Active incidents strip */}
            {(() => {
              const open = incidents.filter((i) => !i.endedAt)
              if (open.length === 0) return (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
                  No active incidents — all clear.
                </div>
              )
              return (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Active Incidents ({open.length})
                  </h3>
                  <div className="space-y-2">
                    {open.slice(0, 5).map((inc) => {
                      const isCritical = inc.peakSeverity === 'critical'
                      return (
                        <Link
                          key={inc.id}
                          href="/admin/alert-history"
                          className={`block p-3 rounded-lg border-2 transition-colors hover:opacity-90 ${
                            isCritical
                              ? 'bg-rose-50 border-rose-300 text-rose-800'
                              : 'bg-amber-50 border-amber-300 text-amber-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full animate-pulse ${isCritical ? 'bg-rose-500' : 'bg-amber-500'}`} />
                              <span className="text-sm font-semibold">
                                {inc.title}
                              </span>
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border bg-white/50">
                                {inc.peakSeverity}
                              </span>
                              {inc.escalationCount > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-orange-100 text-orange-700 border-orange-300">
                                  ESCALATED ×{inc.escalationCount}
                                </span>
                              )}
                            </div>
                            <span className="text-xs opacity-70">
                              {fmtDuration(inc.durationSeconds)}
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                    {open.length > 5 && (
                      <Link
                        href="/admin/alert-history"
                        className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
                      >
                        +{open.length - 5} more →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Crons summary */}
            {crons.length > 0 && (() => {
              const failed = crons.filter(
                (c) => c.status === 'FAILURE'
              )
              const tileStatus: TileStatus =
                failed.length === 0 ? 'green' : failed.length >= 3 ? 'red' : 'yellow'
              return (
                <Link
                  href="/admin/crons"
                  className={`block border-2 rounded-xl p-4 transition-colors hover:opacity-90 ${TILE_COLORS[tileStatus]}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${TILE_DOTS[tileStatus]} ${tileStatus === 'red' ? 'animate-pulse' : ''}`}
                    />
                    <span className="font-bold text-sm">Cron Jobs</span>
                  </div>
                  <div className="text-xs opacity-80">
                    {failed.length === 0
                      ? `${crons.length} jobs tracked — all passing`
                      : `${failed.length} failed of ${crons.length} jobs`}
                  </div>
                </Link>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
