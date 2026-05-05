'use client'

/**
 * /ops/payments — Payments Hub
 *
 * FIX-3 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). Single page
 * showing every payment moving through Aegis — money in (builder
 * payments against invoices) and money out (vendor payments). Backed
 * by:
 *   GET /api/ops/payments               — incoming
 *   GET /api/ops/purchasing/payments    — outgoing (this commit)
 *
 * Tabs sit on top of shared filters (date range, method, search).
 * KPI strip summarizes the last 30 days (rolling), so the dollars in
 * the header always reflect "what just happened" rather than the
 * filtered view below.
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Receipt,
  Search,
  Plus,
  RefreshCw,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { RecordVendorPaymentModal } from '../components/RecordVendorPaymentModal'

const PAYMENT_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER'] as const

type Tab = 'incoming' | 'outgoing'

interface IncomingPayment {
  id: string
  invoiceId: string
  invoiceNumber?: string
  builderId?: string
  companyName?: string
  amount: number
  method: string
  reference?: string | null
  notes?: string | null
  receivedAt: string
}

interface OutgoingPayment {
  id: string
  vendorId: string
  purchaseOrderId: string | null
  amount: number
  method: string
  checkNumber: string | null
  reference: string | null
  memo: string | null
  paidAt: string
  vendor?: { id: string; name: string; code?: string | null } | null
  purchaseOrder?: { id: string; poNumber: string } | null
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function methodBadgeColor(m: string): string {
  switch (m) {
    case 'CHECK':
      return 'bg-blue-100 text-blue-700'
    case 'ACH':
    case 'WIRE':
      return 'bg-purple-100 text-purple-700'
    case 'CREDIT_CARD':
      return 'bg-green-100 text-green-700'
    case 'CASH':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export default function PaymentsHubPage() {
  const [tab, setTab] = useState<Tab>('incoming')
  const [methodFilter, setMethodFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [search, setSearch] = useState<string>('')

  const [incoming, setIncoming] = useState<IncomingPayment[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)

  // 30-day KPIs — independent of the filter state below
  const [kpis, setKpis] = useState<{
    in30: number
    out30: number
    countIn30: number
    countOut30: number
  } | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const inParams = new URLSearchParams()
      const outParams = new URLSearchParams()
      if (methodFilter) {
        inParams.set('method', methodFilter)
        outParams.set('method', methodFilter)
      }
      if (dateFrom) {
        inParams.set('startDate', dateFrom)
        outParams.set('dateFrom', dateFrom)
      }
      if (dateTo) {
        inParams.set('endDate', dateTo)
        outParams.set('dateTo', dateTo)
      }
      if (search) {
        outParams.set('search', search)
      }
      inParams.set('limit', '200')
      outParams.set('limit', '200')

      const [inRes, outRes] = await Promise.all([
        fetch(`/api/ops/payments?${inParams.toString()}`),
        fetch(`/api/ops/purchasing/payments?${outParams.toString()}`),
      ])
      if (inRes.ok) {
        const d = await inRes.json()
        setIncoming(d.payments || [])
      }
      if (outRes.ok) {
        const d = await outRes.json()
        setOutgoing(d.payments || [])
      }
      if (!inRes.ok && !outRes.ok) {
        setError('Failed to load payments')
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [methodFilter, dateFrom, dateTo, search])

  // 30-day KPI strip — fixed window, not filtered
  const fetchKpis = useCallback(async () => {
    const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const [inRes, outRes] = await Promise.all([
        fetch(`/api/ops/payments?startDate=${thirtyAgo}&limit=500`),
        fetch(`/api/ops/purchasing/payments?dateFrom=${thirtyAgo}&limit=500`),
      ])
      const inData = inRes.ok ? await inRes.json() : { payments: [] }
      const outData = outRes.ok ? await outRes.json() : { payments: [] }
      const ip: IncomingPayment[] = inData.payments || []
      const op: OutgoingPayment[] = outData.payments || []
      setKpis({
        in30: ip.reduce((s, p) => s + p.amount, 0),
        out30: op.reduce((s, p) => s + p.amount, 0),
        countIn30: ip.length,
        countOut30: op.length,
      })
    } catch {
      // ignore — KPI strip just won't render
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    fetchKpis()
  }, [fetchKpis])

  // Search applies client-side to the incoming list since the existing
  // /api/ops/payments doesn't expose a `search` param.
  const filteredIncoming = useMemo(() => {
    if (!search) return incoming
    const q = search.toLowerCase()
    return incoming.filter(
      (p) =>
        (p.invoiceNumber || '').toLowerCase().includes(q) ||
        (p.companyName || '').toLowerCase().includes(q) ||
        (p.reference || '').toLowerCase().includes(q),
    )
  }, [incoming, search])

  const tabPayments = tab === 'incoming' ? filteredIncoming : outgoing
  const totalForTab = tabPayments.reduce((s, p) => s + p.amount, 0)

  const netCashFlow = (kpis?.in30 || 0) - (kpis?.out30 || 0)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Finance"
        title="Payments"
        description="Every payment in and out of Aegis. Filter by method, date range, or search by reference."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Payments' },
        ]}
        actions={
          <button
            type="button"
            onClick={() => setRecordOpen(true)}
            className="btn btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Record Vendor Payment
          </button>
        }
      />

      {/* KPI strip — last 30 days */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI
            icon={<ArrowDownLeft className="w-4 h-4 text-data-positive" />}
            label="Incoming (30d)"
            value={formatCurrency(kpis.in30)}
            sub={`${kpis.countIn30} payment${kpis.countIn30 === 1 ? '' : 's'}`}
          />
          <KPI
            icon={<ArrowUpRight className="w-4 h-4 text-data-negative" />}
            label="Outgoing (30d)"
            value={formatCurrency(kpis.out30)}
            sub={`${kpis.countOut30} payment${kpis.countOut30 === 1 ? '' : 's'}`}
          />
          <KPI
            icon={<TrendingUp className="w-4 h-4 text-fg-muted" />}
            label="Net Cash Flow"
            value={formatCurrency(netCashFlow)}
            sub={netCashFlow >= 0 ? 'positive' : 'negative'}
            valueClassName={netCashFlow >= 0 ? 'text-data-positive' : 'text-data-negative'}
          />
          <KPI
            icon={<Receipt className="w-4 h-4 text-fg-muted" />}
            label="Avg Payment Size"
            value={formatCurrency(
              (kpis.countIn30 + kpis.countOut30) > 0
                ? (kpis.in30 + kpis.out30) / (kpis.countIn30 + kpis.countOut30)
                : 0,
            )}
            sub="incoming + outgoing"
          />
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-border -mx-4 px-4 -mt-4 pt-4">
          <button
            onClick={() => setTab('incoming')}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'incoming'
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            <ArrowDownLeft className="inline w-3.5 h-3.5 mr-1" />
            Incoming ({filteredIncoming.length})
          </button>
          <button
            onClick={() => setTab('outgoing')}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'outgoing'
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            <ArrowUpRight className="inline w-3.5 h-3.5 mr-1" />
            Outgoing ({outgoing.length})
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                fetchAll()
                fetchKpis()
              }}
              className="btn btn-ghost btn-xs"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === 'incoming'
                  ? 'Search by invoice #, builder, reference…'
                  : 'Search by reference, check #, memo…'
              }
              className="input pl-9 w-full"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="input min-w-[120px]"
          >
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input min-w-[140px]"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input min-w-[140px]"
            title="To date"
          />
          {(methodFilter || dateFrom || dateTo || search) && (
            <button
              onClick={() => {
                setMethodFilter('')
                setDateFrom('')
                setDateTo('')
                setSearch('')
              }}
              className="text-xs text-fg-subtle hover:text-fg"
            >
              Clear
            </button>
          )}
        </div>

        {/* Total of filtered */}
        <div className="text-xs text-fg-muted">
          {tabPayments.length} payment{tabPayments.length === 1 ? '' : 's'}
          {' · '}
          <span className="text-fg font-semibold tabular-nums">{formatCurrency(totalForTab)}</span>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading payments…
        </div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-data-negative/30 p-4 text-sm text-data-negative">
          {error}
        </div>
      ) : tabPayments.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          No payments match the current filters.
        </div>
      ) : tab === 'incoming' ? (
        <IncomingTable rows={filteredIncoming} />
      ) : (
        <OutgoingTable rows={outgoing} />
      )}

      <RecordVendorPaymentModal
        isOpen={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSuccess={() => {
          setRecordOpen(false)
          fetchAll()
          fetchKpis()
        }}
      />
    </div>
  )
}

function KPI({
  icon,
  label,
  value,
  sub,
  valueClassName,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  valueClassName?: string
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-fg-muted uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClassName || 'text-fg'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-fg-subtle mt-1">{sub}</div>}
    </div>
  )
}

function IncomingTable({ rows }: { rows: IncomingPayment[] }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted border-b border-border">
          <tr>
            <Th>Date</Th>
            <Th>Invoice</Th>
            <Th>Builder</Th>
            <Th>Method</Th>
            <Th>Reference</Th>
            <Th align="right">Amount</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-surface-muted/40">
              <Td>{formatDate(p.receivedAt)}</Td>
              <Td>
                {p.invoiceNumber ? (
                  <Link
                    href={`/ops/invoices/${p.invoiceId}`}
                    className="font-mono text-brand hover:underline"
                  >
                    {p.invoiceNumber}
                  </Link>
                ) : (
                  <span className="font-mono text-fg-subtle">{p.invoiceId.slice(0, 8)}</span>
                )}
              </Td>
              <Td>{p.companyName || '—'}</Td>
              <Td>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${methodBadgeColor(p.method)}`}
                >
                  {p.method.replace(/_/g, ' ')}
                </span>
              </Td>
              <Td>
                <span className="text-fg-muted text-[12px]">{p.reference || '—'}</span>
              </Td>
              <Td align="right">
                <span className="font-semibold tabular-nums">{formatCurrency(p.amount)}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OutgoingTable({ rows }: { rows: OutgoingPayment[] }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted border-b border-border">
          <tr>
            <Th>Date</Th>
            <Th>Vendor</Th>
            <Th>PO</Th>
            <Th>Method</Th>
            <Th>Reference</Th>
            <Th>Memo</Th>
            <Th align="right">Amount</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-surface-muted/40">
              <Td>{formatDate(p.paidAt)}</Td>
              <Td>
                {p.vendor ? (
                  <Link
                    href={`/ops/vendors/${p.vendor.id}`}
                    className="text-brand hover:underline"
                  >
                    {p.vendor.name}
                  </Link>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </Td>
              <Td>
                {p.purchaseOrder ? (
                  <Link
                    href={`/ops/purchasing/${p.purchaseOrder.id}`}
                    className="font-mono text-brand hover:underline"
                  >
                    {p.purchaseOrder.poNumber}
                  </Link>
                ) : (
                  <span className="text-fg-subtle text-xs italic">no PO</span>
                )}
              </Td>
              <Td>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${methodBadgeColor(p.method)}`}
                >
                  {p.method.replace(/_/g, ' ')}
                </span>
              </Td>
              <Td>
                <span className="text-fg-muted text-[12px]">
                  {p.method === 'CHECK' && p.checkNumber
                    ? `#${p.checkNumber}`
                    : p.reference || '—'}
                </span>
              </Td>
              <Td>
                <span className="text-fg-muted text-[12px] truncate max-w-[200px] inline-block">
                  {p.memo || '—'}
                </span>
              </Td>
              <Td align="right">
                <span className="font-semibold tabular-nums">{formatCurrency(p.amount)}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-4 py-2 text-[11px] font-semibold text-fg-muted uppercase tracking-wider ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''}`}>{children}</td>
  )
}
