'use client'

import Link from 'next/link'
import { CreditCard, AlertCircle, ArrowRight, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Progress from '@/components/ui/Progress'

interface AccountHealthPanelProps {
  outstandingBalance: number
  creditAvailable: number
  creditLimit: number
  accountBalance: number
  overdueCount: number
  overdueAmount: number
  activeOrders: number
  paymentTerms: string
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

const statusConfig = {
  healthy: {
    icon: ShieldCheck,
    label: 'Healthy',
    badge: 'success' as const,
    barColor: 'green' as const,
    iconColor: 'text-success-600 dark:text-success-400',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Attention',
    badge: 'warning' as const,
    barColor: 'warning' as const,
    iconColor: 'text-warning-600 dark:text-warning-400',
  },
  critical: {
    icon: ShieldAlert,
    label: 'Critical',
    badge: 'danger' as const,
    barColor: 'danger' as const,
    iconColor: 'text-danger-600 dark:text-danger-400',
  },
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
}: AccountHealthPanelProps) {
  const healthStatus = getHealthStatus(accountBalance, creditLimit)
  const creditUsagePercent = creditLimit > 0 ? Math.round((accountBalance / creditLimit) * 100) : 0
  const config = statusConfig[healthStatus]
  const StatusIcon = config.icon

  return (
    <Card variant="default" padding="none" rounded="2xl" className="overflow-hidden animate-enter animate-enter-delay-2">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-gray-800 ${config.iconColor}`}>
            <StatusIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Account Health</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{paymentTerms}</p>
          </div>
        </div>
        <Badge variant={config.badge} size="md" dot>{config.label}</Badge>
      </div>

      {/* Metrics grid */}
      <div className="p-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Outstanding */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Outstanding</p>
            <p className={`text-xl font-bold ${outstandingBalance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-success-600 dark:text-success-400'}`}>
              {formatCurrency(outstandingBalance)}
            </p>
            {overdueCount > 0 && (
              <p className="text-xs text-danger-600 dark:text-danger-400 font-medium mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {overdueCount} overdue ({formatCurrency(overdueAmount)})
              </p>
            )}
          </div>

          {/* Credit Available */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Credit Available</p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400">
              {formatCurrency(creditAvailable)}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
              of {formatCurrency(creditLimit)}
            </p>
          </div>

          {/* Active Orders */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Active Orders</p>
            <p className="text-xl font-bold text-abel-walnut dark:text-abel-walnut-light">{activeOrders}</p>
          </div>

          {/* Account Balance */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Balance Used</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(accountBalance)}
            </p>
          </div>
        </div>

        {/* Credit Usage Bar */}
        {creditLimit > 0 && (
          <div className="mb-5">
            <Progress
              value={Math.min(100, creditUsagePercent)}
              label="Credit Usage"
              showValue
              color={config.barColor}
              size="md"
            />
          </div>
        )}

        {/* Action */}
        <Link
          href="/dashboard/invoices"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-abel-walnut dark:text-abel-walnut-light hover:text-abel-walnut-dark dark:hover:text-white transition-colors group"
        >
          View All Invoices
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </Card>
  )
}
