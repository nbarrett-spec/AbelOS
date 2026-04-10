'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface DashboardData {
  revenueKpis: {
    totalRevenue: number
    totalOrders: number
    currentMonth: number
    lastMonth: number
    ytd: number
    momGrowth: number
    totalInvoiced: number
    totalCollected: number
    outstandingAR: number
    grossMargin: number
  }
  monthlyRevenue: Array<{ month: string; revenue: number; orderCount: number }>
  pipelineHealth: {
    ordersByStatus: Array<{ status: string; count: number; value: number }>
    totalOrders: number
    inProgress: number
    pending: number
  }
  builderMetrics: {
    totalBuilders: number
    activeBuilders: number
    newThisMonth: number
    topBuilders: Array<{ builderId: string; companyName: string; revenue: number; orderCount: number }>
  }
  operationsSnapshot: {
    completedAll: number
    completedThisMonth: number
    inProgress: number
    avgCycleTimeDays: number
    totalDeliveries: number
    activeDeliveries: number
  }
  financials: {
    totalPOSpend: number
    openPOs: number
    openPOValue: number
    grossMargin: number
  }
  alerts: {
    overdueInvoices: number
    stalledOrders: number
  }
}

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: '#3498DB',
  CONFIRMED: '#2980B9',
  IN_PRODUCTION: '#E67E22',
  READY_TO_SHIP: '#F39C12',
  SHIPPED: '#8E44AD',
  DELIVERED: '#27AE60',
  COMPLETE: '#1B4F72',
  CANCELLED: '#95A5A6',
}

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Received',
  CONFIRMED: 'Confirmed',
  IN_PRODUCTION: 'In Production',
  READY_TO_SHIP: 'Ready to Ship',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
}

export default function ExecutiveDashboard() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canViewFinancials, setCanViewFinancials] = useState(false)

  useEffect(() => {
    fetchData()
    fetchPermissions()
  }, [])

  const fetchPermissions = async () => {
    try {
      const res = await fetch('/api/ops/auth/permissions')
      if (res.ok) {
        const perms = await res.json()
        setCanViewFinancials(perms.canViewOperationalFinancials === true)
      }
    } catch { /* default to restricted */ }
  }

  const fetchData = async () => {
    try {
      const response = await fetch('/api/ops/executive/dashboard')
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)

  const formatNumber = (value: number) =>
    new Intl.NumberFormat('en-US').format(value)

  // Restricted placeholder for sensitive financial data
  const restricted = (
    <span className="text-gray-300 text-lg font-medium" title="Admin access required">
      ••••••
    </span>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading CEO Dashboard...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Error: {error || 'No data'}</div>
      </div>
    )
  }

  const maxMonthlyRevenue = Math.max(...data.monthlyRevenue.map(m => m.revenue), 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">CEO Dashboard</h1>
          <p className="text-gray-500 mt-1">Executive command center — revenue, operations, and growth metrics</p>
        </div>
        <button onClick={fetchData} className="px-4 py-2 bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] text-sm font-medium">
          🔄 Refresh
        </button>
      </div>

      {/* Alerts Banner */}
      {(data.alerts.overdueInvoices > 0 || data.alerts.stalledOrders > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-semibold text-red-900">Active Alerts</h3>
              <p className="text-sm text-red-700 mt-1">
                {data.alerts.overdueInvoices > 0 && (
                  <span onClick={() => router.push('/ops/finance/ar?status=OVERDUE')} className="cursor-pointer hover:underline">
                    {data.alerts.overdueInvoices} overdue invoices
                  </span>
                )}
                {data.alerts.overdueInvoices > 0 && data.alerts.stalledOrders > 0 && <span> • </span>}
                {data.alerts.stalledOrders > 0 && (
                  <span onClick={() => router.push('/ops/orders?stalled=true')} className="cursor-pointer hover:underline">
                    {data.alerts.stalledOrders} orders stalled 7+ days
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Revenue KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div onClick={() => router.push('/ops/finance')} className="bg-white rounded-lg shadow p-5 border-l-4 border-[#1B4F72] hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Total Revenue</p>
          {canViewFinancials ? (
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.revenueKpis.totalRevenue)}</p>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
          <p className="text-xs text-gray-400 mt-1">{formatNumber(data.revenueKpis.totalOrders)} orders</p>
        </div>
        <div onClick={() => router.push('/ops/finance')} className="bg-white rounded-lg shadow p-5 border-l-4 border-[#27AE60] hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">This Month</p>
          {canViewFinancials ? (
            <>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.revenueKpis.currentMonth)}</p>
              <p className={`text-xs mt-1 font-medium ${data.revenueKpis.momGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data.revenueKpis.momGrowth >= 0 ? '\u2191' : '\u2193'} {Math.abs(data.revenueKpis.momGrowth).toFixed(1)}% vs last month
              </p>
            </>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
        </div>
        <div onClick={() => router.push('/ops/finance')} className="bg-white rounded-lg shadow p-5 border-l-4 border-[#3498DB] hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">YTD Revenue</p>
          {canViewFinancials ? (
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.revenueKpis.ytd)}</p>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
          <p className="text-xs text-gray-400 mt-1">Year to date</p>
        </div>
        <div onClick={() => router.push('/ops/finance/health')} className="bg-white rounded-lg shadow p-5 border-l-4 border-[#8E44AD] hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Gross Margin</p>
          {canViewFinancials ? (
            <p className={`text-2xl font-bold mt-1 ${data.revenueKpis.grossMargin >= 30 ? 'text-green-600' : data.revenueKpis.grossMargin >= 20 ? 'text-orange-600' : 'text-red-600'}`}>
              {data.revenueKpis.grossMargin.toFixed(1)}%
            </p>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
          <p className="text-xs text-gray-400 mt-1">Revenue vs COGS</p>
        </div>
        <div onClick={() => router.push('/ops/finance/ar')} className="bg-white rounded-lg shadow p-5 border-l-4 border-[#E67E22] hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Outstanding AR</p>
          {canViewFinancials ? (
            <>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.revenueKpis.outstandingAR)}</p>
              <p className="text-xs text-gray-400 mt-1">Collected: {formatCurrency(data.revenueKpis.totalCollected)}</p>
            </>
          ) : (
            <>
              <div className="mt-1">{restricted}</div>
              <p className="text-xs text-gray-400 mt-1">Admin access required</p>
            </>
          )}
        </div>
        <div onClick={() => router.push('/ops/purchasing')} className="bg-white rounded-lg shadow p-5 border-l-4 border-[#E74C3C] hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">PO Spending</p>
          {canViewFinancials ? (
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.financials.totalPOSpend)}</p>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
          <p className="text-xs text-gray-400 mt-1">{data.financials.openPOs} open POs</p>
        </div>
      </div>

      {/* Revenue Trend & Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Revenue Trend */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend (Last 6 Months)</h3>
          {data.monthlyRevenue.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <p>Revenue data will appear as orders are placed</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.monthlyRevenue.map((m) => {
                const pct = (m.revenue / maxMonthlyRevenue) * 100
                return (
                  <div key={m.month}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">{m.month}</span>
                      <div className="text-right">
                        {canViewFinancials ? (
                          <span className="text-sm font-bold text-gray-900">{formatCurrency(m.revenue)}</span>
                        ) : (
                          <span className="text-sm text-gray-300" title="Admin access required">••••••</span>
                        )}
                        <span className="text-xs text-gray-400 ml-2">({m.orderCount} orders)</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="h-3 rounded-full bg-gradient-to-r from-[#1B4F72] to-[#E67E22] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Order Pipeline */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Order Pipeline</h3>
          {data.pipelineHealth.ordersByStatus.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <p>No orders yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.pipelineHealth.ordersByStatus.map((item) => {
                const maxCount = Math.max(...data.pipelineHealth.ordersByStatus.map(s => s.count))
                const pct = (item.count / maxCount) * 100
                return (
                  <div key={item.status} onClick={() => router.push(`/ops/orders?status=${item.status}`)} className="cursor-pointer hover:shadow-md transition-shadow p-2 rounded-lg hover:bg-gray-50">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[item.status] || '#95A5A6' }} />
                        <span className="text-sm font-medium text-gray-700">
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-gray-900">{item.count}</span>
                        {canViewFinancials ? (
                          <span className="text-xs text-gray-400 ml-1">({formatCurrency(item.value)})</span>
                        ) : (
                          <span className="text-xs text-gray-300 ml-1" title="Admin access required">(••••••)</span>
                        )}
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[item.status] || '#95A5A6' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Builders & Builder Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Builders */}
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top 10 Builders by Revenue</h3>
          {data.builderMetrics.topBuilders.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No builder revenue data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b-2 border-gray-200">
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">#</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">Builder</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-600">Revenue</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-600">Orders</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-600">Avg Order</th>
                  </tr>
                </thead>
                <tbody>
                  {data.builderMetrics.topBuilders.map((b, idx) => (
                    <tr key={b.builderId} onClick={() => router.push(`/ops/accounts/${b.builderId}`)} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:shadow-md transition-shadow cursor-pointer`}>
                      <td className="py-2.5 px-3">
                        <div className="w-6 h-6 rounded-full bg-[#1B4F72] text-white text-xs flex items-center justify-center font-bold">
                          {idx + 1}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-gray-900">{b.companyName}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-gray-900">
                        {canViewFinancials ? formatCurrency(b.revenue) : <span className="text-gray-300" title="Admin access required">••••••</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-600">{b.orderCount}</td>
                      <td className="py-2.5 px-3 text-right text-gray-600">
                        {canViewFinancials ? formatCurrency(b.orderCount > 0 ? b.revenue / b.orderCount : 0) : <span className="text-gray-300" title="Admin access required">••••••</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Builder Metrics */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Builder Metrics</h3>
          <div className="space-y-5">
            <div onClick={() => router.push('/ops/accounts')} className="cursor-pointer hover:shadow-md transition-shadow p-2 rounded-lg hover:bg-gray-50">
              <p className="text-gray-500 text-sm">Total Builders</p>
              <p className="text-3xl font-bold text-[#1B4F72] mt-1">{data.builderMetrics.totalBuilders}</p>
            </div>
            <div onClick={() => router.push('/ops/accounts?status=ACTIVE')} className="border-t pt-4 cursor-pointer hover:shadow-md transition-shadow p-2 rounded-lg hover:bg-gray-50">
              <p className="text-gray-500 text-sm">Active Accounts</p>
              <p className="text-3xl font-bold text-[#27AE60] mt-1">{data.builderMetrics.activeBuilders}</p>
              <p className="text-xs text-gray-400 mt-1">
                {data.builderMetrics.totalBuilders > 0
                  ? Math.round((data.builderMetrics.activeBuilders / data.builderMetrics.totalBuilders) * 100)
                  : 0}% activation rate
              </p>
            </div>
            <div onClick={() => router.push('/ops/accounts?new=true')} className="border-t pt-4 cursor-pointer hover:shadow-md transition-shadow p-2 rounded-lg hover:bg-gray-50">
              <p className="text-gray-500 text-sm">New This Month</p>
              <p className="text-3xl font-bold text-[#E67E22] mt-1">{data.builderMetrics.newThisMonth}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Operations Snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div onClick={() => router.push('/ops/orders?status=COMPLETE')} className="bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Orders Completed</p>
          <p className="text-2xl font-bold text-[#27AE60] mt-1">{data.operationsSnapshot.completedAll}</p>
          <p className="text-xs text-gray-400 mt-1">{data.operationsSnapshot.completedThisMonth} this month</p>
        </div>
        <div onClick={() => router.push('/ops/orders?status=IN_PROGRESS')} className="bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">In Progress</p>
          <p className="text-2xl font-bold text-[#E67E22] mt-1">{data.operationsSnapshot.inProgress}</p>
          <p className="text-xs text-gray-400 mt-1">Active orders</p>
        </div>
        <div onClick={() => router.push('/ops/executive/operations')} className="bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Avg Cycle Time</p>
          <p className="text-2xl font-bold text-[#3498DB] mt-1">{data.operationsSnapshot.avgCycleTimeDays} days</p>
          <p className="text-xs text-gray-400 mt-1">Order to complete</p>
        </div>
        <div onClick={() => router.push('/ops/delivery')} className="bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Deliveries</p>
          <p className="text-2xl font-bold text-[#8E44AD] mt-1">{data.operationsSnapshot.totalDeliveries}</p>
          <p className="text-xs text-gray-400 mt-1">{data.operationsSnapshot.activeDeliveries} active</p>
        </div>
        <div onClick={() => router.push('/ops/purchasing')} className="bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Open PO Value</p>
          {canViewFinancials ? (
            <p className="text-2xl font-bold text-[#E74C3C] mt-1">{formatCurrency(data.financials.openPOValue)}</p>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
          <p className="text-xs text-gray-400 mt-1">{data.financials.openPOs} purchase orders</p>
        </div>
        <div onClick={() => router.push('/ops/finance/health')} className="bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow cursor-pointer">
          <p className="text-xs text-gray-500 uppercase font-medium">Gross Margin</p>
          {canViewFinancials ? (
            <p className={`text-2xl font-bold mt-1 ${data.financials.grossMargin >= 30 ? 'text-green-600' : data.financials.grossMargin >= 20 ? 'text-orange-600' : 'text-red-600'}`}>
              {data.financials.grossMargin.toFixed(1)}%
            </p>
          ) : (
            <div className="mt-1">{restricted}</div>
          )}
          <p className="text-xs text-gray-400 mt-1">Revenue vs PO cost</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gradient-to-r from-[#1B4F72] to-[#0D2847] rounded-lg shadow p-6 text-white">
        <h3 className="text-lg font-semibold mb-4">Quick Access</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link href="/ops/finance" className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded-lg font-medium text-sm text-center transition">
            📊 Financial Dashboard
          </Link>
          <Link href="/ops/revenue-intelligence" className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded-lg font-medium text-sm text-center transition">
            💰 AI Revenue Machine
          </Link>
          <Link href="/ops/cash-flow-optimizer" className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded-lg font-medium text-sm text-center transition">
            💸 Cash Flow Brain
          </Link>
          <Link href="/ops/procurement-intelligence" className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded-lg font-medium text-sm text-center transition">
            🧠 Procurement AI
          </Link>
        </div>
      </div>
    </div>
  )
}
