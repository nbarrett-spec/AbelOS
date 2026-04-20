'use client'

import { useState, useEffect, Fragment } from 'react'
import { useAuth } from '@/hooks/useAuth'
import Link from 'next/link'

interface Payment {
  id: string
  amount: number
  paymentDate: string
  paymentMethod: string
  reference?: string
}

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: string
  issuedAt: string
  paidAt: string | null
  createdAt: string
  orderNumber?: string
  orderId?: string
  paymentTerm?: string
  payments?: Payment[]
}

interface Summary {
  totalOutstanding: number
  overdueAmount: number
  overdueCount: number
  openCount: number
  paidThisMonth: number
  totalInvoices: number
}

const STATUS_COLORS: Record<string, { label: string; color: string; icon: string }> = {
  DRAFT:          { label: 'Draft',          color: 'bg-gray-100 text-gray-600',   icon: '✏️' },
  ISSUED:         { label: 'Issued',         color: 'bg-blue-100 text-blue-700',   icon: '📄' },
  SENT:           { label: 'Sent',           color: 'bg-blue-100 text-blue-700',   icon: '📨' },
  PARTIALLY_PAID: { label: 'Partial',        color: 'bg-yellow-100 text-yellow-700', icon: '💰' },
  PAID:           { label: 'Paid',           color: 'bg-green-100 text-green-700', icon: '✅' },
  OVERDUE:        { label: 'Overdue',        color: 'bg-red-100 text-red-700',     icon: '⚠️' },
  VOID:           { label: 'Void',           color: 'bg-gray-100 text-gray-500',   icon: '🚫' },
  WRITE_OFF:      { label: 'Written Off',    color: 'bg-gray-100 text-gray-500',   icon: '📝' },
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CHECK: 'Check',
  ACH: 'ACH Transfer',
  WIRE: 'Wire Transfer',
  CREDIT_CARD: 'Credit Card',
  CASH: 'Cash',
  OTHER: 'Other',
}

type TabFilter = 'all' | 'open' | 'overdue' | 'paid'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysOverdue(dueDateStr: string) {
  const due = new Date(dueDateStr)
  const now = new Date()
  const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

export default function InvoicesPage() {
  const { builder, loading: authLoading } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabFilter>('all')

  useEffect(() => {
    if (builder) fetchInvoices()
  }, [builder])

  async function fetchInvoices() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch('/api/invoices')
      if (res.ok) {
        const data = await res.json()
        setInvoices(data.invoices || [])
        setSummary(data.summary || null)
      } else {
        setError('Failed to load invoices')
      }
    } catch {
      setError('Error loading invoices')
    } finally {
      setLoading(false)
    }
  }

  const filtered = invoices.filter(inv => {
    if (tab === 'open') return !['PAID', 'VOID', 'WRITE_OFF'].includes(inv.status) && inv.status !== 'OVERDUE'
    if (tab === 'overdue') return inv.status === 'OVERDUE'
    if (tab === 'paid') return inv.status === 'PAID'
    return true
  })

  const openCount = invoices.filter(i => !['PAID', 'VOID', 'WRITE_OFF', 'OVERDUE'].includes(i.status) && (i.balanceDue > 0 || i.total - i.amountPaid > 0)).length
  const overdueCount = invoices.filter(i => i.status === 'OVERDUE').length
  const paidCount = invoices.filter(i => i.status === 'PAID').length

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!builder) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Please sign in to access your invoices.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2A4A]">Invoices & Payments</h1>
          <p className="text-gray-500 text-sm">View invoices, track payments, and manage your account</p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-[#3E2A1E] hover:underline font-medium"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Outstanding</p>
          <p className="text-2xl font-bold text-[#1B2A4A]">{fmt(summary?.totalOutstanding || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">{summary?.openCount || 0} open invoice{(summary?.openCount || 0) !== 1 ? 's' : ''}</p>
        </div>
        <div className={`bg-white rounded-xl border p-5 ${(summary?.overdueAmount || 0) > 0 ? 'border-red-300 bg-red-50/30' : 'border-gray-200'}`}>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Overdue</p>
          <p className={`text-2xl font-bold ${(summary?.overdueAmount || 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {fmt(summary?.overdueAmount || 0)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {(summary?.overdueCount || 0) > 0 ? `${summary?.overdueCount} invoice${(summary?.overdueCount || 0) !== 1 ? 's' : ''} past due` : 'No overdue invoices'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Paid This Month</p>
          <p className="text-2xl font-bold text-green-600">{fmt(summary?.paidThisMonth || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">Current month</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Invoices</p>
          <p className="text-2xl font-bold text-[#1B2A4A]">{summary?.totalInvoices || 0}</p>
          <p className="text-xs text-gray-400 mt-1">{paidCount} paid</p>
        </div>
      </div>

      {/* Overdue Alert */}
      {(summary?.overdueCount || 0) > 0 && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-red-800">
                You have {summary?.overdueCount} overdue invoice{(summary?.overdueCount || 0) !== 1 ? 's' : ''} totaling {fmt(summary?.overdueAmount || 0)}
              </p>
              <p className="text-xs text-red-600 mt-0.5">Please arrange payment to keep your account in good standing.</p>
            </div>
          </div>
          <button
            onClick={() => setTab('overdue')}
            className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition"
          >
            View Overdue
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'all' as TabFilter, label: 'All', count: invoices.length },
          { key: 'open' as TabFilter, label: 'Open', count: openCount },
          { key: 'overdue' as TabFilter, label: 'Overdue', count: overdueCount },
          { key: 'paid' as TabFilter, label: 'Paid', count: paidCount },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
              tab === t.key
                ? 'bg-white text-[#1B2A4A] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                tab === t.key
                  ? t.key === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-[#3E2A1E]/10 text-[#3E2A1E]'
                  : 'bg-gray-200 text-gray-500'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-red-700 text-sm">{error}</p>
          <button onClick={fetchInvoices} className="text-xs font-semibold text-red-700 underline">Retry</button>
        </div>
      )}

      {/* Invoice Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-6 h-6 mx-auto border-3 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">
              {tab === 'overdue' ? '✅' : tab === 'paid' ? '📄' : '📋'}
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              {tab === 'overdue' ? 'No overdue invoices' : tab === 'paid' ? 'No paid invoices yet' : tab === 'open' ? 'No open invoices' : 'No invoices yet'}
            </h3>
            <p className="text-gray-500 text-sm">
              {tab === 'overdue'
                ? 'Great — your account is up to date!'
                : 'Invoices will appear here when they are issued.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Order</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Issued</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Due</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Balance</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(invoice => {
                  const balance = invoice.balanceDue > 0 ? invoice.balanceDue : Math.max(0, invoice.total - invoice.amountPaid)
                  const statusInfo = STATUS_COLORS[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-600', icon: '📄' }
                  const isExpanded = expandedId === invoice.id
                  const hasPayments = invoice.payments && invoice.payments.length > 0
                  const isOverdue = invoice.status === 'OVERDUE'
                  const overdueDays = isOverdue && invoice.dueDate ? daysOverdue(invoice.dueDate) : 0

                  return (
                    <Fragment key={invoice.id}>
                      <tr
                        className={`hover:bg-gray-50 transition cursor-pointer ${isOverdue ? 'bg-red-50/30' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : invoice.id)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs">{isExpanded ? '▾' : '▸'}</span>
                            <span className="text-sm font-mono font-semibold text-[#1B2A4A]">{invoice.invoiceNumber}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {invoice.orderNumber ? (
                            <span className="text-sm text-gray-600 font-mono">{invoice.orderNumber}</span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-600">{fmtDate(invoice.issuedAt)}</td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm text-gray-600">{fmtDate(invoice.dueDate)}</div>
                          {isOverdue && overdueDays > 0 && (
                            <div className="text-xs text-red-600 font-medium">{overdueDays}d overdue</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-semibold text-gray-900 text-right">{fmt(invoice.total)}</td>
                        <td className={`px-5 py-3.5 text-sm font-semibold text-right ${
                          balance <= 0 ? 'text-green-600' : isOverdue ? 'text-red-600' : 'text-[#C9822B]'
                        }`}>
                          {balance <= 0 ? 'Paid' : fmt(balance)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="px-5 py-4 bg-gray-50/80">
                            <div className="max-w-3xl">
                              {/* Payment progress */}
                              <div className="mb-4">
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                  <span>Payment Progress</span>
                                  <span>{invoice.total > 0 ? Math.round((invoice.amountPaid / invoice.total) * 100) : 0}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${balance <= 0 ? 'bg-green-500' : isOverdue ? 'bg-red-500' : 'bg-[#C9822B]'}`}
                                    style={{ width: `${Math.min(100, invoice.total > 0 ? (invoice.amountPaid / invoice.total) * 100 : 0)}%` }}
                                  />
                                </div>
                              </div>

                              {/* Detail grid */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                <div className="bg-white rounded-lg border px-3 py-2">
                                  <p className="text-xs text-gray-400">Total</p>
                                  <p className="text-sm font-semibold text-gray-900">{fmt(invoice.total)}</p>
                                </div>
                                <div className="bg-white rounded-lg border px-3 py-2">
                                  <p className="text-xs text-gray-400">Paid</p>
                                  <p className="text-sm font-semibold text-green-600">{fmt(invoice.amountPaid)}</p>
                                </div>
                                <div className="bg-white rounded-lg border px-3 py-2">
                                  <p className="text-xs text-gray-400">Balance Due</p>
                                  <p className={`text-sm font-semibold ${balance > 0 ? 'text-[#C9822B]' : 'text-green-600'}`}>
                                    {balance > 0 ? fmt(balance) : 'Paid in Full'}
                                  </p>
                                </div>
                                <div className="bg-white rounded-lg border px-3 py-2">
                                  <p className="text-xs text-gray-400">Terms</p>
                                  <p className="text-sm font-semibold text-gray-700">{invoice.paymentTerm || '—'}</p>
                                </div>
                              </div>

                              {/* Payment history */}
                              <h4 className="text-sm font-semibold text-[#1B2A4A] mb-2">Payment History</h4>
                              {hasPayments ? (
                                <div className="space-y-2 mb-4">
                                  {invoice.payments!.map(payment => (
                                    <div key={payment.id} className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
                                      <div className="flex items-center gap-3">
                                        <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                                          <span className="text-green-600 text-xs">✓</span>
                                        </div>
                                        <div>
                                          <p className="text-sm font-medium text-gray-900">{fmt(payment.amount)}</p>
                                          <p className="text-xs text-gray-500">
                                            {PAYMENT_METHOD_LABELS[payment.paymentMethod] || payment.paymentMethod || 'Payment'}
                                            {payment.reference ? ` — Ref: ${payment.reference}` : ''}
                                          </p>
                                        </div>
                                      </div>
                                      <span className="text-xs text-gray-400">{fmtDate(payment.paymentDate)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-400 italic mb-4">No payments recorded yet</p>
                              )}

                              {/* Balance due notice */}
                              {balance > 0 && (
                                <div className={`p-3 rounded-lg ${isOverdue ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                                  <p className={`text-xs ${isOverdue ? 'text-red-700' : 'text-blue-700'}`}>
                                    <strong>Balance due: {fmt(balance)}</strong>
                                    {isOverdue
                                      ? ` — This invoice is ${overdueDays} days past due. Please arrange payment immediately.`
                                      : ` — Due by ${fmtDate(invoice.dueDate)}. Contact our sales team for questions.`}
                                  </p>
                                </div>
                              )}

                              {/* Actions */}
                              <div className="mt-4 pt-3 border-t flex gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.open(`/api/invoices/${invoice.id}/pdf`, '_blank') }}
                                  className="px-4 py-1.5 bg-[#3E2A1E] text-white text-xs font-medium rounded-lg hover:bg-[#163d59] transition"
                                >
                                  Download PDF
                                </button>
                                {invoice.orderId && (
                                  <Link
                                    href={`/dashboard/orders/${invoice.orderId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="px-4 py-1.5 bg-white text-[#3E2A1E] border border-[#3E2A1E]/30 text-xs font-medium rounded-lg hover:bg-[#3E2A1E]/5 transition"
                                  >
                                    View Order
                                  </Link>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Help footer */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Need help with an invoice?</p>
          <p className="text-xs text-gray-500">Contact your Abel Lumber account representative for payment questions or disputes.</p>
        </div>
        <Link
          href="/dashboard/messages"
          className="px-4 py-2 bg-[#C9822B] text-white text-xs font-semibold rounded-lg hover:bg-[#A86B1F] transition whitespace-nowrap"
        >
          Send a Message
        </Link>
      </div>
    </div>
  )
}
