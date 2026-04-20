'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BriefingData {
  date: string
  summary: {
    invoicesToSend: number
    paymentsReceivedToday: number
    collectionsFollowUpsDue: number
    apDueThisWeek: number
    bankBalance: number
    overdueAR: number
  }
  invoicesToSend: any[]
  paymentsReceived: any[]
  collectionsFollowUps: any[]
  apDueThisWeek: any[]
  arAgingSummary: {
    current: number
    days30: number
    days60: number
    days90plus: number
    total: number
  }
  recentActivity: any[]
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

const formatDate = (d: string) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function AccountingBriefingPage() {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/accounting-briefing')
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch accounting briefing:', err)
        setError('Failed to load briefing data. Please try refreshing.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#8E44AD] border-t-transparent rounded-full animate-spin" />
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
        <p className="text-4xl mb-3">📊</p>
        <p className="text-lg font-medium">No briefing data available</p>
        <p className="text-sm mt-1">Check your access permissions.</p>
      </div>
    )
  }

  const s = data.summary
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'

  // Calculate AR aging percentages for stacked bar
  const arTotal = data.arAgingSummary.total || 1
  const currentPct = (data.arAgingSummary.current / arTotal) * 100
  const days30Pct = (data.arAgingSummary.days30 / arTotal) * 100
  const days60Pct = (data.arAgingSummary.days60 / arTotal) * 100
  const days90Pct = (data.arAgingSummary.days90plus / arTotal) * 100

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting} — Financial Briefing</h1>
          <p className="text-sm text-gray-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <Link href="/ops/portal/accounting" className="text-sm text-[#8E44AD] hover:underline">← Back to Dashboard</Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Invoices to Send', value: s.invoicesToSend, color: '#8E44AD' },
          { label: 'Payments Today', value: s.paymentsReceivedToday, color: '#27AE60' },
          { label: 'Collections Due', value: s.collectionsFollowUpsDue, color: s.collectionsFollowUpsDue > 0 ? '#E74C3C' : '#95A5A6' },
          { label: 'AP Due This Week', value: s.apDueThisWeek, color: '#D9993F' },
          { label: 'AR Balance', value: formatCurrency(data.arAgingSummary.total), color: '#3498DB', isAmount: true },
          { label: 'Overdue AR', value: formatCurrency(s.overdueAR), color: s.overdueAR > 0 ? '#E74C3C' : '#95A5A6', isAmount: true },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-2xl font-bold" style={{ color: kpi.color }}>
              {kpi.isAmount ? kpi.value : kpi.value}
            </p>
            <p className="text-xs text-gray-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* AR Aging Chart */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-900 mb-4 text-sm">AR Aging Summary</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex h-8 rounded-lg overflow-hidden border border-gray-200">
                {currentPct > 0 && <div style={{ width: `${currentPct}%`, backgroundColor: '#27AE60' }} />}
                {days30Pct > 0 && <div style={{ width: `${days30Pct}%`, backgroundColor: '#D9993F' }} />}
                {days60Pct > 0 && <div style={{ width: `${days60Pct}%`, backgroundColor: '#C9822B' }} />}
                {days90Pct > 0 && <div style={{ width: `${days90Pct}%`, backgroundColor: '#E74C3C' }} />}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(data.arAgingSummary.total)}</p>
              <p className="text-xs text-gray-500">Total Outstanding</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#27AE60' }} />
              <div>
                <p className="text-gray-600">Current</p>
                <p className="font-semibold text-gray-900">{formatCurrency(data.arAgingSummary.current)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#D9993F' }} />
              <div>
                <p className="text-gray-600">30 days</p>
                <p className="font-semibold text-gray-900">{formatCurrency(data.arAgingSummary.days30)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#C9822B' }} />
              <div>
                <p className="text-gray-600">60 days</p>
                <p className="font-semibold text-gray-900">{formatCurrency(data.arAgingSummary.days60)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#E74C3C' }} />
              <div>
                <p className="text-gray-600">90+ days</p>
                <p className="font-semibold text-gray-900">{formatCurrency(data.arAgingSummary.days90plus)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Two columns: Invoices to Send | Collections Follow-Ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoices to Send */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">📄</span> Invoices to Send ({data.invoicesToSend.length})
          </h2>
          {data.invoicesToSend.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No invoices to send</p>
          ) : (
            <div className="space-y-2">
              {data.invoicesToSend.slice(0, 8).map((inv: any) => (
                <div key={inv.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-[#8E44AD] transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{inv.jobNumber}</span>
                    <span className="text-xs text-gray-500">{formatDate(inv.completedDate)}</span>
                  </div>
                  <p className="text-xs text-gray-600">{inv.builderName}</p>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(inv.orderTotal || 0)}</span>
                    <Link href="/ops/invoices" className="text-xs px-2 py-1 rounded bg-[#8E44AD] text-white hover:bg-[#7D3C98] transition">
                      Create Invoice
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Collections Follow-Ups */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-lg">🔴</span> Collections Follow-Ups ({data.collectionsFollowUps.length})
          </h2>
          {data.collectionsFollowUps.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">All caught up!</p>
          ) : (
            <div className="space-y-2">
              {data.collectionsFollowUps.slice(0, 8).map((col: any) => (
                <div key={col.id} className="p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{col.invoiceNumber}</span>
                    <span className={`text-[10px] px-2 py-1 rounded font-medium ${
                      col.escalationLevel === 3 ? 'bg-red-600 text-white' :
                      col.escalationLevel === 2 ? 'bg-orange-500 text-white' :
                      'bg-yellow-500 text-white'
                    }`}>
                      Level {col.escalationLevel}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{col.builderName}</p>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-red-200">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(col.amount)}</p>
                      <p className="text-xs text-red-600">{col.daysOverdue} days overdue</p>
                    </div>
                    <Link href="/ops/invoices" className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition">
                      Follow Up
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AP Due This Week */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="text-lg">🏭</span> AP Due This Week ({data.apDueThisWeek.length})
        </h2>
        {data.apDueThisWeek.length === 0 ? (
          <p className="text-gray-400 text-sm py-4 text-center">No bills due this week</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">PO</th>
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">Vendor</th>
                  <th className="text-right py-3 px-3 text-gray-600 font-semibold">Amount</th>
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">Due Date</th>
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.apDueThisWeek.map((po: any) => (
                  <tr key={po.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                    <td className="py-3 px-3">
                      <span className="font-semibold text-[#8E44AD]">{po.poNumber}</span>
                    </td>
                    <td className="py-3 px-3 text-gray-700 text-xs">{po.vendor}</td>
                    <td className="py-3 px-3 text-right font-semibold text-gray-900">{formatCurrency(po.amount)}</td>
                    <td className="py-3 px-3 text-xs text-gray-600">{formatDate(po.dueDate)}</td>
                    <td className="py-3 px-3">
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        po.status === 'APPROVED' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {po.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Payments */}
      {data.paymentsReceived.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="text-lg">💰</span> Recent Payments Received
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.paymentsReceived.slice(0, 6).map((pmt: any) => (
              <div key={pmt.id} className="p-4 rounded-lg border border-green-200 bg-green-50">
                <div className="flex items-start justify-between mb-2">
                  <p className="font-semibold text-gray-900 text-sm">{pmt.invoiceNumber}</p>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">✅ RECEIVED</span>
                </div>
                <p className="text-lg font-bold text-green-600 my-2">{formatCurrency(pmt.amount)}</p>
                <p className="text-xs text-gray-600">{pmt.builderName}</p>
                <p className="text-xs text-gray-500 mt-1">Via {pmt.paymentMethod} • {formatDate(pmt.receivedAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
