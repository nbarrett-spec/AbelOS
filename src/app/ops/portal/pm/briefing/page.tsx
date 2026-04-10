'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BriefingData {
  date: string
  summary: {
    totalActive: number
    inProduction: number
    inTransit: number
    installing: number
    todaysDeliveries: number
    todaysInstallations: number
    atRiskCount: number
    overdueTasks: number
    readyToAdvance: number
  }
  todaysDeliveries: any[]
  todaysInstallations: any[]
  atRiskJobs: any[]
  overdueTasks: any[]
  approachingDelivery: any[]
  recentNotes: any[]
  readyToAdvance: any[]
}

const STATUS_LABELS: Record<string, string> = {
  CREATED: 'New', READINESS_CHECK: 'T-72 Check', MATERIALS_LOCKED: 'T-48 Lock',
  IN_PRODUCTION: 'Production', STAGED: 'Staged', LOADED: 'Loaded',
  IN_TRANSIT: 'In Transit', DELIVERED: 'Delivered', INSTALLING: 'Installing',
  PUNCH_LIST: 'Punch List', COMPLETE: 'Complete',
}

const formatTime = (t: string | null) => t || 'TBD'
const formatDate = (d: string | null) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function PMBriefingPage() {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/pm-briefing')
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch PM briefing:', err)
        setError('Failed to load briefing data. Please try refreshing.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p>{error}</p>
          <button onClick={() => { setError(null); window.location.reload() }} className="text-red-900 underline text-sm mt-1">
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data || !data.summary) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p className="text-4xl mb-3">☕</p>
        <p className="text-lg font-medium">No briefing data available</p>
        <p className="text-sm mt-1">Make sure you have jobs assigned to your account.</p>
      </div>
    )
  }

  const s = data.summary
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting} — Today's Briefing</h1>
          <p className="text-sm text-gray-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <Link href="/ops/portal/pm" className="text-sm text-[#1B4F72] hover:underline">← Back to Dashboard</Link>
      </div>

      {/* Quick KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: 'Active Jobs', value: s.totalActive, color: '#1B4F72' },
          { label: "Today's Deliveries", value: s.todaysDeliveries, color: '#E67E22' },
          { label: "Today's Installs", value: s.todaysInstallations, color: '#27AE60' },
          { label: 'At Risk', value: s.atRiskCount, color: s.atRiskCount > 0 ? '#E74C3C' : '#95A5A6' },
          { label: 'Overdue Tasks', value: s.overdueTasks, color: s.overdueTasks > 0 ? '#E74C3C' : '#95A5A6' },
          { label: 'Ready to Advance', value: s.readyToAdvance, color: '#27AE60' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-3xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
            <p className="text-xs text-gray-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Priority Alerts */}
      {(s.overdueTasks > 0 || s.atRiskCount > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-red-800 mb-2">Needs Attention</h2>
          <div className="space-y-1 text-sm text-red-700">
            {s.overdueTasks > 0 && <p>• {s.overdueTasks} overdue task{s.overdueTasks !== 1 ? 's' : ''} need follow-up</p>}
            {s.atRiskCount > 0 && <p>• {s.atRiskCount} job{s.atRiskCount !== 1 ? 's' : ''} flagged at-risk (stalled activity)</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Deliveries */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">🚚</span> Today's Deliveries ({data.todaysDeliveries.length})
          </h2>
          {data.todaysDeliveries.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No deliveries today</p>
          ) : (
            <div className="space-y-2">
              {data.todaysDeliveries.map((d: any) => (
                <Link key={d.id} href={`/ops/jobs/${d.jobId}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-blue-50 transition">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{d.jobNumber}</span>
                    <span className="text-xs text-gray-500">{formatTime(d.scheduledTime)}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{d.builderName} — {d.jobAddress || d.community || '—'}</p>
                  {d.crewName && <p className="text-xs text-[#1B4F72] mt-1">Crew: {d.crewName}</p>}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Today's Installations */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">🔨</span> Today's Installations ({data.todaysInstallations.length})
          </h2>
          {data.todaysInstallations.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No installations today</p>
          ) : (
            <div className="space-y-2">
              {data.todaysInstallations.map((i: any) => (
                <Link key={i.id} href={`/ops/jobs/${i.jobId}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-blue-50 transition">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{i.installNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${i.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{i.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{i.builderName} — {i.jobAddress || '—'}</p>
                  {i.crewName && <p className="text-xs text-[#1B4F72] mt-1">Crew: {i.crewName}</p>}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Approaching Delivery (next 3 days) */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">📅</span> Approaching Delivery (72h)
          </h2>
          {data.approachingDelivery.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No jobs delivering in the next 3 days</p>
          ) : (
            <div className="space-y-2">
              {data.approachingDelivery.map((j: any) => (
                <Link key={j.id} href={`/ops/jobs/${j.id}`} className="block p-3 rounded-lg border hover:border-[#E67E22] transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{j.jobNumber}</span>
                    <span className="text-xs text-gray-500">{formatDate(j.scheduledDate)}</span>
                  </div>
                  <p className="text-xs text-gray-600">{j.builderName} — {j.community || j.jobAddress || '—'}</p>
                  <div className="flex gap-2 mt-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${j.readinessCheck ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      T-72 {j.readinessCheck ? '✓' : '✗'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${j.materialsLocked ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      T-48 {j.materialsLocked ? '✓' : '✗'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${j.loadConfirmed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      T-24 {j.loadConfirmed ? '✓' : '✗'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Ready to Advance */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">⏩</span> Ready to Advance ({data.readyToAdvance.length})
          </h2>
          {data.readyToAdvance.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No jobs ready to advance</p>
          ) : (
            <div className="space-y-2">
              {data.readyToAdvance.map((j: any) => (
                <Link key={j.id} href={`/ops/jobs/${j.id}`} className="block p-3 bg-green-50 rounded-lg hover:bg-green-100 transition">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{j.jobNumber}</span>
                    <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded">{STATUS_LABELS[j.status] || j.status} →</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{j.builderName}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* At-Risk Jobs */}
        {data.atRiskJobs.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <span className="text-lg">⚠️</span> At-Risk Jobs
            </h2>
            <div className="space-y-2">
              {data.atRiskJobs.map((j: any) => (
                <Link key={j.id} href={`/ops/jobs/${j.id}`} className="block p-3 bg-red-50 rounded-lg hover:bg-red-100 transition">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{j.jobNumber}</span>
                    <span className="text-xs text-red-600">{j.daysSinceUpdate}d since update</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{j.builderName} — {STATUS_LABELS[j.status] || j.status}</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Overdue Tasks */}
        {data.overdueTasks.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <span className="text-lg">🔴</span> Overdue Tasks
            </h2>
            <div className="space-y-2">
              {data.overdueTasks.map((t: any) => (
                <Link key={t.id} href={`/ops/jobs/${t.jobId}`} className="block p-3 bg-orange-50 rounded-lg hover:bg-orange-100 transition">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{t.title}</span>
                    <span className={`text-xs ${t.priority === 'HIGH' ? 'text-red-600 font-bold' : 'text-orange-600'}`}>{t.priority}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{t.jobNumber} — {t.builderName}</p>
                  <p className="text-xs text-red-500 mt-1">Due: {formatDate(t.dueDate)}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent Decision Notes */}
      {data.recentNotes.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">📝</span> Recent Decision Notes (48h)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.recentNotes.map((n: any) => (
              <Link key={n.id} href={`/ops/jobs/${n.jobId}`} className="block p-3 bg-yellow-50 border border-yellow-200 rounded-lg hover:border-yellow-400 transition">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900">{n.jobNumber}</span>
                  <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs text-gray-700 line-clamp-2">{n.content}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
