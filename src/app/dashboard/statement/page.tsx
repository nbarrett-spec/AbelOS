'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TX_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  order:   { icon: '📦', label: 'Order',   color: 'text-blue-700 bg-blue-50' },
  invoice: { icon: '💳', label: 'Invoice', color: 'text-orange-700 bg-orange-50' },
  payment: { icon: '💰', label: 'Payment', color: 'text-green-700 bg-green-50' },
}

export default function AccountStatementPage() {
  const { builder } = useAuth()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [months, setMonths] = useState(6)

  useEffect(() => {
    if (!builder) return
    setLoading(true)
    fetch(`/api/account/statement?months=${months}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [builder, months])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-fg-subtle">Loading account statement...</div>
  )

  const s = data?.summary || {}
  const transactions = data?.transactions || []
  const monthlyTotals = data?.monthlyTotals || []

  const creditUsed = Number(s.outstandingBalance) || 0
  const creditLimit = Number(s.creditLimit) || 0
  const creditPct = creditLimit > 0 ? Math.min(100, (creditUsed / creditLimit) * 100) : 0

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg">Account Statement</h1>
          <p className="text-sm text-fg-muted mt-1">{s.companyName} &middot; {s.contactName}</p>
        </div>
        <div className="flex items-center gap-2">
          {[3, 6, 12].map(m => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                months === m ? 'bg-brand text-white' : 'bg-surface dark:bg-surface-muted text-fg-muted border border-border-strong'
              }`}>
              {m}mo
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-fg-muted uppercase tracking-wider">Total Ordered</p>
          <p className="text-xl font-bold text-brand mt-1">{fmt(s.totalOrdered)}</p>
          <p className="text-xs text-fg-subtle mt-1">{s.orderCount} orders</p>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-fg-muted uppercase tracking-wider">Total Invoiced</p>
          <p className="text-xl font-bold text-accent mt-1">{fmt(s.totalInvoiced)}</p>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-fg-muted uppercase tracking-wider">Total Paid</p>
          <p className="text-xl font-bold text-green-600 mt-1">{fmt(s.totalPaid)}</p>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-fg-muted uppercase tracking-wider">Outstanding</p>
          <p className={`text-xl font-bold mt-1 ${Number(s.outstandingBalance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {fmt(s.outstandingBalance)}
          </p>
          {Number(s.overdueCount) > 0 && (
            <p className="text-xs text-red-500 mt-1">{s.overdueCount} overdue</p>
          )}
        </div>
      </div>

      {/* Credit Line */}
      {creditLimit > 0 && (
        <div className="bg-surface rounded-xl p-4 border border-border mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-fg-muted">Credit Utilization</p>
            <p className="text-sm text-fg-muted">
              {fmt(creditUsed)} of {fmt(creditLimit)} ({creditPct.toFixed(0)}%)
            </p>
          </div>
          <div className="w-full bg-surface-muted dark:bg-gray-600 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                creditPct > 80 ? 'bg-red-500' : creditPct > 50 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${creditPct}%` }}
            />
          </div>
          <p className="text-xs text-fg-subtle mt-2">Payment terms: {s.paymentTerm || 'N/A'}</p>
        </div>
      )}

      {/* Monthly Spending Mini-Chart */}
      {monthlyTotals.length > 0 && (
        <div className="bg-surface rounded-xl p-4 border border-border mb-6">
          <h3 className="text-sm font-semibold text-fg-muted mb-3">Monthly Order Volume</h3>
          <div className="flex items-end gap-2 h-28">
            {monthlyTotals.map((m: any) => {
              const maxTotal = Math.max(...monthlyTotals.map((x: any) => Number(x.total)))
              const pct = maxTotal > 0 ? (Number(m.total) / maxTotal) * 100 : 0
              const monthLabel = new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short' })
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center justify-end h-20">
                    <p className="text-[10px] text-fg-muted mb-1">{fmt(m.total)}</p>
                    <div
                      className="w-full max-w-[40px] bg-brand rounded-t-md transition-all"
                      style={{ height: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-fg-subtle">{monthLabel}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border dark:border-gray-600">
          <h3 className="text-sm font-semibold text-fg-muted">Transaction History</h3>
        </div>
        {transactions.length === 0 ? (
          <div className="py-12 text-center text-fg-subtle">No transactions in this period</div>
        ) : (
          <div className="divide-y divide-border dark:divide-border">
            {transactions.map((tx: any, i: number) => {
              const config = TX_CONFIG[tx.txType] || { icon: '📄', label: tx.txType, color: 'text-fg-muted bg-surface-muted' }
              return (
                <div key={`${tx.txType}-${tx.id}-${i}`} className="px-5 py-3 flex items-center gap-4 hover:bg-surface-muted dark:hover:bg-gray-700/50 transition">
                  <span className="text-xl flex-shrink-0">{config.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${config.color}`}>{config.label}</span>
                      <span className="text-sm font-medium text-fg">{tx.reference || tx.id?.slice(0, 8)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-fg-subtle">{fmtDate(tx.date)}</span>
                      {tx.detail && <span className="text-xs text-fg-subtle">{tx.detail}</span>}
                      {tx.status && tx.txType !== 'payment' && (
                        <span className="text-xs text-fg-subtle">{tx.status.replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${
                      tx.txType === 'payment' ? 'text-green-600' : 'text-fg'
                    }`}>
                      {tx.txType === 'payment' ? '-' : ''}{fmt(tx.amount)}
                    </p>
                    {tx.balanceDue !== undefined && Number(tx.balanceDue) > 0 && (
                      <p className="text-xs text-red-500">Due: {fmt(tx.balanceDue)}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="mt-6 flex gap-3 flex-wrap">
        <Link href="/dashboard/invoices" className="px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-[#163d59] transition">
          View Invoices
        </Link>
        <Link href="/dashboard/payments" className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-[#cf6f1e] transition">
          Make a Payment
        </Link>
        <Link href="/dashboard/orders" className="px-4 py-2 text-sm font-medium bg-surface dark:bg-surface-muted text-fg-muted border border-border-strong rounded-lg hover:bg-surface-muted transition">
          Order History
        </Link>
      </div>
    </div>
  )
}
