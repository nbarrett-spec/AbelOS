'use client'

import Link from 'next/link'
import { User, Mail, Phone, MessageSquare, TrendingUp, Award } from 'lucide-react'

interface AccountRep {
  firstName: string
  lastName: string
  email: string
  phone: string
  title?: string
}

interface AccountSidebarProps {
  accountRep?: AccountRep | null
  paymentSummary?: {
    openInvoiceCount: number
    totalOutstanding: number
    overdueAmount: number
    paidLast30Days: number
  }
  lifetimeStats?: {
    totalOrders: number
    lifetimeValue: number
    last30DaysValue: number
    status: string
  }
  recentPayments?: Array<{
    id: string
    amount: number
    method: string
    invoiceNumber: string
    receivedAt: string
  }>
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatCurrencyFull(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n)
}

export default function AccountSidebar({
  accountRep,
  paymentSummary,
  lifetimeStats,
  recentPayments,
}: AccountSidebarProps) {
  return (
    <div className="space-y-6">
      {/* Account Rep Card */}
      {accountRep && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900/50 dark:to-blue-950/20 p-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Your Account Manager
          </h3>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white text-sm font-bold">
              {accountRep.firstName[0]}
              {accountRep.lastName[0]}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {accountRep.firstName} {accountRep.lastName}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">{accountRep.title || 'Account Manager'}</p>
            </div>
          </div>
          <div className="space-y-2.5 mb-4">
            {accountRep.email && (
              <a
                href={`mailto:${accountRep.email}`}
                className="flex items-center gap-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <Mail className="w-4 h-4" />
                {accountRep.email}
              </a>
            )}
            {accountRep.phone && (
              <a
                href={`tel:${accountRep.phone}`}
                className="flex items-center gap-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <Phone className="w-4 h-4" />
                {accountRep.phone}
              </a>
            )}
          </div>
          <Link
            href="/dashboard/messages"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 dark:bg-blue-600 text-white font-semibold text-sm transition-all hover:bg-blue-700 dark:hover:bg-blue-700 active:scale-95"
          >
            <MessageSquare className="w-4 h-4" />
            Send Message
          </Link>
        </div>
      )}

      {/* Payment Summary */}
      {paymentSummary && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <FileTextIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Payment Summary
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600 dark:text-gray-400">Open Invoices</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {paymentSummary.openInvoiceCount}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600 dark:text-gray-400">Total Outstanding</span>
              <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                {formatCurrencyFull(paymentSummary.totalOutstanding)}
              </span>
            </div>
            {paymentSummary.overdueAmount > 0 && (
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="text-xs text-red-600 dark:text-red-400 font-medium">Overdue</span>
                <span className="text-sm font-bold text-red-600 dark:text-red-400">
                  {formatCurrencyFull(paymentSummary.overdueAmount)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs text-gray-600 dark:text-gray-400">Paid (Last 30 days)</span>
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrencyFull(paymentSummary.paidLast30Days)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Payments */}
      {recentPayments && recentPayments.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Recent Payments</h3>
          <div className="space-y-3">
            {recentPayments.slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800 last:border-b-0">
                <div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">{p.invoiceNumber}</p>
                  <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5">
                    {p.method} · {new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">-{formatCurrencyFull(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lifetime Stats */}
      {lifetimeStats && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-slate-50/50 dark:from-slate-900/50 dark:to-slate-900/20 p-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Lifetime Stats
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600 dark:text-gray-400">Total Orders</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{lifetimeStats.totalOrders}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600 dark:text-gray-400">Lifetime Value</span>
              <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                {formatCurrency(lifetimeStats.lifetimeValue)}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
              <span className="text-xs text-gray-600 dark:text-gray-400">Last 30 Days</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {formatCurrency(lifetimeStats.last30DaysValue)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600 dark:text-gray-400">Account Status</span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
                {lifetimeStats.status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FileTextIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )
}
