'use client'

// ──────────────────────────────────────────────────────────────────────────
// Vendor Payment History — /ops/finance/ap/payments
//
// Read-only ledger of every PO we've paid. Closes Dawn's gap: "show me
// every payment we've made to Boise Cascade this year." Companion to the
// AR-side /ops/finance/payments check register.
//
// Top:  filter bar (vendor / date range / search)
// Mid:  KPI strip — total paid · top vendor · count
// Body: Table — Date · Vendor · PO # · Amount · Status (mobile-responsive)
// Foot: PO # click → /ops/purchasing/[poId]
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Wallet, RefreshCw, Filter, Search, ExternalLink, Building, DollarSign,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  LiveDataIndicator,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface PaymentRow {
  id: string
  poNumber: string
  amount: number
  status: string
  method: string | null
  reference: string | null
  paidAt: string | null
  vendorId: string | null
  vendorName: string | null
}

interface VendorOption {
  id: string
  name: string
}

interface APPaymentsResponse {
  payments: PaymentRow[]
  summary: {
    totalPaid: number
    count: number
    topVendor: { vendorId: string; vendorName: string; total: number; count: number } | null
  }
  vendors: VendorOption[]
  filters: {
    vendorId: string | null
    dateFrom: string | null
    dateTo: string | null
    q: string | null
  }
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000) return `$${(n / 1000).toFixed(1)}K`
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n)
}

const fmtShortDate = (s: string | null) => {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
  })
}

// JetBrains Mono for money — matches the rest of /ops/finance.
const MONO_STYLE = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

// ── Page ─────────────────────────────────────────────────────────────────

export default function VendorPaymentHistoryPage() {
  const router = useRouter()
  const [data, setData] = useState<APPaymentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)

  // Filter state
  const [vendorId, setVendorId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [q, setQ] = useState<string>('')
  const [searchInput, setSearchInput] = useState<string>('')

  // Debounce search — Dawn types fast.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  // Refetch on any filter change.
  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, dateFrom, dateTo, q])

  async function fetchData() {
    setRefreshing(true)
    try {
      const params = new URLSearchParams()
      if (vendorId) params.set('vendorId', vendorId)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (q) params.set('q', q)
      params.set('limit', '500')

      const res = await fetch(`/api/ops/finance/ap/payments?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch vendor payments')
      const json: APPaymentsResponse = await res.json()
      setData(json)
      setRefreshTick(Date.now())
    } catch (err) {
      console.error('Vendor payments fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  function clearFilters() {
    setVendorId('')
    setDateFrom('')
    setDateTo('')
    setSearchInput('')
    setQ('')
  }

  const hasActiveFilters = useMemo(
    () => !!vendorId || !!dateFrom || !!dateTo || !!q,
    [vendorId, dateFrom, dateTo, q],
  )

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Finance · Accounts Payable"
          title="Vendor Payment History"
          description="Read-only ledger of every payment made on a purchase order."
        />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-48 skeleton rounded-lg" />
      </div>
    )
  }

  const summary = data.summary
  const selectedVendorName =
    data.vendors.find((v) => v.id === vendorId)?.name ?? null

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Finance · Accounts Payable"
        title="Vendor Payment History"
        description="Read-only ledger of every payment made on a purchase order."
        actions={
          <button
            onClick={fetchData}
            className="btn btn-secondary btn-sm"
            disabled={refreshing}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* KPI strip — totals reflect current filter set */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard
          title="Total Paid"
          value={<span style={MONO_STYLE}>{fmtMoneyCompact(summary.totalPaid)}</span>}
          subtitle={hasActiveFilters ? 'matching filters' : 'all-time'}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          accent="positive"
        />
        <KPICard
          title="Top Vendor"
          value={
            <span className="truncate block">
              {summary.topVendor?.vendorName ?? '—'}
            </span>
          }
          subtitle={
            summary.topVendor
              ? `${fmtMoneyCompact(summary.topVendor.total)} · ${summary.topVendor.count} PO${summary.topVendor.count === 1 ? '' : 's'}`
              : 'No payments yet'
          }
          icon={<Building className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Payments (filtered)"
          value={<span style={MONO_STYLE}>{summary.count.toLocaleString()}</span>}
          subtitle="purchase orders paid"
          icon={<Wallet className="w-3.5 h-3.5" />}
          accent="neutral"
        />
      </div>

      {/* Filter bar */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Filters</CardTitle>
            <CardDescription>
              Narrow by vendor, date range, or PO number.
            </CardDescription>
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn btn-ghost btn-xs">
              Clear all
            </button>
          )}
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] eyebrow text-fg-muted mb-1">Vendor</label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="input h-8 w-full text-[12px]"
              >
                <option value="">All vendors</option>
                {data.vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] eyebrow text-fg-muted mb-1">Date from</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input h-8 w-full text-[12px]"
              />
            </div>
            <div>
              <label className="block text-[10px] eyebrow text-fg-muted mb-1">Date to</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input h-8 w-full text-[12px]"
              />
            </div>
            <div>
              <label className="block text-[10px] eyebrow text-fg-muted mb-1">Search PO #</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-fg-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="PO-2026-..."
                  className="input h-8 w-full text-[12px] pl-7"
                />
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Ledger table */}
      <DataTable
        density="compact"
        data={data.payments}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/ops/purchasing/${r.id}`)}
        keyboardNav
        hint
        toolbar={
          <div className="flex items-center gap-3 w-full flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-fg-muted" />
              <span className="text-[11px] font-medium text-fg-muted">
                {hasActiveFilters ? 'Filtered' : 'All payments'}
              </span>
            </div>
            {selectedVendorName && (
              <Badge variant="neutral" size="xs">{selectedVendorName}</Badge>
            )}
            {(dateFrom || dateTo) && (
              <Badge variant="neutral" size="xs">
                {dateFrom || '…'} → {dateTo || '…'}
              </Badge>
            )}
            {q && <Badge variant="neutral" size="xs">"{q}"</Badge>}
            <div className="ml-auto text-[11px] text-fg-subtle">
              {data.payments.length.toLocaleString()} payment
              {data.payments.length === 1 ? '' : 's'}
              {data.payments.length === 500 && ' (showing first 500)'}
            </div>
          </div>
        }
        columns={[
          {
            key: 'paidAt', header: 'Date', sortable: true, width: '110px',
            cell: (r) => (
              <span className="text-fg-muted text-[12px]" style={MONO_STYLE}>
                {fmtShortDate(r.paidAt)}
              </span>
            ),
          },
          {
            key: 'vendorName', header: 'Vendor', sortable: true,
            cell: (r) => r.vendorId
              ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    router.push(`/ops/vendors/${r.vendorId}`)
                  }}
                  className="text-fg hover:text-brand hover:underline truncate max-w-[220px] text-left"
                >
                  {r.vendorName || 'Unknown'}
                </button>
              )
              : <span className="text-fg-subtle">—</span>,
          },
          {
            key: 'poNumber', header: 'PO #', sortable: true, width: '140px',
            cell: (r) => (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  router.push(`/ops/purchasing/${r.id}`)
                }}
                className="font-medium text-fg hover:text-brand hover:underline font-mono text-[12px]"
                style={MONO_STYLE}
              >
                {r.poNumber}
              </button>
            ),
          },
          {
            key: 'amount', header: 'Amount', numeric: true, sortable: true, heatmap: true,
            heatmapValue: (r) => r.amount,
            cell: (r) => (
              <span className="font-semibold tabular-nums" style={MONO_STYLE}>
                {fmtMoney(r.amount)}
              </span>
            ),
          },
          {
            key: 'status', header: 'Status', width: '140px',
            cell: (r) => <StatusBadge status={r.status} size="sm" />,
          },
        ]}
        rowActions={[
          {
            id: 'po',
            icon: <ExternalLink className="w-3.5 h-3.5" />,
            label: 'Open PO',
            shortcut: '↵',
            onClick: (r) => router.push(`/ops/purchasing/${r.id}`),
          },
          {
            id: 'vendor',
            icon: <Building className="w-3.5 h-3.5" />,
            label: 'Open vendor',
            onClick: (r) => r.vendorId && router.push(`/ops/vendors/${r.vendorId}`),
          },
        ]}
        empty={
          <EmptyState
            icon="document"
            size="compact"
            title={hasActiveFilters ? 'No payments match your filters' : 'No vendor payments yet'}
            description={
              hasActiveFilters
                ? 'Try widening the date range or clearing a filter.'
                : 'Once POs are marked paid in Accounts Payable, they will show here.'
            }
            secondaryAction={
              hasActiveFilters
                ? { label: 'Clear filters', onClick: clearFilters }
                : undefined
            }
          />
        }
      />
    </div>
  )
}
