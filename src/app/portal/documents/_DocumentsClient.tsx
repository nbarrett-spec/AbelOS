'use client'

/**
 * Builder Portal — Documents client.
 *
 * §4.9 Documents. Tab filter (All / Invoices / Statements / Quotes), unified
 * document list with type icon, document #, date, amount, status, and a
 * download button (opens PDF in new tab).
 *
 * Batch pay flow:
 *   1. Checkbox selection on invoice rows
 *   2. Sticky footer bar shows count + total + "Pay Selected"
 *   3. Click → confirmation modal with payment-method selector
 *      (ACH / Check / Credit Card / Wire — values the API accepts)
 *   4. Confirm → POST /api/invoices/batch-pay → success banner + reload
 *
 * Note: the spec mentions a Stripe redirect, but the current
 * `/api/invoices/batch-pay` endpoint records a Payment row directly
 * (no Stripe checkout). We surface the four enum-supported payment
 * methods instead.
 *
 * Statement rows are synthesized from the current month + prior month —
 * the underlying export endpoint (`/api/builder/statement/export`) takes
 * `?format=pdf&from=&to=` and is opened in a new tab.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Receipt,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PortalCard } from '@/components/portal/PortalCard'

export interface InvoiceRow {
  id: string
  invoiceNumber: string
  status: string
  total: number
  amountPaid: number
  balanceDue: number
  paymentTerm: string | null
  dueDate: string | null
  issuedAt: string | null
  paidAt: string | null
  createdAt: string
  orderNumber: string | null
  orderId: string | null
}

export interface QuoteRow {
  id: string
  quoteNumber: string
  total: number
  status: string
  validUntil: string | null
  createdAt: string
  projectName?: string | null
}

interface InvoiceSummary {
  totalOutstanding: number
  overdueAmount: number
  overdueCount: number
  openCount: number
  paidThisMonth: number
  totalInvoices: number
}

type Tab = 'all' | 'invoices' | 'statements' | 'quotes'

const INVOICE_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  DRAFT:      { bg: 'rgba(107,96,86,0.12)',  fg: '#5A4F46', label: 'Draft' },
  SENT:       { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Sent' },
  PAID:       { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Paid' },
  OVERDUE:    { bg: 'rgba(110,42,36,0.10)',   fg: '#7E2417', label: 'Overdue' },
  PARTIAL:    { bg: 'rgba(212,165,74,0.16)',  fg: '#7A5413', label: 'Partial' },
  VOID:       { bg: 'rgba(107,96,86,0.12)',   fg: '#5A4F46', label: 'Void' },
  WRITE_OFF:  { bg: 'rgba(107,96,86,0.12)',   fg: '#5A4F46', label: 'Write-off' },
}

const QUOTE_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  DRAFT:    { bg: 'rgba(107,96,86,0.12)',  fg: '#5A4F46', label: 'Draft' },
  SENT:     { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Sent' },
  APPROVED: { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Approved' },
  REJECTED: { bg: 'rgba(110,42,36,0.10)',   fg: '#7E2417', label: 'Rejected' },
  EXPIRED:  { bg: 'rgba(184,135,107,0.16)', fg: '#7A5A45', label: 'Expired' },
  ORDERED:  { bg: 'rgba(201,130,43,0.14)',  fg: '#7A4E0F', label: 'Ordered' },
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'all',        label: 'All' },
  { value: 'invoices',   label: 'Invoices' },
  { value: 'statements', label: 'Statements' },
  { value: 'quotes',     label: 'Quotes' },
]

function fmtUsd(n: number, dp = 2): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

function isOverdue(invoice: InvoiceRow): boolean {
  if (invoice.status === 'PAID' || invoice.status === 'VOID') return false
  if (invoice.balanceDue <= 0) return false
  if (!invoice.dueDate) return false
  return new Date(invoice.dueDate).getTime() < Date.now()
}

interface StatementRow {
  id: string
  label: string
  rangeFrom: string
  rangeTo: string
  date: string
}

function buildStatements(): StatementRow[] {
  const out: StatementRow[] = []
  const today = new Date()
  for (let i = 0; i < 3; i++) {
    const monthEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 0)
    const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1)
    out.push({
      id: `stmt-${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
      label: monthStart.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
      rangeFrom: monthStart.toISOString().slice(0, 10),
      rangeTo: monthEnd.toISOString().slice(0, 10),
      date: monthEnd.toISOString(),
    })
  }
  return out
}

interface DocumentsClientProps {
  invoices: InvoiceRow[]
  summary: InvoiceSummary | null
  quotes: QuoteRow[]
  initialTab: string
  paymentResult: string | null
}

export function DocumentsClient({
  invoices,
  summary,
  quotes,
  initialTab,
  paymentResult,
}: DocumentsClientProps) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(
    (TABS.find((t) => t.value === initialTab)?.value as Tab) ?? 'all',
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showPayModal, setShowPayModal] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [paySuccess, setPaySuccess] = useState<string | null>(
    paymentResult === 'success' ? 'Payment recorded successfully.' : null,
  )
  const [paymentMethod, setPaymentMethod] = useState<
    'ACH' | 'CHECK' | 'CREDIT_CARD' | 'WIRE'
  >('ACH')
  const [reference, setReference] = useState('')

  // Auto-clear success banner after 6s
  useEffect(() => {
    if (!paySuccess) return
    const t = setTimeout(() => setPaySuccess(null), 6_000)
    return () => clearTimeout(t)
  }, [paySuccess])

  const statements = useMemo(() => buildStatements(), [])

  const totals = useMemo(() => {
    let total = 0
    for (const id of selected) {
      const inv = invoices.find((i) => i.id === id)
      if (inv) total += inv.balanceDue > 0 ? inv.balanceDue : inv.total
    }
    return total
  }, [selected, invoices])

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirmPay() {
    if (paying || selected.size === 0) return
    setPaying(true)
    setPayError(null)
    try {
      const res = await fetch('/api/invoices/batch-pay', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: Array.from(selected),
          paymentMethod,
          reference: reference || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to record payment')
      }
      setShowPayModal(false)
      setSelected(new Set())
      setPaySuccess(
        `Payment recorded for ${selected.size} invoice${
          selected.size === 1 ? '' : 's'
        } via ${paymentMethod.replace('_', ' ').toLowerCase()}.`,
      )
      // Refresh server data
      router.refresh()
    } catch (e: any) {
      setPayError(e?.message || 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  // Build a unified list per tab
  type DocItem =
    | { kind: 'invoice'; data: InvoiceRow }
    | { kind: 'quote'; data: QuoteRow }
    | { kind: 'statement'; data: StatementRow }

  const items: DocItem[] = useMemo(() => {
    if (tab === 'invoices')
      return invoices.map((i) => ({ kind: 'invoice' as const, data: i }))
    if (tab === 'quotes')
      return quotes.map((q) => ({ kind: 'quote' as const, data: q }))
    if (tab === 'statements')
      return statements.map((s) => ({ kind: 'statement' as const, data: s }))
    return [
      ...invoices.map((i) => ({ kind: 'invoice' as const, data: i })),
      ...statements.map((s) => ({ kind: 'statement' as const, data: s })),
      ...quotes.map((q) => ({ kind: 'quote' as const, data: q })),
    ].sort((a, b) => {
      const da =
        a.kind === 'invoice'
          ? new Date(a.data.createdAt).getTime()
          : a.kind === 'quote'
            ? new Date(a.data.createdAt).getTime()
            : new Date(a.data.date).getTime()
      const db =
        b.kind === 'invoice'
          ? new Date(b.data.createdAt).getTime()
          : b.kind === 'quote'
            ? new Date(b.data.createdAt).getTime()
            : new Date(b.data.date).getTime()
      return db - da
    })
  }, [tab, invoices, quotes, statements])

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="portal-eyebrow mb-2">Invoices · Statements · Quotes</div>
          <h1 className="portal-page-title">Documents</h1>
          <p
            className="text-[15px] mt-2"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            Invoices, statements, and quote PDFs.
          </p>
        </div>
      </div>

      {/* Success banner */}
      {paySuccess && (
        <div
          className="px-4 py-3 rounded-md text-sm flex items-center gap-2"
          style={{
            background: 'rgba(56,128,77,0.10)',
            border: '1px solid rgba(56,128,77,0.3)',
            color: '#1A4B21',
          }}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{paySuccess}</span>
          <button
            type="button"
            onClick={() => setPaySuccess(null)}
            className="ml-auto p-0.5 rounded hover:bg-white/50"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryStat
            label="Outstanding"
            value={`$${fmtUsd(summary.totalOutstanding, 0)}`}
            sub={`${summary.openCount} open`}
            accent="var(--c1)"
          />
          <SummaryStat
            label="Overdue"
            value={`$${fmtUsd(summary.overdueAmount, 0)}`}
            sub={`${summary.overdueCount} invoices`}
            accent={summary.overdueCount > 0 ? '#7E2417' : 'var(--portal-text-muted, #6B6056)'}
          />
          <SummaryStat
            label="Paid This Month"
            value={`$${fmtUsd(summary.paidThisMonth, 0)}`}
            accent="var(--portal-success, #1A4B21)"
          />
          <SummaryStat
            label="Total Invoices"
            value={String(summary.totalInvoices)}
            accent="var(--c4)"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((t) => {
          const active = tab === t.value
          const count =
            t.value === 'invoices'
              ? invoices.length
              : t.value === 'quotes'
                ? quotes.length
                : t.value === 'statements'
                  ? statements.length
                  : invoices.length + quotes.length + statements.length
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className="h-8 px-3 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1.5"
              style={
                active
                  ? {
                      background: 'var(--c1)',
                      color: 'white',
                    }
                  : {
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                    }
              }
            >
              {t.label}
              <span
                className="text-[10px] tabular-nums opacity-70"
                style={{
                  background: active
                    ? 'rgba(255,255,255,0.18)'
                    : 'var(--portal-bg-elevated, #FAF5E8)',
                  padding: '0 6px',
                  borderRadius: 999,
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Document list */}
      <PortalCard noBodyPadding>
        {items.length === 0 ? (
          <div
            className="px-6 py-16 text-center text-sm"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <FileText
              className="w-10 h-10 mx-auto mb-3 opacity-30"
              aria-hidden="true"
            />
            No documents yet.
          </div>
        ) : (
          <ul>
            {items.map((item) => {
              if (item.kind === 'invoice')
                return (
                  <InvoiceItem
                    key={`inv-${item.data.id}`}
                    invoice={item.data}
                    selected={selected.has(item.data.id)}
                    onToggle={() => toggleSelect(item.data.id)}
                    showCheckbox={tab === 'all' || tab === 'invoices'}
                  />
                )
              if (item.kind === 'quote')
                return (
                  <QuoteItem key={`q-${item.data.id}`} quote={item.data} />
                )
              return (
                <StatementItem
                  key={`s-${item.data.id}`}
                  statement={item.data}
                />
              )
            })}
          </ul>
        )}
      </PortalCard>

      {/* Sticky pay-selected footer */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 print:hidden"
          style={{
            background: 'rgba(62,42,30,0.96)',
            color: 'var(--portal-cream, #F3EAD8)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 -4px 20px rgba(62,42,30,0.18)',
          }}
        >
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="text-sm font-medium">
                {selected.size} invoice{selected.size === 1 ? '' : 's'} selected
              </span>
              <span className="text-xs opacity-70 ml-2">
                · Total{' '}
                <span className="font-mono tabular-nums">
                  ${fmtUsd(totals)}
                </span>
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="px-3 h-9 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  color: 'white',
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setShowPayModal(true)}
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
                style={{
                  background:
                    'var(--grad)',
                  color: 'white',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                Pay Selected
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay confirmation modal */}
      {showPayModal && (
        <PayModal
          count={selected.size}
          total={totals}
          method={paymentMethod}
          setMethod={setPaymentMethod}
          reference={reference}
          setReference={setReference}
          paying={paying}
          error={payError}
          onCancel={() => {
            if (!paying) {
              setShowPayModal(false)
              setPayError(null)
            }
          }}
          onConfirm={handleConfirmPay}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function SummaryStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div
      className="rounded-[14px] p-4 relative overflow-hidden"
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: accent }}
      />
      <div className="pl-1.5">
        <div
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--portal-text-subtle)' }}
        >
          {label}
        </div>
        <div
          className="text-xl font-semibold tabular-nums mt-1"
          style={{
            fontFamily: 'var(--font-portal-display)',
            color: 'var(--portal-text-strong, #3E2A1E)',
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
        {sub && (
          <div
            className="text-[11px] mt-0.5"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}

function InvoiceItem({
  invoice,
  selected,
  onToggle,
  showCheckbox,
}: {
  invoice: InvoiceRow
  selected: boolean
  onToggle: () => void
  showCheckbox: boolean
}) {
  const overdue = isOverdue(invoice)
  const status = overdue && invoice.status !== 'OVERDUE' ? 'OVERDUE' : invoice.status
  const badge = INVOICE_BADGE[status] || INVOICE_BADGE.SENT
  const balance = invoice.balanceDue > 0 ? invoice.balanceDue : invoice.total
  const isPaid = invoice.status === 'PAID' || balance === 0
  const canSelect = !isPaid && !['VOID', 'WRITE_OFF'].includes(invoice.status)

  return (
    <li
      className="border-t flex items-center gap-3 px-4 md:px-6 py-3 transition-colors hover:bg-[var(--portal-bg-elevated)]"
      style={{
        borderColor: 'var(--portal-border-light, #F0E8DA)',
        borderLeft: overdue
          ? '3px solid var(--portal-oxblood, #6E2A24)'
          : undefined,
      }}
    >
      {showCheckbox && (
        <input
          type="checkbox"
          checked={selected}
          onChange={canSelect ? onToggle : undefined}
          disabled={!canSelect}
          className="w-4 h-4 shrink-0 disabled:opacity-30"
          style={{ accentColor: 'var(--c4)' }}
          aria-label={`Select ${invoice.invoiceNumber}`}
        />
      )}
      <div
        className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center"
        style={{
          background: 'rgba(140,168,184,0.16)',
          color: '#3D5A6A',
        }}
      >
        <FileText className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="font-mono text-xs font-medium"
            style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
          >
            {invoice.invoiceNumber}
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ background: badge.bg, color: badge.fg }}
          >
            {badge.label}
          </span>
          {invoice.orderNumber && (
            <span
              className="text-[11px]"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              · Order {invoice.orderNumber}
            </span>
          )}
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          Issued {fmtDate(invoice.issuedAt || invoice.createdAt)} · Due{' '}
          {fmtDate(invoice.dueDate)}
        </div>
      </div>
      <div className="text-right">
        <div
          className="text-sm font-mono tabular-nums"
          style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
        >
          ${fmtUsd(invoice.total)}
        </div>
        {balance > 0 && balance !== invoice.total && (
          <div
            className="text-[10px] tabular-nums"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Bal ${fmtUsd(balance)}
          </div>
        )}
      </div>
      <a
        href={`/api/invoices/${invoice.id}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center w-9 h-9 rounded-md transition-colors"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          color: 'var(--portal-text-strong, #3E2A1E)',
          border: '1px solid var(--portal-border, #E8DFD0)',
        }}
        title="Download PDF"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </li>
  )
}

function QuoteItem({ quote }: { quote: QuoteRow }) {
  const badge = QUOTE_BADGE[quote.status] || QUOTE_BADGE.DRAFT
  return (
    <li
      className="border-t flex items-center gap-3 px-4 md:px-6 py-3 transition-colors hover:bg-[var(--portal-bg-elevated)]"
      style={{ borderColor: 'var(--portal-border-light, #F0E8DA)' }}
    >
      <div
        className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center"
        style={{
          background: 'rgba(201,130,43,0.12)',
          color: '#7A4E0F',
        }}
      >
        <ClipboardList className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="font-mono text-xs font-medium"
            style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
          >
            {quote.quoteNumber}
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ background: badge.bg, color: badge.fg }}
          >
            {badge.label}
          </span>
          {quote.projectName && (
            <span
              className="text-[11px] truncate max-w-[260px]"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              · {quote.projectName}
            </span>
          )}
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          Issued {fmtDate(quote.createdAt)} · Valid {fmtDate(quote.validUntil)}
        </div>
      </div>
      <div
        className="text-sm font-mono tabular-nums"
        style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
      >
        ${fmtUsd(quote.total, 0)}
      </div>
      <a
        href={`/api/quotes/${quote.id}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center w-9 h-9 rounded-md transition-colors"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          color: 'var(--portal-text-strong, #3E2A1E)',
          border: '1px solid var(--portal-border, #E8DFD0)',
        }}
        title="Download PDF"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </li>
  )
}

function StatementItem({ statement }: { statement: StatementRow }) {
  return (
    <li
      className="border-t flex items-center gap-3 px-4 md:px-6 py-3 transition-colors hover:bg-[var(--portal-bg-elevated)]"
      style={{ borderColor: 'var(--portal-border-light, #F0E8DA)' }}
    >
      <div
        className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center"
        style={{
          background: 'rgba(62,42,30,0.10)',
          color: 'var(--c1)',
        }}
      >
        <Receipt className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-xs font-medium"
            style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
          >
            Statement — {statement.label}
          </span>
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          {fmtDate(statement.rangeFrom)} – {fmtDate(statement.rangeTo)}
        </div>
      </div>
      <a
        href={`/api/builder/statement/export?format=pdf&from=${statement.rangeFrom}&to=${statement.rangeTo}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center w-9 h-9 rounded-md transition-colors"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          color: 'var(--portal-text-strong, #3E2A1E)',
          border: '1px solid var(--portal-border, #E8DFD0)',
        }}
        title="Download statement PDF"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </li>
  )
}

function PayModal({
  count,
  total,
  method,
  setMethod,
  reference,
  setReference,
  paying,
  error,
  onCancel,
  onConfirm,
}: {
  count: number
  total: number
  method: 'ACH' | 'CHECK' | 'CREDIT_CARD' | 'WIRE'
  setMethod: (m: 'ACH' | 'CHECK' | 'CREDIT_CARD' | 'WIRE') => void
  reference: string
  setReference: (s: string) => void
  paying: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(62,42,30,0.30)' }}
      />
      <div
        className="relative max-w-md w-full rounded-[14px] p-5 space-y-4"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          border: '1px solid var(--portal-border, #E8DFD0)',
          boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(62,42,30,0.18))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={paying}
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--portal-bg-elevated)] disabled:opacity-40"
          aria-label="Close"
        >
          <X
            className="w-4 h-4"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          />
        </button>
        <div>
          <h3
            className="text-lg font-medium"
            style={{
              fontFamily: 'var(--font-portal-display)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          >
            Pay {count} invoice{count === 1 ? '' : 's'}
          </h3>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Total{' '}
            <span
              className="font-mono tabular-nums font-semibold"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              ${fmtUsd(total)}
            </span>
          </p>
        </div>

        <div>
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-2"
            style={{ color: 'var(--portal-text-subtle)' }}
          >
            Payment Method
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['ACH', 'CHECK', 'CREDIT_CARD', 'WIRE'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className="px-3 h-10 rounded-md text-xs font-medium transition-colors text-left"
                style={
                  method === m
                    ? {
                        background: 'var(--c1)',
                        color: 'white',
                      }
                    : {
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }
                }
              >
                {m === 'ACH' && 'ACH Transfer'}
                {m === 'CHECK' && 'Check'}
                {m === 'CREDIT_CARD' && 'Credit Card'}
                {m === 'WIRE' && 'Wire Transfer'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: 'var(--portal-text-subtle)' }}
          >
            Reference (optional)
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Check #, transaction ID, etc."
            className="h-9 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          />
        </div>

        {error && (
          <div
            className="px-3 py-2 rounded-md text-xs flex items-start gap-2"
            style={{
              background: 'rgba(110,42,36,0.08)',
              color: '#7E2417',
            }}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={paying}
            className="px-4 h-9 rounded-md text-sm font-medium transition-colors disabled:opacity-40"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={paying}
            className="inline-flex items-center gap-1.5 px-5 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-60"
            style={{
              background:
                'var(--grad)',
              color: 'white',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {paying ? 'Recording…' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
