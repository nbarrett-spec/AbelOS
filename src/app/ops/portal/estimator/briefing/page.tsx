'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BriefingData {
  date: string
  summary: {
    takeoffsAwaitingReview: number
    quotesInDraft: number
    quotesExpiringSoon: number
    pricingUpdates: number
    newRequestsToday: number
    avgConfidenceScore: number
  }
  takeoffsToReview: any[]
  quotesInDraft: any[]
  quotesExpiring: any[]
  newRequests: any[]
  recentCompletions: any[]
  lowConfidenceTakeoffs: any[]
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

const formatDate = (d: string) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function EstimatorBriefingPage() {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/estimator-briefing')
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch estimator briefing:', err)
        setError('Failed to load briefing data. Please try refreshing.')
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

  if (!data || !data.summary) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p className="text-4xl mb-3">📋</p>
        <p className="text-lg font-medium">No briefing data available</p>
        <p className="text-sm mt-1">Check your access permissions.</p>
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
          <h1 className="text-2xl font-bold text-gray-900">{greeting} — Estimator Briefing</h1>
          <p className="text-sm text-gray-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <Link href="/ops/portal/estimator" className="text-sm text-[#16A085] hover:underline">← Back to Dashboard</Link>
      </div>

      {/* Priority Alert: Low Confidence Takeoffs */}
      {data.lowConfidenceTakeoffs && data.lowConfidenceTakeoffs.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-yellow-800 mb-2 flex items-center gap-2">
            <span>⚠️</span> Low Confidence Takeoffs
          </h2>
          <p className="text-xs text-yellow-700 mb-3">
            {data.lowConfidenceTakeoffs.length} takeoff{data.lowConfidenceTakeoffs.length !== 1 ? 's' : ''} below 85% confidence require review
          </p>
          <div className="flex flex-wrap gap-2">
            {data.lowConfidenceTakeoffs.slice(0, 4).map((t: any) => (
              <Link
                key={t.id}
                href={`/ops/takeoff-review/${t.id}`}
                className="text-xs px-2 py-1 bg-yellow-200 text-yellow-800 rounded hover:bg-yellow-300 transition"
              >
                {t.projectName} ({t.confidenceScore}%)
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Takeoffs to Review', value: s.takeoffsAwaitingReview, color: '#16A085' },
          { label: 'Quotes in Draft', value: s.quotesInDraft, color: '#3498DB' },
          { label: 'Expiring Soon', value: s.quotesExpiringSoon, color: s.quotesExpiringSoon > 0 ? '#E74C3C' : '#95A5A6' },
          { label: 'New Requests', value: s.newRequestsToday, color: '#27AE60' },
          { label: 'Avg Confidence', value: `${s.avgConfidenceScore}%`, color: '#D4B96A', isPercent: true },
          { label: 'Completed (7d)', value: data.recentCompletions?.length || 0, color: '#9B59B6' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-2xl font-bold" style={{ color: kpi.color }}>
              {kpi.value}
            </p>
            <p className="text-xs text-gray-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Two columns: Takeoffs to Review | Quotes Expiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Takeoffs Awaiting Review */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">📐</span> Takeoffs Awaiting Review ({data.takeoffsToReview.length})
          </h2>
          {data.takeoffsToReview.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No takeoffs to review</p>
          ) : (
            <div className="space-y-2">
              {data.takeoffsToReview.slice(0, 8).map((t: any) => (
                <Link key={t.id} href={`/ops/takeoff-review/${t.id}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-teal-50 transition border border-gray-200 hover:border-[#16A085]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{t.projectName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium text-white ${
                      t.confidenceScore >= 85 ? 'bg-green-500' : t.confidenceScore >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}>
                      {t.confidenceScore}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{t.builderName} — {t.planName}</p>
                  <p className="text-xs text-gray-500 mt-1">{t.itemCount} items • Created {formatDate(t.createdAt)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quotes Expiring */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">⏰</span> Quotes Expiring ({data.quotesExpiring.length})
          </h2>
          {data.quotesExpiring.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No quotes expiring soon</p>
          ) : (
            <div className="space-y-2">
              {data.quotesExpiring.slice(0, 8).map((q: any) => (
                <Link key={q.id} href={`/ops/quotes/${q.id}`} className="block p-3 bg-orange-50 rounded-lg hover:bg-orange-100 transition border border-orange-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{q.quoteNumber}</span>
                    <span className="text-xs text-orange-600 font-medium">{formatDate(q.expiresAt)}</span>
                  </div>
                  <p className="text-xs text-gray-600">{q.builderName}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">{formatCurrency(q.total)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Requests Today */}
      {data.newRequests.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">📋</span> New Requests Today ({data.newRequests.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.newRequests.slice(0, 6).map((req: any) => (
              <Link key={req.id} href={`/ops/projects/${req.id}`} className="block p-3 rounded-lg border border-blue-200 bg-blue-50 hover:border-[#16A085] transition">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900">{req.projectName}</span>
                  <span className="text-xs text-blue-600 font-medium">
                    {new Date(req.requestedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-gray-600">{req.builderName}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Completions */}
      {data.recentCompletions && data.recentCompletions.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">✅</span> Completed This Week ({data.recentCompletions.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.recentCompletions.slice(0, 6).map((rc: any) => (
              <div key={rc.id} className="p-3 rounded-lg border border-green-200 bg-green-50">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900">{rc.projectName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium text-white ${
                    rc.confidenceScore >= 85 ? 'bg-green-500' : 'bg-yellow-500'
                  }`}>
                    {rc.confidenceScore}%
                  </span>
                </div>
                <p className="text-xs text-gray-600">{rc.builderName}</p>
                <p className="text-xs text-gray-500 mt-1">{rc.itemCount} items</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quotes in Draft Status */}
      {data.quotesInDraft.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">📄</span> Quotes in Draft ({data.quotesInDraft.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">Quote</th>
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">Builder</th>
                  <th className="text-right py-3 px-3 text-gray-600 font-semibold">Amount</th>
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.quotesInDraft.slice(0, 5).map((q: any) => (
                  <tr key={q.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                    <td className="py-3 px-3">
                      <Link href={`/ops/quotes/${q.id}`} className="font-semibold text-[#16A085] hover:text-[#138D75]">
                        {q.quoteNumber}
                      </Link>
                    </td>
                    <td className="py-3 px-3 text-gray-700 text-xs">{q.builderName}</td>
                    <td className="py-3 px-3 text-right font-semibold text-gray-900">{formatCurrency(q.total)}</td>
                    <td className="py-3 px-3 text-xs text-gray-600">{formatDate(q.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
