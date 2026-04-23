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
  DRAFT:          { label: 'Draft',          color: 'bg-surface-muted text-fg-muted',         icon: '✏️' },
  ISSUED:         { label: 'Issued',         color: 'bg-data-info-bg text-data-info-fg',      icon: '📄' },
  SENT:           { label: 'Sent',           color: 'bg-data-info-bg text-data-info-fg',      icon: '📨' },
  PARTIALLY_PAID: { label: 'Partial',        color: 'bg-data-warning-bg text-data-warning-fg',icon: '💰' },
  PAID:           { label: 'Paid',           color: 'bg-data-positive-bg text-data-positive-fg', icon: '✅' },
  OVERDUE:        { label: 'Overdue',        color: 'bg-data-negative-bg text-data-negative-fg', icon: '⚠️' },
  VOID:           { label: 'Void',           color: 'bg-surface-muted text-fg-muted',         icon: '🚫' },
  WRITE_OFF:      { label: 'Written Off',    color: 'bg-surface-muted text-fg-muted',         icon: '📝' },
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
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!builder) {
    return (
      <div className="text-center py-20">
        <p className="text-fg-muted">Please sign in to access your invoices.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Your invoices</h1>
          <p className="text-fg-muted text-sm">Review balances, track payments, and download PDFs.</p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-brand hover:underline font-medium"
        >
          ← Back to dashboard
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl border border-border p-5">
          <p className="text-xs text-fg-muted font-medium uppercase tracking-wide mb-1">Total outstanding</p>
          <p className="text-2xl font-bold text-fg">{fmt(summary?.totalOutstanding || 0)}</p>
          <p className="text-xs text-fg-subtle mt-1">{summary?.openCount || 0} open invoice{(summary?.openCount || 0) !== 1 ? 's' : ''}</p>
        </div>
        <div className={`bg-surface rounded-xl border p-5 ${(summary?.overdueAmount || 0) > 0 ? 'border-data-negative bg-data-negative-bg/40' : 'border-border'}`}>
          <p className="text-xs text-fg-muted font-medium uppercase tracking-wide mb-1">Overdue</p>
          <p className={`text-2xl font-bold ${(summary?.overdueAmount || 0) > 0 ? 'text-data-negative-fg' : 'text-fg-subtle'}`}>
            {fmt(summary?.overdueAmount || 0)}
          </p>
          <p className="text-xs text-fg-subtle mt-1">
            {(summary?.overdueCount || 0) > 0 ? `${summary?.overdueCount} invoice${(summary?.overdueCount || 0) !== 1 ? 's' : ''} past due` : 'Nothing overdue'}
          </p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-5">
          <p className="text-xs text-fg-muted font-medium uppercase tracking-wide mb-1">Paid this month</p>
          <p className="text-2xl font-bold text-data-positive-fg">{fmt(summary?.paidThisMonth || 0)}</p>
          <p className="text-xs text-fg-subtle mt-1">Current month</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-5">
          <p className="text-xs text-fg-muted font-medium uppercase tracking-wide mb-1">Total invoices</p>
          <p className="text-2xl font-bold text-fg">{summary?.totalInvoices || 0}</p>
          <p className="text-xs text-fg-subtle mt-1">{paidCount} paid</p>
        </div>
      </div>

      {/* Overdue Alert */}
      {(summary?.overdueCount || 0) > 0 && (
        <div className="mb-6 p-4 bg-data-negative-bg border border-data-negative rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-data-negative-fg">
                {summary?.overdueCount} overdue invoice{(summary?.overdueCount || 0) !== 1 ? 's' : ''} — {fmt(summary?.overdueAmount || 0)} total
              </p>
              <p className="text-xs text-data-negative-fg mt-0.5">Arrange payment to keep terms in place.</p>
            </div>
          </div>
          <button
            onClick={() => setTab('overdue')}
            className="px-4 py-2 bg-data-negative text-fg-on-accent text-xs font-semibold rounded-lg hover:opacity-90 transition"
          >
            View overdue
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 bg-surface-muted rounded-lg p-1 w-fit">
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
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg-muted'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                tab === t.key
                  ? t.key === 'overdue' ? 'bg-data-negative-bg text-data-negative-fg' : 'bg-brand-subtle text-accent-fg'
                  : 'bg-surface-muted text-fg-muted'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-data-negative-bg border border-data-negative rounded-lg flex items-center justify-between">
          <p className="text-data-negative-fg text-sm">{error}</p>
          <button onClick={fetchInvoices} className="text-xs font-semibold text-data-negative-fg underline">Retry</button>
        </div>
      )}

      {/* Invoice Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-6 h-6 mx-auto border-3 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">
              {tab === 'overdue' ? '✅' : tab === 'paid' ? '📄' : '📋'}
            </div>
            <h3 className="text-lg font-medium text-fg mb-1">
              {tab === 'overdue' ? 'Nothing overdue' : tab === 'paid' ? 'No paid invoices yet' : tab === 'open' ? 'No open invoices' : 'No invoices yet'}
            </h3>
            <p className="text-fg-muted text-sm">
              {tab === 'overdue'
                ? 'Account is current.'
                : 'Invoices appear here when they&apos;re issued.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-muted border-b border-border">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Invoice</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Order</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Issued</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Due</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Amount</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Balance</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(invoice => {
                  const balance = invoice.balanceDue > 0 ? invoice.balanceDue : Math.max(0, invoice.total - invoice.amountPaid)
                  const statusInfo = STATUS_COLORS[invoice.status] || { label: invoice.status, color: 'bg-surface-muted text-fg-muted', icon: '📄' }
                  const isExpanded = expandedId === invoice.id
                  const hasPayments = invoice.payments && invoice.payments.length > 0
                  const isOverdue = invoice.status === 'OVERDUE'
                  const overdueDays = isOverdue && invoice.dueDate ? daysOverdue(invoice.dueDate) : 0

                  return (
                    <Fragment key={invoice.id}>
                      <tr
                        className={`hover:bg-surface-muted transition cursor-pointer ${isOverdue ? 'bg-data-negative-bg/40' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : invoice.id)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="text-fg-subtle text-xs">{isExpanded ? '▾' : '▸'}</span>
                            <span className="text-sm font-mono font-semibold text-fg">{invoice.invoiceNumber}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {invoice.orderNumber ? (
                            <span className="text-sm text-fg-muted font-mono">{invoice.orderNumber}</span>
                          ) : (
                            <span className="text-sm text-fg-subtle">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-fg-muted">{fmtDate(invoice.issuedAt)}</td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm text-fg-muted">{fmtDate(invoice.dueDate)}</div>
                          {isOverdue && overdueDays > 0 && (
                            <div className="text-xs text-data-negative-fg font-medium">{overdueDays}d overdue</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-semibold text-fg text-right">{fmt(invoice.total)}</td>
                        <td className={`px-5 py-3.5 text-sm font-semibold text-right ${
                          balance <= 0 ? 'text-data-positive-fg' : isOverdue ? 'text-data-negative-fg' : 'text-accent'
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
                          <td colSpan={7} className="px-5 py-4 bg-surface-muted/80">
                            <div className="max-w-3xl">
                              {/* Payment progress */}
                              <div className="mb-4">
                                <div className="flex justify-between text-xs text-fg-muted mb-1">
                                  <span>Payment progress</span>
                                  <span>{invoice.total > 0 ? Math.round((invoice.amountPaid / invoice.total) * 100) : 0}%</span>
                                </div>
                                <div className="w-full bg-surface-muted rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${balance <= 0 ? 'bg-data-positive' : isOverdue ? 'bg-data-negative' : 'bg-accent'}`}
                                    style={{ width: `${Math.min(100, invoice.total > 0 ? (invoice.amountPaid / invoice.total) * 100 : 0)}%` }}
                                  />
                                </div>
                              </div>

                              {/* Detail grid */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                <div className="bg-surface rounded-lg border border-border px-3 py-2">
                                  <p className="text-xs text-fg-subtle">Total</p>
                                  <p className="text-sm font-semibold text-fg">{fmt(invoice.total)}</p>
                                </div>
                                <div className="bg-surface rounded-lg border border-border px-3 py-2">
                                  <p className="text-xs text-fg-subtle">Paid</p>
                                  <p className="text-sm font-semibold text-data-positive-fg">{fmt(invoice.amountPaid)}</p>
                                </div>
                                <div className="bg-surface rounded-lg border border-border px-3 py-2">
                                  <p className="text-xs text-fg-subtle">Balance due</p>
                                  <p className={`text-sm font-semibold ${balance > 0 ? 'text-accent' : 'text-data-positive-fg'}`}>
                                    {balance > 0 ? fmt(balance) : 'Paid in full'}
                                  </p>
                                </div>
                                <div className="bg-surface rounded-lg border border-border px-3 py-2">
                                  <p className="text-xs text-fg-subtle">Terms</p>
                                  <p className="text-sm font-semibold text-fg-muted">{invoice.paymentTerm || '—'}</p>
                                </div>
                              </div>

                              {/* Payment history */}
                              <h4 className="text-sm font-semibold text-fg mb-2">Payment history</h4>
                              {hasPayments ? (
                                <div className="space-y-2 mb-4">
                                  {invoice.payments!.map(payment => (
                                    <div key={payment.id} className="flex items-center justify-between bg-surface rounded-lg border border-border px-4 py-2.5">
                                      <div className="flex items-center gap-3">
                                        <div className="w-7 h-7 rounded-full bg-data-positive-bg flex items-center justify-center">
                                          <span className="text-data-positive-fg text-xs">✓</span>
                                        </div>
                                        <div>
                                          <p className="text-sm font-medium text-fg">{fmt(payment.amount)}</p>
                                          <p className="text-xs text-fg-muted">
                                            {PAYMENT_METHOD_LABELS[payment.paymentMethod] || payment.paymentMethod || 'Payment'}
                                            {payment.reference ? ` — Ref: ${payment.reference}` : ''}
                                          </p>
                                        </div>
                                      </div>
                                      <span className="text-xs text-fg-subtle">{fmtDate(payment.paymentDate)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-fg-subtle italic mb-4">No payments recorded yet.</p>
                              )}

                              {/* Balance due notice */}
                              {balance > 0 && (
                                <div className={`p-3 rounded-lg ${isOverdue ? 'bg-data-negative-bg border border-data-negative' : 'bg-data-info-bg border border-data-info'}`}>
                                  <p className={`text-xs ${isOverdue ? 'text-data-negative-fg' : 'text-data-info-fg'}`}>
                                    <strong>Balance due: {fmt(balance)}</strong>
                                    {isOverdue
                                      ? ` — ${overdueDays} days past due. Arrange payment to clear the flag.`
                                      : ` — Due by ${fmtDate(invoice.dueDate)}. Reach out with any questions.`}
                                  </p>
                                </div>
                              )}

                              {/* Actions */}
                              <div className="mt-4 pt-3 border-t border-border flex gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.open(`/api/invoices/${invoice.id}/pdf`, '_blank') }}
                                  className="px-4 py-1.5 bg-brand text-fg-on-accent text-xs font-medium rounded-lg hover:bg-brand-hover transition"
                                >
                                  Download PDF
                                </button>
                                {invoice.orderId && (
                                  <Link
                                    href={`/dashboard/orders/${invoice.orderId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="px-4 py-1.5 bg-surface text-brand border border-border text-xs font-medium rounded-lg hover:bg-surface-muted transition"
                                  >
                                    View order
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
      <div className="mt-6 p-4 bg-surface-muted border border-border rounded-xl flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-fg-muted">Question on an invoice?</p>
          <p className="text-xs text-fg-muted">Your Abel rep can handle payment questions or disputes directly.</p>
        </div>
        <Link
          href="/dashboard/messages"
          className="px-4 py-2 bg-accent text-fg-on-accent text-xs font-semibold rounded-lg hover:bg-accent-hover transition whitespace-nowrap"
        >
          Send a message
        </Link>
      </div>
    </div>
  )
}
