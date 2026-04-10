'use client'

import { useEffect, useState } from 'react'

interface FinancialData {
  arAging: {
    current: { count: number; amount: number }
    days1to30: { count: number; amount: number }
    days31to60: { count: number; amount: number }
    days60plus: { count: number; amount: number }
    totalAR: number
  }
  cashFlow: {
    collectedThisWeek: number
    outstandingAmount: number
    invoicesThisWeek: number
  }
  invoiceStatusPipeline: Array<{
    status: string
    count: number
    totalValue: number
  }>
  marginAnalysis: {
    totalOrders: number
    avgMargin: number
    totalOrderValue: number
  }
  poSpending: {
    byVendor: Array<{
      vendorId: string
      vendorName: string
      totalSpent: number
      orderCount: number
    }>
    totalPOValue: number
  }
  paymentTermsMix: Array<{
    term: string
    count: number
  }>
}

const COLORS = ['#1B4F72', '#E67E22', '#27AE60', '#3498DB', '#8E44AD', '#E74C3C']

export default function FinancialDashboard() {
  const [data, setData] = useState<FinancialData | null>(null)
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
      const response = await fetch('/api/ops/executive/financial')
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }

  // Restricted placeholder for sensitive financial data
  const restricted = (
    <span className="text-gray-300 text-lg font-medium" title="Admin access required">
      ••••••
    </span>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading financial data...</div>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Financial Dashboard</h1>
        <p className="text-gray-500 mt-1">
          AR aging, cash flow, invoicing, and vendor spending analysis
        </p>
      </div>

      {/* Cash Flow KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#27AE60]">
          <div className="text-gray-500 text-sm font-medium">
            Collected This Week
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-2">
            {canViewFinancials ? formatCurrency(data.cashFlow.collectedThisWeek) : restricted}
          </div>
          <p className="text-xs text-gray-400 mt-2">7-day collections</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#E67E22]">
          <div className="text-gray-500 text-sm font-medium">Outstanding AR</div>
          <div className="text-2xl font-bold text-gray-900 mt-2">
            {canViewFinancials ? formatCurrency(data.arAging.totalAR) : restricted}
          </div>
          <p className="text-xs text-gray-400 mt-2">Accounts receivable</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#1B4F72]">
          <div className="text-gray-500 text-sm font-medium">
            Invoices This Week
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-2">
            {data.cashFlow.invoicesThisWeek}
          </div>
          <p className="text-xs text-gray-400 mt-2">Invoices created</p>
        </div>
      </div>

      {/* AR Aging & Invoice Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AR Aging Detail */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            AR Aging Summary
          </h3>
          <div className="space-y-3">
            {[
              {
                label: 'Current',
                amount: data.arAging.current.amount,
                count: data.arAging.current.count,
                color: 'bg-green-100',
                textColor: 'text-green-900',
              },
              {
                label: '1-30 Days',
                amount: data.arAging.days1to30.amount,
                count: data.arAging.days1to30.count,
                color: 'bg-yellow-100',
                textColor: 'text-yellow-900',
              },
              {
                label: '31-60 Days',
                amount: data.arAging.days31to60.amount,
                count: data.arAging.days31to60.count,
                color: 'bg-orange-100',
                textColor: 'text-orange-900',
              },
              {
                label: '60+ Days',
                amount: data.arAging.days60plus.amount,
                count: data.arAging.days60plus.count,
                color: 'bg-red-100',
                textColor: 'text-red-900',
              },
            ].map((bucket) => (
              <div key={bucket.label} className={`${bucket.color} rounded p-3`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`font-semibold text-sm ${bucket.textColor}`}>
                      {bucket.label}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {bucket.count} invoices
                    </div>
                  </div>
                  <div className={`text-lg font-bold ${bucket.textColor}`}>
                    {canViewFinancials ? formatCurrency(bucket.amount) : <span className="text-gray-300" title="Admin access required">••••••</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Invoice Status Pipeline */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Invoice Status Pipeline
          </h3>
          <div className="space-y-4">
            {data.invoiceStatusPipeline.map((item) => {
              const maxCount = Math.max(...data.invoiceStatusPipeline.map(s => s.count))
              const percentage = (item.count / maxCount) * 100
              return (
                <div key={item.status}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">{item.status}</span>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900">{item.count}</div>
                      <div className="text-xs text-gray-500">{canViewFinancials ? formatCurrency(item.totalValue) : <span className="text-gray-300" title="Admin access required">••••••</span>}</div>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="h-3 rounded-full bg-[#1B4F72] transition-all"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* PO Spending & Payment Terms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PO Spending by Vendor */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            PO Spending by Vendor
          </h3>
          <div className="mb-4 text-sm text-gray-600">
            Total PO Value:{' '}
            <span className="font-bold text-gray-900">
              {canViewFinancials ? formatCurrency(data.poSpending.totalPOValue) : <span className="text-gray-300" title="Admin access required">••••••</span>}
            </span>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {data.poSpending.byVendor.slice(0, 10).map((vendor) => (
              <div key={vendor.vendorId}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">
                    {vendor.vendorName}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {canViewFinancials ? formatCurrency(vendor.totalSpent) : <span className="text-gray-300" title="Admin access required">••••••</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#1B4F72] h-2 rounded-full"
                      style={{
                        width: `${
                          (vendor.totalSpent / data.poSpending.totalPOValue) * 100
                        }%`,
                      }}
                    ></div>
                  </div>
                  <span className="text-xs text-gray-500">
                    {vendor.orderCount} orders
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Terms Distribution */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Payment Terms Mix
          </h3>
          <div className="space-y-3">
            {data.paymentTermsMix.map((item, idx) => {
              const totalCount = data.paymentTermsMix.reduce((sum, t) => sum + t.count, 0)
              const percentage = (item.count / totalCount) * 100
              return (
                <div key={item.term}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                      ></div>
                      <span className="text-sm font-medium text-gray-700">{item.term}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{item.count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: COLORS[idx % COLORS.length],
                      }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 text-right">{percentage.toFixed(1)}%</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Margin Analysis */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Margin Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-gray-500 text-sm">Total Orders</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {data.marginAnalysis.totalOrders}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-sm">Avg Margin</div>
            <div className="text-3xl font-bold text-[#27AE60] mt-2">
              {canViewFinancials ? `${Math.round(data.marginAnalysis.avgMargin * 100)}%` : restricted}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-sm">Total Order Value</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {canViewFinancials ? formatCurrency(data.marginAnalysis.totalOrderValue) : restricted}
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow p-6 border-l-4 border-[#1B4F72]">
          <div className="text-gray-700 font-semibold">Collection Efficiency</div>
          <div className="text-3xl font-bold text-[#1B4F72] mt-2">
            {canViewFinancials ? (
              <>
                {data.arAging.totalAR > 0
                  ? Math.round(
                      ((data.cashFlow.collectedThisWeek / data.arAging.totalAR) *
                        100) /
                        (52 / 12)
                    )
                  : 0}
                %
              </>
            ) : restricted}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Annualized weekly collection rate
          </p>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg shadow p-6 border-l-4 border-[#E67E22]">
          <div className="text-gray-700 font-semibold">DSO (Days Sales Outstanding)</div>
          <div className="text-3xl font-bold text-[#E67E22] mt-2">
            {canViewFinancials ? (
              data.arAging.totalAR > 0 && data.cashFlow.collectedThisWeek > 0
                ? Math.round(
                    (data.arAging.totalAR / (data.cashFlow.collectedThisWeek * 52)) *
                      365
                  )
                : 0
            ) : restricted}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Average days to collect payment
          </p>
        </div>
      </div>
    </div>
  )
}
