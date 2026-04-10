'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BriefingData {
  date: string
  summary: {
    activeDeals: number
    pipelineValue: number
    quotesExpiring7d: number
    followUpsDue: number
    newLeadsToday: number
    closingThisWeek: number
  }
  dealsByStage: Array<{ stage: string; count: number; value: number }>
  followUpsDue: Array<{
    dealId: string
    companyName: string
    stage: string
    value: number
    daysSinceActivity: number
    ownerName: string
  }>
  quotesExpiring: Array<{
    quoteNumber: string
    builderName: string
    total: number
    expiresAt: string
    status: string
  }>
  closingThisWeek: Array<{
    dealId: string
    dealNumber: string
    companyName: string
    stage: string
    value: number
    expectedCloseDate: string
    ownerName: string
  }>
  recentWins: Array<{
    dealId: string
    dealNumber: string
    companyName: string
    value: number
    actualCloseDate: string
    ownerName: string
  }>
  atRiskDeals: Array<{
    dealId: string
    dealNumber: string
    companyName: string
    stage: string
    value: number
    daysSinceActivity: number
    ownerName: string
  }>
}

const formatCurrency = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const formatDate = (d: string | null) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function SalesBriefingPage() {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/sales-briefing')
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch sales briefing:', err)
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
        <p className="text-sm mt-1">Make sure you have deals assigned to your account.</p>
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
        <Link href="/ops/portal/sales" className="text-sm text-[#1B4F72] hover:underline">← Back to Dashboard</Link>
      </div>

      {/* Quick KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Active Deals', value: s.activeDeals, color: '#1B4F72' },
          { label: 'Pipeline Value', value: formatCurrency(s.pipelineValue), color: '#27AE60' },
          { label: 'Quotes Expiring', value: s.quotesExpiring7d, color: s.quotesExpiring7d > 0 ? '#E74C3C' : '#95A5A6' },
          { label: 'Follow-Ups Due', value: s.followUpsDue, color: s.followUpsDue > 0 ? '#E67E22' : '#95A5A6' },
          { label: 'New Leads Today', value: s.newLeadsToday, color: '#3498DB' },
          { label: 'Closing This Week', value: s.closingThisWeek, color: '#9B59B6' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
            <p className="text-xs text-gray-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Priority Alerts */}
      {(data.atRiskDeals.length > 0 || data.followUpsDue.length > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-red-900 mb-3">Priority Alerts</h3>
          <div className="space-y-2">
            {data.atRiskDeals.slice(0, 3).map(deal => (
              <div key={deal.dealId} className="text-sm text-red-800">
                <span className="font-medium">{deal.companyName}</span> — At risk ({deal.daysSinceActivity} days no activity) • {formatCurrency(deal.value)}
              </div>
            ))}
            {data.followUpsDue.slice(0, 2).map(deal => (
              <div key={deal.dealId} className="text-sm text-orange-800">
                <span className="font-medium">{deal.companyName}</span> — Overdue follow-up ({deal.daysSinceActivity} days) • {deal.stage}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two column: Closing This Week | Quotes Expiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Closing This Week */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Deals Closing This Week</h2>
            <Link href="/ops/pipeline" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View Pipeline →
            </Link>
          </div>

          {data.closingThisWeek.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">🎯</p>
              <p>No deals closing this week</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.closingThisWeek.map(deal => (
                <div key={deal.dealId} className="p-4 rounded-lg border border-gray-200 hover:border-[#9B59B6] transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-900">{deal.companyName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{deal.dealNumber}</p>
                    </div>
                    <span className="text-lg font-bold text-[#9B59B6]">{formatCurrency(deal.value)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{deal.stage}</span>
                    <span>Close: {formatDate(deal.expectedCloseDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quotes Expiring Soon */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Quotes Expiring Soon</h2>
            <Link href="/quotes" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View Quotes →
            </Link>
          </div>

          {data.quotesExpiring.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">📋</p>
              <p>No quotes expiring soon</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.quotesExpiring.map(quote => (
                <div key={quote.quoteNumber} className="p-4 rounded-lg border border-gray-200 hover:border-[#E74C3C] transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-900">{quote.builderName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{quote.quoteNumber}</p>
                    </div>
                    <span className="text-lg font-bold text-[#E67E22]">{formatCurrency(quote.total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`px-2 py-1 rounded ${quote.status === 'SENT' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                      {quote.status}
                    </span>
                    <span className="text-gray-500">Expires: {formatDate(quote.expiresAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Follow-Ups Due Table */}
      {data.followUpsDue.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Follow-Ups Due</h2>
            <Link href="/deals" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View All →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr className="text-left text-gray-600 text-xs font-semibold">
                  <th className="pb-3">Company</th>
                  <th className="pb-3">Stage</th>
                  <th className="pb-3">Value</th>
                  <th className="pb-3">Days Inactive</th>
                  <th className="pb-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.followUpsDue.map(deal => (
                  <tr key={deal.dealId} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3">
                      <p className="font-medium text-gray-900">{deal.companyName}</p>
                      <p className="text-xs text-gray-500">{deal.ownerName}</p>
                    </td>
                    <td className="py-3">
                      <span className="text-xs px-2 py-1 rounded bg-gray-100">{deal.stage}</span>
                    </td>
                    <td className="py-3 font-semibold text-gray-900">{formatCurrency(deal.value)}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-1 rounded font-medium ${deal.daysSinceActivity > 14 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {deal.daysSinceActivity}d
                      </span>
                    </td>
                    <td className="py-3">
                      <button className="text-xs text-[#1B4F72] hover:underline font-medium">
                        Log Activity →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Wins Celebration */}
      {data.recentWins.length > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-900 mb-4">Recent Wins 🎉</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.recentWins.map(win => (
              <div key={win.dealId} className="bg-white rounded-lg p-4 border border-green-100">
                <p className="font-semibold text-gray-900">{win.companyName}</p>
                <p className="text-xs text-gray-500 mt-0.5">{win.dealNumber}</p>
                <p className="text-xl font-bold text-[#27AE60] mt-2">{formatCurrency(win.value)}</p>
                <p className="text-xs text-gray-500 mt-2">Won: {formatDate(win.actualCloseDate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal Pipeline by Stage */}
      {data.dealsByStage.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Pipeline by Stage</h2>
          <div className="space-y-3">
            {data.dealsByStage.map(stage => (
              <div key={stage.stage}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">{stage.stage}</span>
                  <span className="text-sm text-gray-600">{stage.count} deals • {formatCurrency(stage.value)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#1B4F72]"
                    style={{
                      width: `${Math.min((stage.count / Math.max(...data.dealsByStage.map(s => s.count))) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
