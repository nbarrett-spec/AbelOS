'use client'

import { useState, useEffect } from 'react'

interface ReportData {
  period: number
  revenue: { orderCount: number; totalRevenue: number; avgOrderValue: number; completedOrders: number }
  monthlyRevenue: { month: string; monthLabel: string; orders: number; revenue: number }[]
  topBuilders: { companyName: string; orderCount: number; totalRevenue: number; avgOrder: number }[]
  categoryMix: { category: string; itemCount: number; revenue: number }[]
  quoteMetrics: { totalQuotes: number; approved: number; rejected: number; pending: number; totalQuoteValue: number; approvedValue: number }
  pipeline: { status: string; count: number; value: number }[]
  lowStock: { sku: string; name: string; category: string; onHand: number; committed: number; available: number }[]
}

const fmt = (n: number) => n?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtCurrency = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Received', CONFIRMED: 'Confirmed', IN_PRODUCTION: 'In Production',
  READY_TO_SHIP: 'Ready to Ship', SHIPPED: 'Shipped', DELIVERED: 'Delivered', COMPLETE: 'Complete',
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/reports?period=${period}`)
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false))
  }, [period])

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const qm = data.quoteMetrics || { totalQuotes: 0, approved: 0, rejected: 0, pending: 0, totalQuoteValue: 0, approvedValue: 0 }
  const rev = data.revenue || { orderCount: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0 }

  const conversionRate = (qm.totalQuotes || 0) > 0
    ? (((qm.approved || 0) / qm.totalQuotes) * 100).toFixed(1)
    : '0'

  const maxMonthlyRevenue = Math.max(...(data.monthlyRevenue || []).map(m => m.revenue), 1)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Revenue, builder performance, and operational metrics</p>
        </div>
        <div className="flex gap-1 sm:gap-2 bg-gray-100 rounded-lg p-1 self-start sm:self-auto">
          {[
            { label: '7 Days', value: '7' },
            { label: '30 Days', value: '30' },
            { label: '90 Days', value: '90' },
            { label: 'Year', value: '365' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                period === opt.value ? 'bg-white shadow text-[#3E2A1E]' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mb-6">
        <a
          href="/ops/reports/shipping-forecast"
          className="inline-flex items-center gap-3 bg-white border rounded-xl px-5 py-4 hover:border-[#3E2A1E] hover:shadow-md transition group"
        >
          <span className="text-2xl">🚚</span>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-[#3E2A1E] transition">Shipping Forecast Report</p>
            <p className="text-xs text-gray-400">Orders shipping soon with BOM totals, assembled doors &amp; downloadable XLSX</p>
          </div>
          <span className="text-gray-300 group-hover:text-[#3E2A1E] ml-4 transition">&rarr;</span>
        </a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Total Revenue</p>
          <p className="text-3xl font-bold text-[#3E2A1E] mt-1">{fmtCurrency(rev.totalRevenue)}</p>
          <p className="text-xs text-gray-400 mt-1">{fmt(rev.orderCount)} orders</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Avg Order Value</p>
          <p className="text-3xl font-bold text-[#C9822B] mt-1">{fmtCurrency(rev.avgOrderValue)}</p>
          <p className="text-xs text-gray-400 mt-1">{fmt(rev.completedOrders)} completed</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Quote Conversion</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{conversionRate}%</p>
          <p className="text-xs text-gray-400 mt-1">{qm.approved || 0} of {qm.totalQuotes || 0} quotes</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Pipeline Value</p>
          <p className="text-3xl font-bold text-purple-600 mt-1">{fmtCurrency((qm.totalQuoteValue || 0) - (qm.approvedValue || 0))}</p>
          <p className="text-xs text-gray-400 mt-1">{qm.pending || 0} quotes pending</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Monthly Revenue Chart */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Monthly Revenue</h3>
          {data.monthlyRevenue.length === 0 ? (
            <p className="text-gray-400 text-sm">No revenue data for this period</p>
          ) : (
            <div className="space-y-3">
              {data.monthlyRevenue.map(m => (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-10">{m.monthLabel}</span>
                  <div className="flex-1 h-8 bg-gray-50 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#3E2A1E] to-[#2980B9] rounded-lg flex items-center px-3"
                      style={{ width: `${Math.max(5, (m.revenue / maxMonthlyRevenue) * 100)}%` }}
                    >
                      <span className="text-xs text-white font-medium whitespace-nowrap">{fmtCurrency(m.revenue)}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{m.orders} orders</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Pipeline */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Order Pipeline</h3>
          {data.pipeline.length === 0 ? (
            <p className="text-gray-400 text-sm">No orders for this period</p>
          ) : (
            <div className="space-y-3">
              {data.pipeline.map(p => (
                <div key={p.status} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#3E2A1E]" />
                    <span className="text-sm font-medium text-gray-700">{STATUS_LABELS[p.status] || p.status}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">{p.count} orders</span>
                    <span className="text-sm font-semibold text-[#3E2A1E]">{fmtCurrency(p.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Top Builders */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Top Builders by Revenue</h3>
          {data.topBuilders.length === 0 ? (
            <p className="text-gray-400 text-sm">No builder data for this period</p>
          ) : (
            <div className="divide-y">
              {data.topBuilders.map((b, i) => (
                <div key={b.companyName} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                      i === 0 ? 'bg-[#C9822B]' : i === 1 ? 'bg-[#3E2A1E]' : 'bg-gray-400'
                    }`}>
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.companyName}</p>
                      <p className="text-xs text-gray-400">{b.orderCount} orders &middot; avg {fmtCurrency(b.avgOrder)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-[#3E2A1E]">{fmtCurrency(b.totalRevenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Product Category Mix */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Product Category Mix</h3>
          {data.categoryMix.length === 0 ? (
            <p className="text-gray-400 text-sm">No product data for this period</p>
          ) : (
            <div className="space-y-3">
              {data.categoryMix.map(c => {
                const totalCategoryRevenue = data.categoryMix.reduce((s, x) => s + x.revenue, 0)
                const pct = totalCategoryRevenue > 0 ? ((c.revenue / totalCategoryRevenue) * 100).toFixed(0) : '0'
                return (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-32 truncate">{c.category}</span>
                    <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
                      <div className="h-full bg-[#3E2A1E]/20 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                    <span className="text-sm font-medium text-gray-900 w-20 text-right">{fmtCurrency(c.revenue)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Low Stock Alerts */}
      {data.lowStock.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">
            <span className="text-amber-500 mr-2">⚠️</span>
            Low Stock Alerts ({data.lowStock.length} items)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.lowStock.map(item => (
              <div key={item.sku} className={`p-3 rounded-lg border ${item.available <= 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-gray-500">{item.sku} &middot; {item.category}</p>
                <div className="flex gap-3 mt-2">
                  <span className="text-xs">On Hand: <strong>{item.onHand}</strong></span>
                  <span className="text-xs">Available: <strong className={item.available <= 0 ? 'text-red-600' : 'text-amber-600'}>{item.available}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
