'use client'

/**
 * /ops/my-book — Sales Rep "My Book"
 *
 * Audit item A-UX-7. Personal landing page for a sales rep showing every
 * builder they own, their open pipeline, and the last 30 days of activity.
 *
 * Builder ↔ rep mapping is materialized through Deal.ownerId + Deal.builderId
 * (the Builder model itself has no salesRepId). Backed by:
 *   GET /api/ops/my-book[?staffId=...]  — rep-scoped book data
 *
 * Reps always see their own book. ADMIN / MANAGER can pass ?staffId= via
 * the "Viewing as" picker in the header to inspect any rep's book.
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Users,
  BadgeDollarSign,
  FileText,
  AlertTriangle,
  Activity,
  Briefcase,
  Building2,
  Search,
  RefreshCw,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

type Tab = 'builders' | 'pipeline' | 'activity'

interface BookBuilder {
  id: string
  companyName: string
  contactName: string
  city: string | null
  state: string | null
  status: string
  paymentTerm: string
  creditLimit: number | null
  accountBalance: number
  ytdRevenue: number
  arBalance: number
  overdueAmount: number
  lastOrderDate: string | null
  openQuotes: number
}

interface BookDeal {
  id: string
  dealNumber: string
  companyName: string
  stage: string
  probability: number
  dealValue: number
  expectedCloseDate: string | null
  builderId: string | null
  updatedAt: string
}

interface ActivityItem {
  kind: 'ORDER' | 'QUOTE' | 'INVOICE'
  id: string
  refNumber: string
  builderId: string | null
  companyName: string
  amount: number
  status: string
  at: string
}

interface BookData {
  staff: {
    id: string
    firstName: string
    lastName: string
    email: string
    title: string | null
    role: string
  }
  asOf: string
  range: { from: string; to: string }
  viewer: { id: string; isAdmin: boolean }
  reps?: Array<{ id: string; firstName: string; lastName: string; email: string }>
  kpis: {
    totalBuilders: number
    activeBuilders: number
    ytdRevenue: number
    openQuotes: number
    overdueInvoices: number
    overdueAmount: number
  }
  builders: BookBuilder[]
  deals: BookDeal[]
  recentActivity: ActivityItem[]
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return formatCurrency(value)
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-700'
    case 'PENDING':
      return 'bg-amber-100 text-amber-700'
    case 'SUSPENDED':
      return 'bg-red-100 text-red-700'
    case 'CLOSED':
      return 'bg-gray-100 text-gray-600'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function stageBadgeColor(stage: string): string {
  switch (stage) {
    case 'PROSPECT':
      return 'bg-gray-100 text-gray-700'
    case 'DISCOVERY':
    case 'WALKTHROUGH':
      return 'bg-blue-100 text-blue-700'
    case 'BID_SUBMITTED':
    case 'BID_REVIEW':
      return 'bg-purple-100 text-purple-700'
    case 'NEGOTIATION':
      return 'bg-amber-100 text-amber-700'
    case 'WON':
    case 'ONBOARDED':
      return 'bg-green-100 text-green-700'
    case 'LOST':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function activityBadgeColor(kind: ActivityItem['kind']): string {
  switch (kind) {
    case 'ORDER':
      return 'bg-blue-100 text-blue-700'
    case 'QUOTE':
      return 'bg-purple-100 text-purple-700'
    case 'INVOICE':
      return 'bg-green-100 text-green-700'
  }
}

export default function MyBookPage() {
  const [tab, setTab] = useState<Tab>('builders')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [viewingStaffId, setViewingStaffId] = useState<string>('')

  const [data, setData] = useState<BookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBook = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (viewingStaffId) params.set('staffId', viewingStaffId)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      const qs = params.toString()
      const res = await fetch(`/api/ops/my-book${qs ? `?${qs}` : ''}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const d: BookData = await res.json()
      setData(d)
    } catch (e: any) {
      setError(e?.message || 'Failed to load My Book')
    } finally {
      setLoading(false)
    }
  }, [viewingStaffId, dateFrom, dateTo])

  useEffect(() => {
    fetchBook()
  }, [fetchBook])

  const filteredBuilders = useMemo(() => {
    if (!data?.builders) return []
    if (!search) return data.builders
    const q = search.toLowerCase()
    return data.builders.filter(
      (b) =>
        b.companyName.toLowerCase().includes(q) ||
        b.contactName.toLowerCase().includes(q) ||
        (b.city || '').toLowerCase().includes(q),
    )
  }, [data, search])

  const filteredDeals = useMemo(() => {
    if (!data?.deals) return []
    if (!search) return data.deals
    const q = search.toLowerCase()
    return data.deals.filter(
      (d) =>
        d.companyName.toLowerCase().includes(q) ||
        d.dealNumber.toLowerCase().includes(q),
    )
  }, [data, search])

  const filteredActivity = useMemo(() => {
    if (!data?.recentActivity) return []
    if (!search) return data.recentActivity
    const q = search.toLowerCase()
    return data.recentActivity.filter(
      (a) =>
        a.companyName.toLowerCase().includes(q) ||
        a.refNumber.toLowerCase().includes(q),
    )
  }, [data, search])

  const fullName = data?.staff
    ? `${data.staff.firstName} ${data.staff.lastName}`
    : 'My Book'
  const isViewingAs = !!viewingStaffId && data?.viewer?.id !== data?.staff?.id

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title={data?.staff ? `My Book — ${fullName}` : 'My Book'}
        description={
          data
            ? `${data.kpis.totalBuilders} builder${data.kpis.totalBuilders === 1 ? '' : 's'} in book · range ${data.range.from} → ${data.range.to}`
            : 'Your assigned builders, pipeline, and recent activity.'
        }
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'My Book' },
        ]}
        actions={
          data?.viewer?.isAdmin && data.reps && data.reps.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-muted uppercase tracking-wider">
                Viewing as
              </span>
              <select
                value={viewingStaffId || data.staff.id}
                onChange={(e) => {
                  // If admin picks themselves and they're the original viewer,
                  // unset the param so the API treats it as the default path.
                  setViewingStaffId(
                    e.target.value === data.viewer.id ? '' : e.target.value,
                  )
                }}
                className="input min-w-[180px]"
              >
                {data.reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.firstName} {r.lastName}
                  </option>
                ))}
              </select>
              {isViewingAs && (
                <button
                  type="button"
                  onClick={() => setViewingStaffId('')}
                  className="text-xs text-fg-subtle hover:text-fg"
                >
                  Reset
                </button>
              )}
            </div>
          ) : null
        }
      />

      {/* KPI strip */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPI
            icon={<Users className="w-4 h-4 text-fg-muted" />}
            label="Total Builders"
            value={data.kpis.totalBuilders.toLocaleString()}
            sub={`${data.kpis.activeBuilders} active`}
          />
          <KPI
            icon={<Building2 className="w-4 h-4 text-data-positive" />}
            label="Active Builders"
            value={data.kpis.activeBuilders.toLocaleString()}
            sub="status = ACTIVE"
          />
          <KPI
            icon={<BadgeDollarSign className="w-4 h-4 text-data-positive" />}
            label="YTD Revenue"
            value={formatCurrencyShort(data.kpis.ytdRevenue)}
            sub={`${data.range.from} → ${data.range.to}`}
          />
          <KPI
            icon={<FileText className="w-4 h-4 text-fg-muted" />}
            label="Open Quotes"
            value={data.kpis.openQuotes.toLocaleString()}
            sub="DRAFT + SENT"
          />
          <KPI
            icon={<AlertTriangle className="w-4 h-4 text-data-negative" />}
            label="Overdue Invoices"
            value={data.kpis.overdueInvoices.toLocaleString()}
            sub={formatCurrency(data.kpis.overdueAmount)}
            valueClassName={
              data.kpis.overdueInvoices > 0 ? 'text-data-negative' : 'text-fg'
            }
          />
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-border -mx-4 px-4 -mt-4 pt-4">
          <button
            onClick={() => setTab('builders')}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'builders'
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            <Building2 className="inline w-3.5 h-3.5 mr-1" />
            Builders ({data?.kpis.totalBuilders ?? 0})
          </button>
          <button
            onClick={() => setTab('pipeline')}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'pipeline'
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            <Briefcase className="inline w-3.5 h-3.5 mr-1" />
            Pipeline ({data?.deals.length ?? 0})
          </button>
          <button
            onClick={() => setTab('activity')}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'activity'
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            <Activity className="inline w-3.5 h-3.5 mr-1" />
            Recent Activity ({data?.recentActivity.length ?? 0})
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={fetchBook}
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
                tab === 'builders'
                  ? 'Search by company, contact, city…'
                  : tab === 'pipeline'
                    ? 'Search by deal # or company…'
                    : 'Search by reference or company…'
              }
              className="input pl-9 w-full"
            />
          </div>
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
          {(search || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setSearch('')
                setDateFrom('')
                setDateTo('')
              }}
              className="text-xs text-fg-subtle hover:text-fg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading book…
        </div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-data-negative/30 p-4 text-sm text-data-negative">
          {error}
        </div>
      ) : !data ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          No book data.
        </div>
      ) : tab === 'builders' ? (
        filteredBuilders.length === 0 ? (
          <EmptyHint
            title="No builders in your book yet"
            body="Builders show up here once a Deal you own is linked to a Builder record. Open the Sales Pipeline to set the builderId on any won/onboarded deal."
            cta={{ href: '/ops/sales', label: 'Sales Pipeline' }}
          />
        ) : (
          <BuildersTable rows={filteredBuilders} />
        )
      ) : tab === 'pipeline' ? (
        filteredDeals.length === 0 ? (
          <EmptyHint
            title="No open deals"
            body="Open deals (any stage except WON / LOST / ONBOARDED) you own will appear here."
            cta={{ href: '/ops/sales', label: 'Add Deal' }}
          />
        ) : (
          <PipelineTable rows={filteredDeals} />
        )
      ) : filteredActivity.length === 0 ? (
        <EmptyHint
          title="No activity in this date range"
          body="Orders, quotes, and invoices touching your builders show up here."
        />
      ) : (
        <ActivityTable rows={filteredActivity} />
      )}
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
        <span className="text-xs text-fg-muted uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClassName || 'text-fg'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-fg-subtle mt-1">{sub}</div>}
    </div>
  )
}

function EmptyHint({
  title,
  body,
  cta,
}: {
  title: string
  body: string
  cta?: { href: string; label: string }
}) {
  return (
    <div className="bg-white rounded-lg border p-8 text-center space-y-2">
      <div className="text-sm font-semibold text-fg">{title}</div>
      <p className="text-xs text-fg-muted max-w-md mx-auto">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="inline-block mt-2 text-xs text-brand hover:underline"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  )
}

function BuildersTable({ rows }: { rows: BookBuilder[] }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted border-b border-border">
          <tr>
            <Th>Company</Th>
            <Th>Status</Th>
            <Th>Last Order</Th>
            <Th align="right">YTD Revenue</Th>
            <Th align="right">AR Balance</Th>
            <Th align="right">Overdue</Th>
            <Th align="right">Open Quotes</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((b) => (
            <tr key={b.id} className="hover:bg-surface-muted/40">
              <Td>
                <Link
                  href={`/ops/accounts/${b.id}`}
                  className="text-brand hover:underline font-medium"
                >
                  {b.companyName}
                </Link>
                <div className="text-[11px] text-fg-subtle">
                  {b.contactName}
                  {b.city ? ` · ${b.city}${b.state ? `, ${b.state}` : ''}` : ''}
                </div>
              </Td>
              <Td>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusBadgeColor(b.status)}`}
                >
                  {b.status}
                </span>
              </Td>
              <Td>
                <span className="text-fg-muted text-[12px]">
                  {formatDate(b.lastOrderDate)}
                </span>
              </Td>
              <Td align="right">
                <span className="font-semibold tabular-nums">
                  {formatCurrency(b.ytdRevenue)}
                </span>
              </Td>
              <Td align="right">
                <span className="tabular-nums">{formatCurrency(b.arBalance)}</span>
              </Td>
              <Td align="right">
                <span
                  className={`tabular-nums ${b.overdueAmount > 0 ? 'text-data-negative font-semibold' : 'text-fg-subtle'}`}
                >
                  {b.overdueAmount > 0 ? formatCurrency(b.overdueAmount) : '—'}
                </span>
              </Td>
              <Td align="right">
                <span className="tabular-nums">{b.openQuotes || '—'}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PipelineTable({ rows }: { rows: BookDeal[] }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted border-b border-border">
          <tr>
            <Th>Deal #</Th>
            <Th>Company</Th>
            <Th>Stage</Th>
            <Th align="right">Probability</Th>
            <Th align="right">Value</Th>
            <Th>Expected Close</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((d) => (
            <tr key={d.id} className="hover:bg-surface-muted/40">
              <Td>
                <Link
                  href={`/ops/sales/deals/${d.id}`}
                  className="font-mono text-brand hover:underline text-[12px]"
                >
                  {d.dealNumber}
                </Link>
              </Td>
              <Td>
                {d.builderId ? (
                  <Link
                    href={`/ops/accounts/${d.builderId}`}
                    className="text-brand hover:underline"
                  >
                    {d.companyName}
                  </Link>
                ) : (
                  <span>{d.companyName}</span>
                )}
              </Td>
              <Td>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${stageBadgeColor(d.stage)}`}
                >
                  {d.stage.replace(/_/g, ' ')}
                </span>
              </Td>
              <Td align="right">
                <span className="tabular-nums">{d.probability}%</span>
              </Td>
              <Td align="right">
                <span className="font-semibold tabular-nums">
                  {formatCurrency(d.dealValue)}
                </span>
              </Td>
              <Td>
                <span className="text-fg-muted text-[12px]">
                  {formatDate(d.expectedCloseDate)}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivityTable({ rows }: { rows: ActivityItem[] }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted border-b border-border">
          <tr>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Reference</Th>
            <Th>Builder</Th>
            <Th>Status</Th>
            <Th align="right">Amount</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => {
            const href =
              a.kind === 'ORDER'
                ? `/ops/orders/${a.id}`
                : a.kind === 'QUOTE'
                  ? `/ops/quotes/${a.id}`
                  : `/ops/invoices/${a.id}`
            return (
              <tr key={`${a.kind}:${a.id}`} className="hover:bg-surface-muted/40">
                <Td>{formatDate(a.at)}</Td>
                <Td>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${activityBadgeColor(a.kind)}`}
                  >
                    {a.kind}
                  </span>
                </Td>
                <Td>
                  <Link
                    href={href}
                    className="font-mono text-brand hover:underline text-[12px]"
                  >
                    {a.refNumber}
                  </Link>
                </Td>
                <Td>
                  {a.builderId ? (
                    <Link
                      href={`/ops/accounts/${a.builderId}`}
                      className="text-brand hover:underline"
                    >
                      {a.companyName}
                    </Link>
                  ) : (
                    <span>{a.companyName}</span>
                  )}
                </Td>
                <Td>
                  <span className="text-fg-muted text-[12px]">
                    {a.status.replace(/_/g, ' ')}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(a.amount)}
                  </span>
                </Td>
              </tr>
            )
          })}
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
