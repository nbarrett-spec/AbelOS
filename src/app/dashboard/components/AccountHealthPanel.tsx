'use client'

import Link from 'next/link'
import { CreditCard, AlertCircle } from 'lucide-react'

interface AccountHealthPanelProps {
  outstandingBalance: number
  creditAvailable: number
  creditLimit: number
  accountBalance: number
  overdueCount: number
  overdueAmount: number
  activeOrders: number
  paymentTerms: string
  onInvoicesClick?: () => void
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function getHealthStatus(balance: number, limit: number): 'healthy' | 'warning' | 'critical' {
  if (limit === 0) return 'healthy'
  const usage = (balance / limit) * 100
  if (usage >= 85) return 'critical'
  if (usage >= 70) return 'warning'
  return 'healthy'
}

export default function AccountHealthPanel({
  outstandingBalance,
  creditAvailable,
  creditLimit,
  accountBalance,
  overdueCount,
  overdueAmount,
  activeOrders,
  paymentTerms,
  onInvoicesClick,
}: AccountHealthPanelProps) {
  const healthStatus = getHealthStatus(accountBalance, creditLimit)
  const creditUsagePercent = creditLimit > 0 ? (accountBalance / creditLimit) * 100 : 0

  const statusColor = {
    healthy: 'from-emerald-50 to-emerald-50/50 dark:from-emerald-950/30 dark:to-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30',
    warning:
      'from-amber-50 to-amber-50/50 dark:from-amber-950/30 dark:to-amber-950/20 border-amber-200/50 dark:border-amber-800/30',
    critical:
      'from-red-50 to-red-50/50 dark:from-red-950/30 dark:to-red-950/20 border-red-200/50 dark:border-red-800/30',
  }

  const statusBadge = {
    healthy: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300',
    warning: 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300',
    critical: 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300',
  }

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-6 transition-all ${statusColor[healthStatus]}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CreditCard className={`w-6 h-6 ${
            healthStatus === 'healthy'
              ? 'text-emerald-600 dark:text-emerald-400'
              : healthStatus === 'warning'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-600 dark:text-red-400'
          }`} />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Account Health</h3>
        </div>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${statusBadge[healthStatus]}`}>
          {healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'warning' ? 'Attention' : 'Critical'}
        </span>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Outstanding Balance */}
        <div className="bg-white/40 dark:bg-slate-800/30 rounded-xl p-4 backdrop-blur-sm border border-white/50 dark:border-slate-700/30">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
            Outstanding
          </p>
          <p className={`text-2xl font-bold ${
            outstandingBalance > 0
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-emerald-600 dark:text-emerald-400'
          }`}>
            {formatCurrency(outstandingBalance)}
          </p>
          {overdueCount > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 font-semibold mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {overdueCount} overdue
            </p>
          )}
        </div>

        {/* Credit Available */}
        <div className="bg-white/40 dark:bg-slate-800/30 rounded-xl p-4 backdrop-blur-sm border border-white/50 dark:border-slate-700/30">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
            Credit Available
          </p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(creditAvailable)}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            of {formatCurrency(creditLimit)} limit
          </p>
        </div>

        {/* Active Orders */}
        <div className="bg-white/40 dark:bg-slate-800/30 rounded-xl p-4 backdrop-blur-sm border border-white/50 dark:border-slate-700/30">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
            Active Orders
          </p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{activeOrders}</p>
        </div>

        {/* Payment Terms */}
        <div className="bg-white/40 dark:bg-slate-800/30 rounded-xl p-4 backdrop-blur-sm border border-white/50 dark:border-slate-700/30">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
            Terms
          </p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{paymentTerms}</p>
        </div>
      </div>

      {/* Credit Usage Bar */}
      {creditLimit > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Credit Usage</span>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
              {Math.round(creditUsagePercent)}%
            </span>
          </div>
          <div className="w-full bg-white/30 dark:bg-slate-800/50 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${
                healthStatus === 'healthy'
                  ? 'bg-emerald-500'
                  : healthStatus === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, creditUsagePercent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Action Link */}
      <Link
        href="/dashboard/invoices"
        className="inline-flex text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
      >
        View All Invoices →
      </Link>
    </div>
  )
}
