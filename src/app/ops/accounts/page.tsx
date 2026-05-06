'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, RefreshCw, Users, Search, X } from 'lucide-react'
import {
  PageHeader, KPICard, Card, CardHeader, CardTitle, CardDescription, CardBody,
  DataTable, Badge, StatusBadge, EmptyState, AnimatedNumber, LiveDataIndicator,
  InfoTip,
} from '@/components/ui'
import { DrillLink } from '@/components/ui/DrillLink'
import { cn } from '@/lib/utils'

interface BuilderAccount {
  id: string
  companyName: string
  contactName: string
  email: string
  phone: string | null
  city: string | null
  state: string | null
  paymentTerm: string
  status: string
  creditLimit: number | null
  accountBalance: number
  createdAt: string
  organizationName?: string
  divisionName?: string
  _count: {
    projects: number
    orders: number
    customPricing: number
  }
}

const TERM_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
}

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000)    return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1000).toFixed(1)}K`
  return `$${Math.round(n)}`
}

export default function BuilderAccountsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlPage = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)

  const [builders, setBuilders] = useState<BuilderAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [termFilter, setTermFilter] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pmFilter, setPmFilter] = useState<string>('')
  const [pms, setPms] = useState<{ id: string; firstName: string; lastName: string }[]>([])
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPageState] = useState(urlPage)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)

  // Keep `?page=` in sync with state so the browser back button works.
  // Pushes a new history entry whenever the page changes.
  const setPage = (next: number | ((p: number) => number)) => {
    setPageState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      const target = Math.max(1, resolved || 1)
      if (target !== prev) {
        const params = new URLSearchParams(searchParams.toString())
        if (target === 1) params.delete('page')
        else params.set('page', String(target))
        const qs = params.toString()
        router.push(qs ? `/ops/accounts?${qs}` : '/ops/accounts', { scroll: false })
      }
      return target
    })
  }

  // React to browser back/forward (URL change) — keep state in sync with URL.
  useEffect(() => {
    setPageState((prev) => (prev === urlPage ? prev : urlPage))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPage])

  useEffect(() => {
    fetch('/api/ops/pm/roster')
      .then((r) => r.json())
      .then((d) => setPms(d.data || d.pms || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function load() {
      setRefreshing(true)
      try {
        const params = new URLSearchParams()
        if (search) params.append('search', search)
        if (statusFilter !== 'ALL') params.append('status', statusFilter)
        if (termFilter !== 'ALL') params.append('paymentTerm', termFilter)
        if (dateFrom) params.append('dateFrom', dateFrom)
        if (dateTo) params.append('dateTo', dateTo)
        if (pmFilter) params.append('pmId', pmFilter)
        params.append('sortBy', sortBy)
        params.append('sortDir', sortDir)
        params.append('page', page.toString())
        params.append('limit', '50')

        const resp = await fetch(`/api/ops/builders?${params.toString()}`)
        const data = await resp.json()
        setBuilders(data.builders || [])
        if (data.pagination) {
          setTotal(data.pagination.total)
          setTotalPages(data.pagination.pages)
        }
        setRefreshTick(Date.now())
      } catch (err) {
        console.error('Failed to load builders:', err)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }
    load()
  }, [search, statusFilter, termFilter, dateFrom, dateTo, pmFilter, sortBy, sortDir, page])

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  const activeCount = useMemo(() => builders.filter((b) => b.status === 'ACTIVE').length, [builders])
  const withPricing = useMemo(() => builders.filter((b) => b._count.customPricing > 0).length, [builders])

  const STATUSES = ['ALL', 'ACTIVE', 'PENDING', 'SUSPENDED', 'CLOSED']
  const TERMS = ['ALL', 'PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30']

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="CRM"
        title="Builder Accounts"
        description="Manage relationships, pricing programs, account health and exposure."
        actions={
          <>
            <button
              onClick={() => { setPage((p) => p) }}
              className="btn btn-secondary btn-sm"
              disabled={refreshing}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
            <button className="btn btn-primary btn-sm">
              <Plus className="w-3.5 h-3.5" /> Add Builder
            </button>
          </>
        }
      />

      {/* ── Summary KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Total Accounts"
          accent="brand"
          value={<AnimatedNumber value={total} />}
          subtitle={`${builders.length} on page`}
          icon={<Users className="w-3.5 h-3.5" />}
        />
        <KPICard
          title="Active"
          accent="positive"
          value={<AnimatedNumber value={activeCount} />}
          subtitle={`${total > 0 ? Math.round((activeCount / Math.max(1, builders.length)) * 100) : 0}% of page`}
        />
        <KPICard
          title="With Custom Pricing"
          accent="accent"
          value={<AnimatedNumber value={withPricing} />}
          subtitle="Pricing programs attached"
        />
        <KPICard
          title="Pagination"
          accent="neutral"
          value={`${page}/${totalPages}`}
          subtitle={`50 per page`}
        />
      </div>

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <Card variant="default" padding="md">
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search company, contact, email, city..."
                className="input w-full pl-8"
              />
            </div>
            <span className="text-xs text-fg-subtle tabular-nums whitespace-nowrap">
              {builders.length} / {total}
            </span>
          </div>

          {/* Status chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-fg-subtle uppercase tracking-wide mr-1">Status</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={cn(
                  'text-[11px] px-2 py-1 rounded-md transition-colors',
                  statusFilter === s
                    ? 'bg-accent text-fg-on-accent font-medium'
                    : 'text-fg-muted hover:bg-surface-muted'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-fg-subtle uppercase tracking-wide mr-1">Terms</span>
            {TERMS.map((t) => (
              <button
                key={t}
                onClick={() => { setTermFilter(t); setPage(1) }}
                className={cn(
                  'text-[11px] px-2 py-1 rounded-md transition-colors',
                  termFilter === t
                    ? 'bg-brand text-fg-on-accent font-medium'
                    : 'text-fg-muted hover:bg-surface-muted'
                )}
              >
                {t === 'ALL' ? 'ALL' : (TERM_LABELS[t] ?? t)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="label mb-0 whitespace-nowrap">PM</label>
            <select
              value={pmFilter}
              onChange={(e) => { setPmFilter(e.target.value); setPage(1) }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="">All PMs</option>
              {pms.map((pm) => (
                <option key={pm.id} value={pm.id}>
                  {pm.firstName} {pm.lastName}
                </option>
              ))}
            </select>
            <label className="label mb-0 whitespace-nowrap">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="input"
            />
            <label className="label mb-0 whitespace-nowrap">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="input"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
                className="btn btn-ghost btn-sm"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Data Table ────────────────────────────────────────────────── */}
      <DataTable
        density="default"
        data={builders}
        loading={loading}
        rowKey={(b) => b.id}
        sortBy={sortBy}
        sortDir={sortDir as any}
        onSort={toggleSort}
        keyboardNav
        empty={
          <EmptyState
            icon="users"
            title="No builders match your filters"
            description="Try widening date range or clearing the search."
            size="default"
            secondaryAction={{
              label: 'Clear filters',
              onClick: () => {
                setSearch('')
                setStatusFilter('ALL')
                setTermFilter('ALL')
                setDateFrom('')
                setDateTo('')
                setPmFilter('')
                setPage(1)
              },
            }}
          />
        }
        columns={[
          {
            key: 'companyName',
            header: 'Company',
            sortable: true,
            cell: (b) => (
              <DrillLink entity="builder" id={b.id} className="font-medium">
                {b.companyName}
              </DrillLink>
            ),
          },
          {
            key: 'contactName',
            header: 'Contact',
            sortable: true,
            cell: (b) => (
              <div>
                <div className="text-sm text-fg">{b.contactName}</div>
                <div className="text-xs text-fg-subtle truncate max-w-[220px]">{b.email}</div>
              </div>
            ),
          },
          {
            key: 'location',
            header: 'Location',
            hideOnMobile: true,
            cell: (b) =>
              b.city && b.state
                ? `${b.city}, ${b.state}`
                : b.city || b.state || <span className="text-fg-subtle">—</span>,
          },
          {
            key: 'organizationName',
            header: 'Org / Division',
            hideOnMobile: true,
            cell: (b) =>
              b.organizationName ? (
                <div>
                  <div className="text-sm text-fg">{b.organizationName}</div>
                  {b.divisionName && <div className="text-xs text-fg-subtle">{b.divisionName}</div>}
                </div>
              ) : (
                <span className="text-fg-subtle">—</span>
              ),
          },
          {
            key: 'paymentTerm',
            header: 'Terms',
            sortable: true,
            cell: (b) => (
              <Badge variant="neutral" size="sm">
                {TERM_LABELS[b.paymentTerm] || b.paymentTerm}
              </Badge>
            ),
          },
          {
            key: 'projects',
            header: 'Projects',
            numeric: true,
            hideOnMobile: true,
            cell: (b) => <span className="tabular-nums">{b._count.projects}</span>,
          },
          {
            key: 'orders',
            header: 'Orders',
            numeric: true,
            cell: (b) => <span className="tabular-nums">{b._count.orders}</span>,
          },
          {
            key: 'customPricing',
            header: 'Pricing',
            numeric: true,
            hideOnMobile: true,
            cell: (b) =>
              b._count.customPricing > 0 ? (
                <span className="tabular-nums text-accent font-medium">{b._count.customPricing}</span>
              ) : (
                <span className="text-fg-subtle">—</span>
              ),
          },
          {
            key: 'accountBalance',
            header: 'Balance',
            numeric: true,
            heatmap: true,
            heatmapValue: (b) => -(b.accountBalance || 0), // reversed: high = red
            cell: (b) => (
              <span
                className={cn(
                  'tabular-nums',
                  b.accountBalance > 0 ? 'text-data-negative' : 'text-fg-muted'
                )}
              >
                {fmtMoneyCompact(b.accountBalance)}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            sortable: true,
            cell: (b) => <StatusBadge status={b.status} size="sm" />,
          },
        ]}
      />

      {/* ── Pagination ────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="panel px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="text-xs text-fg-muted tabular-nums">
            Page {page} of {totalPages} · {total} total
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
