'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  PageHeader,
  KPICard,
  Card,
  Button,
  DataTable,
  EmptyState,
} from '@/components/ui'
import { CreditCard } from 'lucide-react'

// FIX-2 — Payment Ledger / Check Register

interface PaymentRow {
  id: string
  amount: number
  method: string
  reference: string | null
  receivedAt: string
  notes: string | null
  invoiceId: string
  invoiceNumber: string
  builderId: string | null
  builderName: string | null
}

interface SummaryShape {
  totalCount: number
  totalAmount: number
  byMethod: Record<string, { count: number; total: number }>
}

const METHODS = [
  { value: '', label: 'All methods' },
  { value: 'CHECK', label: 'Check' },
  { value: 'ACH', label: 'ACH' },
  { value: 'WIRE', label: 'Wire' },
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Other' },
]

export default function PaymentLedgerPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [summary, setSummary] = useState<SummaryShape | null>(null)
  const [loading, setLoading] = useState(false)
  const [method, setMethod] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (method) params.set('method', method)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (q) params.set('q', q)
      const res = await fetch(`/api/ops/finance/payments?${params}`)
      if (res.ok) {
        const data = await res.json()
        setPayments(data.payments || [])
        setSummary(data.summary || null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [method, dateFrom, dateTo])

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US')

  function exportCsv() {
    const header = ['Date', 'Method', 'Reference', 'Builder', 'Invoice', 'Amount', 'Notes']
    const rows = payments.map((p) => [
      fmtDate(p.receivedAt),
      p.method,
      p.reference || '',
      p.builderName || '',
      p.invoiceNumber,
      p.amount.toFixed(2),
      (p.notes || '').replace(/[\r\n]+/g, ' '),
    ])
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1600px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Finance"
          title="Payment Ledger"
          description="Every recorded payment across all invoices. Filter by method, date range, builder, or reference number."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Finance', href: '/ops/finance' }, { label: 'Payments' }]}
          actions={<Button variant="ghost" size="sm" onClick={exportCsv} disabled={!payments.length}>Export CSV</Button>}
        />

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Total Payments" value={summary?.totalCount ?? '—'} accent="brand" />
          <KPICard title="Total Amount" value={summary ? fmtMoney(summary.totalAmount) : '—'} accent="positive" />
          <KPICard title="Checks" value={summary?.byMethod?.CHECK ? fmtMoney(summary.byMethod.CHECK.total) : '$0'} accent="neutral" />
          <KPICard title="ACH + Wire" value={summary ? fmtMoney((summary.byMethod?.ACH?.total || 0) + (summary.byMethod?.WIRE?.total || 0)) : '$0'} accent="neutral" />
        </div>

        {/* Filters */}
        <Card padding="md">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-fg-muted uppercase">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="input w-full text-sm mt-1"
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-fg-muted uppercase">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input w-full text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-fg-muted uppercase">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input w-full text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-fg-muted uppercase">Reference search</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  placeholder="Check # / invoice #"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && load()}
                  className="input flex-1 text-sm"
                />
                <Button size="sm" onClick={load}>Search</Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Results */}
        {payments.length === 0 && !loading ? (
          <EmptyState
            icon={<CreditCard />}
            title="No payments found"
            description="Try widening the filters or clearing them."
          />
        ) : (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              data={payments}
              rowKey={(r) => r.id}
              empty="No payments."
              columns={[
                { key: 'date', header: 'Date', cell: (r) => <span className="font-mono tabular-nums text-xs">{fmtDate(r.receivedAt)}</span> },
                { key: 'method', header: 'Method', cell: (r) => <span className="text-xs">{r.method}</span> },
                { key: 'ref', header: 'Reference', cell: (r) => <span className="font-mono text-xs">{r.reference || '—'}</span> },
                { key: 'builder', header: 'Builder', cell: (r) => r.builderId ? (
                  <Link href={`/ops/accounts/${r.builderId}`} className="hover:underline text-sm">{r.builderName}</Link>
                ) : <span className="text-fg-subtle">—</span> },
                { key: 'invoice', header: 'Invoice', cell: (r) => (
                  <Link href={`/ops/invoices/${r.invoiceId}`} className="hover:underline font-mono text-xs">{r.invoiceNumber}</Link>
                ) },
                { key: 'amount', header: 'Amount', numeric: true, cell: (r) => <span className="font-mono tabular-nums">{fmtMoney(r.amount)}</span> },
                { key: 'notes', header: 'Notes', cell: (r) => <span className="text-xs text-fg-muted line-clamp-1">{r.notes || ''}</span> },
              ]}
            />
          </Card>
        )}
      </div>
    </div>
  )
}
