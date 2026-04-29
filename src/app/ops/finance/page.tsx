'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { DollarSign, FileText, TrendingDown, Phone, ClipboardCheck } from 'lucide-react'
import type { MonthlyRollup } from '@/lib/finance/monthly-rollup'
import {
  FinancialYtdStrip,
  FinancialMonthTable,
  FinancialLineChart,
  YearQuarterControls,
  type QuarterFilter,
} from '@/components/FinancialChart'
import { PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui'

interface DashboardData {
  cashPosition: {
    totalAR: number
    totalAP: number
    netCashPosition: number
    revenueThisMonth: number
    revenueThisQuarter: number
    revenueThisYear: number
  }
  arAging: {
    current: { count: number; amount: number }
    days1to30: { count: number; amount: number }
    days31to60: { count: number; amount: number }
    days60plus: { count: number; amount: number }
  }
  apSummary: Array<{
    vendorId: string
    vendorName: string
    totalPOs: number
    total: number
    status: string
  }>
  monthlyRevenue: Array<{
    month: string
    amount: number
  }>
  topBuilders: Array<{
    builderId: string
    builderName: string
    totalBilled: number
    totalPaid: number
    balance: number
  }>
  alerts: Array<{
    type: 'overdue' | 'unpaid' | 'approval'
    message: string
    value: number
    count: number
  }>
}

// Roles allowed on /ops/finance — must mirror permissions.ts ROUTE_ACCESS.
// Anyone outside this set is redirected to /ops/today on mount.
const FINANCE_ALLOWED_ROLES = new Set<string>(['ADMIN', 'MANAGER', 'ACCOUNTING'])

export default function FinancialDashboard() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cashFlowHealth, setCashFlowHealth] = useState<any>(null)
  const [canViewFinancials, setCanViewFinancials] = useState(false)
  // Role gate: 'checking' until /api/ops/auth/me returns; 'allowed' for
  // ADMIN/MANAGER/ACCOUNTING; 'denied' otherwise (triggers redirect).
  const [roleStatus, setRoleStatus] = useState<'checking' | 'allowed' | 'denied'>('checking')

  // ── YTD / per-month rollup ──
  const currentYear = new Date().getUTCFullYear()
  const currentMonth = new Date().getUTCMonth() + 1
  const [rollup, setRollup] = useState<MonthlyRollup | null>(null)
  const [rollupYear, setRollupYear] = useState<number>(currentYear)
  const [quarter, setQuarter] = useState<QuarterFilter>('YTD')

  // Role gate: redirect non-mgmt away from Financial Dashboard.
  // Server still enforces via canAccessRoute(); this is the client-side
  // bounce so the page never renders for unauthorized roles.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ops/auth/me')
        if (!res.ok) {
          if (!cancelled) setRoleStatus('denied')
          return
        }
        const body = await res.json()
        const roles: string[] = Array.isArray(body?.staff?.roles)
          ? body.staff.roles
          : body?.staff?.role ? [body.staff.role] : []
        const allowed = roles.some((r) => FINANCE_ALLOWED_ROLES.has(r))
        if (cancelled) return
        if (allowed) {
          setRoleStatus('allowed')
        } else {
          setRoleStatus('denied')
          router.push('/ops/today')
        }
      } catch {
        if (!cancelled) setRoleStatus('denied')
      }
    })()
    return () => { cancelled = true }
  }, [router])

  useEffect(() => {
    fetchData()
    fetchCashFlowHealth()
    fetchPermissions()
  }, [])

  useEffect(() => {
    fetch(`/api/ops/finance/monthly-rollup?year=${rollupYear}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setRollup(d) })
      .catch(() => { /* silent */ })
  }, [rollupYear])

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
      const response = await fetch('/api/ops/finance/dashboard')
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const fetchCashFlowHealth = async () => {
    try {
      const res = await fetch('/api/ops/cash-flow-optimizer/working-capital')
      if (res.ok) setCashFlowHealth(await res.json())
    } catch { /* silent */ }
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
    <span className="text-fg-subtle text-lg font-medium" title="Admin access required">
      ••••••
    </span>
  )

  // Don't render anything for unauthorized roles — they're being redirected.
  // 'checking' renders nothing too so flash-of-content doesn't happen.
  if (roleStatus !== 'allowed') {
    return null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-fg-muted">Loading financial dashboard...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-data-negative">Error: {error || 'No data'}</div>
      </div>
    )
  }

  const maxRevenue = Math.max(...data.monthlyRevenue.map(m => m.amount), 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Finance"
        title="Financial Dashboard"
        description="CFO's command center — Cash position, AR aging, AP summary, and alerts."
        actions={rollup ? (
          <YearQuarterControls
            year={rollupYear}
            availableYears={[currentYear - 2, currentYear - 1, currentYear]}
            onYearChange={setRollupYear}
            quarter={quarter}
            onQuarterChange={setQuarter}
          />
        ) : undefined}
      />

      {/* ── YTD KPI strip + per-month table + chart ───────────────────── */}
      {rollup && (
        <div className="space-y-4">
          <FinancialYtdStrip ytd={rollup.ytd} restricted={!canViewFinancials} />
          <FinancialMonthTable
            months={rollup.months}
            currentMonth={rollupYear === currentYear ? currentMonth : 12}
            quarter={quarter}
            restricted={!canViewFinancials}
          />
          <FinancialLineChart
            months={rollup.months}
            currentMonth={rollupYear === currentYear ? currentMonth : 0}
            restricted={!canViewFinancials}
          />
        </div>
      )}

      {/* Quick Actions Strip — Dawn's shortcut bar to skip sidebar nav */}
      <div className="bg-surface rounded-lg shadow p-4 border border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* RecordPaymentModal needs an invoice picker first; for now route to /ops/invoices for selection. */}
          <button
            onClick={() => router.push('/ops/invoices')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-[#0f2a3e] hover:bg-[#0D2847] text-white rounded-lg font-semibold text-sm transition-colors"
          >
            <DollarSign className="w-4 h-4" />
            Record Payment
          </button>
          <button
            onClick={() => router.push('/ops/invoices?create=1')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-surface-muted hover:bg-border text-fg rounded-lg font-semibold text-sm border border-border transition-colors"
          >
            <FileText className="w-4 h-4" />
            Create Invoice
          </button>
          <button
            onClick={() => router.push('/ops/finance/ar')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-surface-muted hover:bg-border text-fg rounded-lg font-semibold text-sm border border-border transition-colors"
          >
            <TrendingDown className="w-4 h-4" />
            View AR Aging
          </button>
          <button
            onClick={() => router.push('/ops/collections')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-surface-muted hover:bg-border text-fg rounded-lg font-semibold text-sm border border-border transition-colors"
          >
            <Phone className="w-4 h-4" />
            Collections Queue
          </button>
          <button
            onClick={() => router.push('/ops/portal/accounting/close')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-surface-muted hover:bg-border text-fg rounded-lg font-semibold text-sm border border-border transition-colors"
          >
            <ClipboardCheck className="w-4 h-4" />
            Monthly Close
          </button>
        </div>
      </div>

      {/* Cash Position Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/ops/finance/ar" className="block bg-surface rounded-lg shadow p-6 border-l-4 border-[#0f2a3e] hover:shadow-lg transition-shadow cursor-pointer">
          <div className="text-fg-muted text-sm font-medium">Total AR (Outstanding)</div>
          <div className="text-2xl font-semibold text-fg mt-2">
            {canViewFinancials ? formatCurrency(data.cashPosition.totalAR) : restricted}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Accounts receivable due</p>
        </Link>

        <Link href="/ops/finance/ap" className="block bg-surface rounded-lg shadow p-6 border-l-4 border-signal hover:shadow-lg transition-shadow cursor-pointer">
          <div className="text-fg-muted text-sm font-medium">Total AP (Open)</div>
          <div className="text-2xl font-semibold text-fg mt-2">
            {canViewFinancials ? formatCurrency(data.cashPosition.totalAP) : restricted}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Accounts payable due</p>
        </Link>

        <Link href="/ops/finance/health" className={`block bg-surface rounded-lg shadow p-6 border-l-4 hover:shadow-lg transition-shadow cursor-pointer ${data.cashPosition.netCashPosition >= 0 ? 'border-data-positive' : 'border-data-negative'}`}>
          <div className="text-fg-muted text-sm font-medium">Net Cash Position</div>
          <div className={`text-2xl font-semibold mt-2 ${data.cashPosition.netCashPosition >= 0 ? 'text-data-positive' : 'text-data-negative'}`}>
            {canViewFinancials ? formatCurrency(data.cashPosition.netCashPosition) : restricted}
          </div>
          <p className="text-xs text-fg-subtle mt-2">AR - AP</p>
        </Link>

        <Link href="/ops/executive" className="block bg-surface rounded-lg shadow p-6 border-l-4 border-data-positive hover:shadow-lg transition-shadow cursor-pointer">
          <div className="text-fg-muted text-sm font-medium">Revenue This Year</div>
          <div className="text-2xl font-semibold text-fg mt-2">
            {canViewFinancials ? formatCurrency(data.cashPosition.revenueThisYear) : restricted}
          </div>
          <p className="text-xs text-fg-subtle mt-2">YTD revenue</p>
        </Link>
      </div>

      {/* Revenue Quick View */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-lg shadow p-4">
          <div className="text-fg-muted text-xs font-semibold mb-2">This Month</div>
          <div className="text-xl font-semibold text-fg">{canViewFinancials ? formatCurrency(data.cashPosition.revenueThisMonth) : restricted}</div>
        </div>
        <div className="bg-surface rounded-lg shadow p-4">
          <div className="text-fg-muted text-xs font-semibold mb-2">This Quarter</div>
          <div className="text-xl font-semibold text-fg">{canViewFinancials ? formatCurrency(data.cashPosition.revenueThisQuarter) : restricted}</div>
        </div>
        <div className="bg-surface rounded-lg shadow p-4">
          <div className="text-fg-muted text-xs font-semibold mb-2">YTD Average</div>
          <div className="text-xl font-semibold text-fg">
            {canViewFinancials ? formatCurrency(data.cashPosition.revenueThisYear / Math.max(new Date().getMonth() + 1, 1)) : restricted}
          </div>
        </div>
      </div>

      {/* AI Cash Flow Intelligence */}
      {cashFlowHealth && (
        <div className="bg-gradient-to-r from-[#0f2a3e] to-[#2E86C1] rounded-lg shadow p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧠</span>
              <h3 className="text-lg font-semibold">AI Cash Flow Intelligence</h3>
            </div>
            <Link
              href="/ops/cash-flow-optimizer"
              className="px-4 py-2 text-sm bg-white/20 hover:bg-white/30 rounded-lg transition-colors font-medium"
            >
              Open Command Center →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/70">Working Capital</p>
              <p className="text-lg font-bold">{canViewFinancials ? formatCurrency(cashFlowHealth.currentPosition?.workingCapital ?? 0) : <span className="text-white/40">••••••</span>}</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/70">DSO</p>
              <p className="text-2xl font-bold">{cashFlowHealth.metrics?.dso ?? '—'}<span className="text-sm"> days</span></p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/70">DPO</p>
              <p className="text-2xl font-bold">{cashFlowHealth.metrics?.dpo ?? '—'}<span className="text-sm"> days</span></p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/70">Cash Cycle</p>
              <p className="text-2xl font-bold">{cashFlowHealth.metrics?.ccc ?? '—'}<span className="text-sm"> days</span></p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/70">Current Ratio</p>
              <p className="text-2xl font-bold">{(cashFlowHealth.metrics?.currentRatio ?? 0).toFixed(1)}<span className="text-sm">x</span></p>
            </div>
          </div>
          {cashFlowHealth.recommendations && cashFlowHealth.recommendations.length > 0 && (
            <div className="mt-4 space-y-2">
              {cashFlowHealth.recommendations.slice(0, 3).map((rec: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-white/10 rounded px-3 py-2 text-sm">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                    rec.priority === 'CRITICAL' ? 'bg-red-500/30 text-red-200' :
                    rec.priority === 'HIGH' ? 'bg-orange-500/30 text-orange-200' :
                    'bg-yellow-500/30 text-yellow-200'
                  }`}>{rec.priority}</span>
                  <span className="text-white/90">{rec.description?.slice(0, 100)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AR Aging & AP Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AR Aging Visual */}
        <div className="bg-surface rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-fg mb-4">AR Aging Buckets</h3>
          <div className="space-y-4">
            {[
              {
                label: 'Current (0-30 days)',
                amount: data.arAging.current.amount,
                count: data.arAging.current.count,
                color: 'bg-green-500',
                bgColor: 'bg-green-100'
              },
              {
                label: '1-30 Days',
                amount: data.arAging.days1to30.amount,
                count: data.arAging.days1to30.count,
                color: 'bg-yellow-500',
                bgColor: 'bg-yellow-100'
              },
              {
                label: '31-60 Days',
                amount: data.arAging.days31to60.amount,
                count: data.arAging.days31to60.count,
                color: 'bg-orange-500',
                bgColor: 'bg-orange-100'
              },
              {
                label: '60+ Days (OVERDUE)',
                amount: data.arAging.days60plus.amount,
                count: data.arAging.days60plus.count,
                color: 'bg-red-500',
                bgColor: 'bg-red-100'
              },
            ].map((bucket) => {
              const total = data.arAging.current.amount + data.arAging.days1to30.amount + data.arAging.days31to60.amount + data.arAging.days60plus.amount
              const percentage = total > 0 ? (bucket.amount / total) * 100 : 0
              const bucketMap: { [key: string]: string } = {
                'Current (0-30 days)': 'current',
                '1-30 Days': '1-30',
                '31-60 Days': '31-60',
                '60+ Days (OVERDUE)': '60plus'
              }
              return (
                <div key={bucket.label} onClick={() => router.push(`/ops/finance/ar?aging=${bucketMap[bucket.label]}`)} className="cursor-pointer hover:shadow-md transition-shadow p-3 rounded-lg hover:bg-surface-muted">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-fg">{bucket.label}</div>
                      <div className="text-xs text-fg-muted">{bucket.count} invoices</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-fg">{canViewFinancials ? formatCurrency(bucket.amount) : <span className="text-fg-subtle" title="Admin access required">••••••</span>}</div>
                      <div className="text-xs text-fg-muted">{percentage.toFixed(0)}%</div>
                    </div>
                  </div>
                  <div className="w-full bg-surface-muted rounded-full h-3">
                    <div
                      className={`h-3 rounded-full ${bucket.color} transition-all`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* AP Summary */}
        <div className="bg-surface rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-fg mb-4">Open POs by Vendor</h3>
          {data.apSummary.length === 0 ? (
            <EmptyState
              icon={<DollarSign className="w-8 h-8 text-fg-subtle" />}
              title="No financial data yet"
              description="Open POs will appear here once vendors have outstanding balances."
              size="compact"
            />
          ) : (
            <>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {data.apSummary.slice(0, 8).map((vendor) => (
                  <div key={vendor.vendorId} className="flex items-center justify-between pb-3 border-b border-border last:border-b-0">
                    <div>
                      <div className="text-sm font-medium text-fg">{vendor.vendorName}</div>
                      <div className="text-xs text-fg-muted">{vendor.totalPOs} purchase orders</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-fg">{canViewFinancials ? formatCurrency(vendor.total) : <span className="text-fg-subtle" title="Admin access required">••••••</span>}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex justify-between items-center">
                  <div className="text-sm font-medium text-fg-muted">Total Open POs</div>
                  <div className="text-lg font-semibold text-signal">
                    {canViewFinancials ? formatCurrency(data.apSummary.reduce((sum, v) => sum + v.total, 0)) : restricted}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Monthly Revenue Trend */}
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-fg mb-4">Last 6 Months Revenue Trend</h3>
        <div className="space-y-4">
          {data.monthlyRevenue.map((month) => {
            const percentage = (month.amount / maxRevenue) * 100
            return (
              <div key={month.month}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-fg">{month.month}</span>
                  <span className="text-sm font-semibold text-fg">{canViewFinancials ? formatCurrency(month.amount) : <span className="text-fg-subtle" title="Admin access required">••••••</span>}</span>
                </div>
                <div className="w-full bg-surface-muted rounded-full h-3">
                  <div
                    className="h-3 rounded-full bg-gradient-to-r from-[#0f2a3e] to-signal transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top Builders by Revenue */}
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-fg mb-4">Top 10 Builders by Revenue</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b-2 border-border-strong">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-fg-muted">Builder Name</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted hidden sm:table-cell">Total Billed</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted hidden sm:table-cell">Total Paid</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted">Balance Due</th>
              </tr>
            </thead>
            <tbody>
              {data.topBuilders.slice(0, 10).map((builder, idx) => (
                <tr key={builder.builderId} onClick={() => router.push(`/ops/accounts/${builder.builderId}`)} className={`${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted'} hover:shadow-md transition-shadow cursor-pointer`}>
                  <td className="py-3 px-4 text-fg">{builder.builderName}</td>
                  <td className="text-right py-3 px-4 font-semibold text-fg hidden sm:table-cell">
                    {canViewFinancials ? formatCurrency(builder.totalBilled) : <span className="text-fg-subtle" title="Admin access required">••••••</span>}
                  </td>
                  <td className="text-right py-3 px-4 text-data-positive font-semibold hidden sm:table-cell">
                    {canViewFinancials ? formatCurrency(builder.totalPaid) : <span className="text-fg-subtle" title="Admin access required">••••••</span>}
                  </td>
                  <td className={`text-right py-3 px-4 font-semibold ${builder.balance > 0 ? 'text-data-negative' : 'text-data-positive'}`}>
                    {canViewFinancials ? formatCurrency(builder.balance) : <span className="text-fg-subtle" title="Admin access required">••••••</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alerts & Issues */}
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-fg mb-4">Financial Alerts</h3>
        {data.alerts.length === 0 ? (
          <div className="text-center py-8 text-fg-muted">
            <p>✓ No financial alerts at this time</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.alerts.map((alert, idx) => {
              const bgColor = alert.type === 'overdue' ? 'bg-red-50 border-red-200' : alert.type === 'unpaid' ? 'bg-orange-50 border-orange-200' : 'bg-yellow-50 border-yellow-200'
              const iconColor = alert.type === 'overdue' ? '🔴' : alert.type === 'unpaid' ? '🟠' : '🟡'
              const handleAlertClick = () => {
                if (alert.type === 'overdue') {
                  router.push('/ops/finance/ar?status=OVERDUE')
                } else if (alert.type === 'unpaid') {
                  router.push('/ops/invoices?status=UNPAID')
                } else if (alert.type === 'approval') {
                  router.push('/ops/purchasing')
                }
              }
              return (
                <div key={idx} onClick={handleAlertClick} className={`border rounded-lg p-4 ${bgColor} hover:shadow-md transition-shadow cursor-pointer`}>
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{iconColor}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{alert.message}</div>
                      <div className="text-sm text-gray-600 mt-1">{alert.count} items{canViewFinancials ? ` • ${formatCurrency(alert.value)}` : ''}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-gradient-to-r from-[#0f2a3e] to-[#0D2847] rounded-lg shadow p-6 text-white">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <button onClick={() => router.push('/ops/invoices')} className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded font-semibold transition">
            → Create Invoice
          </button>
          <button onClick={() => router.push('/ops/invoices')} className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded font-semibold transition">
            → Record Payment
          </button>
          <button onClick={() => router.push('/ops/purchasing')} className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded font-semibold transition">
            → Approve PO
          </button>
          <button onClick={() => router.push('/ops/cash-flow-optimizer')} className="bg-white/20 hover:bg-white/30 text-white py-3 px-4 rounded font-semibold transition">
            💸 Cash Flow Brain
          </button>
        </div>
      </div>
    </div>
  )
}
