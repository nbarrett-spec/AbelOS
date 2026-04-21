'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface PortalData {
  summary: {
    takeoffsAwaitingReview: number
    quotesInDraft: number
    quotesExpiringSoon: number
    newRequestsToday: number
  }
  takeoffsToReview: any[]
  quotesInDraft: any[]
  quotesExpiring: any[]
  newRequests: any[]
  recentActivity: any[]
}

export default function EstimatorPortalPage() {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/estimator-briefing')
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch estimator data:', err)
        setError('Failed to load data. Please try refreshing.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin" />
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

  const s = data?.summary || {
    takeoffsAwaitingReview: 0,
    quotesInDraft: 0,
    quotesExpiringSoon: 0,
    newRequestsToday: 0,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Estimator Portal</h1>
          <p className="text-gray-600 mt-1">Takeoffs, quotes, and estimates</p>
        </div>
        <div className="flex gap-2">
          <Link href="/ops/portal/estimator/briefing" className="px-4 py-2 bg-[#16A085] text-white rounded-lg hover:bg-[#138D75] transition-colors text-sm font-medium">
            📋 Morning Briefing
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { icon: '📋', label: 'Morning Briefing', href: '/ops/portal/estimator/briefing', color: '#16A085' },
          { icon: '📐', label: 'Review Takeoffs', href: '/ops/takeoffs', color: '#3498DB' },
          { icon: '📄', label: 'Create Quote', href: '/ops/quotes', color: '#27AE60' },
          { icon: '💰', label: 'Pricing Engine', href: '/ops/pricing', color: '#D4B96A' },
          { icon: '📊', label: 'Floor Plans', href: '/ops/plans', color: '#9B59B6' },
          { icon: '📸', label: 'Blueprint Analysis', href: '/ops/blueprints', color: '#E74C3C' },
        ].map(action => (
          <Link
            key={action.label}
            href={action.href}
            className="block p-4 bg-white rounded-xl border hover:border-[#16A085] transition-all text-center"
          >
            <div className="text-2xl mb-2">{action.icon}</div>
            <p className="text-sm font-medium text-gray-900">{action.label}</p>
          </Link>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Takeoffs to Review', value: s.takeoffsAwaitingReview, color: '#16A085' },
          { label: 'Quotes in Draft', value: s.quotesInDraft, color: '#3498DB' },
          { label: 'Expiring Soon', value: s.quotesExpiringSoon, color: s.quotesExpiringSoon > 0 ? '#E74C3C' : '#95A5A6' },
          { label: 'New Requests Today', value: s.newRequestsToday, color: '#27AE60' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-3xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
            <p className="text-xs text-gray-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Takeoffs Awaiting Review */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Takeoffs Awaiting Review</h2>
            <Link href="/ops/takeoffs" className="text-sm text-[#16A085] hover:text-[#138D75]">
              View All →
            </Link>
          </div>

          {!data || data.takeoffsToReview.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">📋</p>
              <p>No takeoffs to review</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.takeoffsToReview.slice(0, 6).map((t: any) => (
                <Link
                  key={t.id}
                  href={`/ops/takeoffs/${t.id}`}
                  className="block p-3 rounded-lg border hover:border-[#16A085] transition-all"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="font-semibold text-gray-900 text-sm">{t.projectName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium text-white ${
                      t.confidenceScore >= 85 ? 'bg-green-500' : t.confidenceScore >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}>
                      {t.confidenceScore}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{t.builderName} • {t.planName}</p>
                  <p className="text-xs text-gray-500 mt-1">{t.itemCount} items</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quotes Expiring */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Quotes Expiring Soon</h2>
            <Link href="/ops/quotes" className="text-sm text-[#16A085] hover:text-[#138D75]">
              View All →
            </Link>
          </div>

          {!data || data.quotesExpiring.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">✅</p>
              <p>No quotes expiring soon</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.quotesExpiring.slice(0, 6).map((q: any) => (
                <Link
                  key={q.id}
                  href={`/ops/quotes/${q.id}`}
                  className="block p-3 rounded-lg border border-orange-200 bg-orange-50 hover:border-[#16A085] transition-all"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="font-semibold text-gray-900 text-sm">{q.quoteNumber}</span>
                    <span className="text-xs text-orange-600 font-medium">
                      Expires {new Date(q.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{q.builderName}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-2">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(q.total)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Requests Today */}
      {data && data.newRequests.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">New Requests Today</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.newRequests.map((req: any) => (
              <Link
                key={req.id}
                href={`/ops/projects/${req.id}`}
                className="block p-4 rounded-lg border border-blue-200 bg-blue-50 hover:border-[#16A085] transition-all"
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="font-semibold text-gray-900">{req.projectName}</span>
                  <span className="text-xs text-blue-600">Today</span>
                </div>
                <p className="text-sm text-gray-600">{req.builderName}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {new Date(req.requestedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Workload Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-[#16A085] to-[#117A65] rounded-xl p-6 text-white">
          <p className="text-sm opacity-90">In Progress</p>
          <p className="text-3xl font-bold mt-2">{s.takeoffsAwaitingReview + s.quotesInDraft}</p>
          <p className="text-xs mt-1 opacity-75">Active items</p>
        </div>
        <div className="bg-gradient-to-br from-[#D4B96A] to-[#D68910] rounded-xl p-6 text-white">
          <p className="text-sm opacity-90">Time Sensitive</p>
          <p className="text-3xl font-bold mt-2">{s.quotesExpiringSoon}</p>
          <p className="text-xs mt-1 opacity-75">Expiring this week</p>
        </div>
        <div className="bg-gradient-to-br from-[#27AE60] to-[#1E8449] rounded-xl p-6 text-white">
          <p className="text-sm opacity-90">Today's Activity</p>
          <p className="text-3xl font-bold mt-2">{s.newRequestsToday}</p>
          <p className="text-xs mt-1 opacity-75">New requests</p>
        </div>
      </div>
    </div>
  )
}
