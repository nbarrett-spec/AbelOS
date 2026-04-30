'use client'

/**
 * Builder Portal — Orders client.
 *
 * §4.2 Orders. Owns the URL state for filter/search/pagination, the
 * featured "in-flight" card (shows the most recent active order), and
 * the orders table.
 *
 * Data flow: server pre-fetches the first page; thereafter every URL
 * mutation triggers `router.push()` which the server re-renders against.
 * This keeps a single source of truth (URL) and lets share-by-link work.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronRight,
  FilePlus,
  Package,
  Search,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { PortalPagination } from '@/components/portal/PortalPagination'
import {
  PORTAL_STATUS_BADGE,
  PortalStatusBadge,
} from '@/components/portal/PortalStatusBadge'
import {
  PortalOrderTimeline,
  portalTimelineIndexForStatus,
} from '@/components/portal/PortalOrderTimeline'
import type { OrderSearchResponse, PortalOrder } from '@/types/portal'

interface OrdersClientProps {
  initialData: OrderSearchResponse | null
  initialQuery: string
  initialStatus: string
  initialPage: number
  initialLimit: number
}

const FILTER_TABS: { value: string; label: string }[] = [
  { value: '',              label: 'All' },
  { value: 'CONFIRMED',     label: 'Confirmed' },
  { value: 'IN_PRODUCTION', label: 'In Production' },
  { value: 'SHIPPED',       label: 'Shipped' },
  { value: 'DELIVERED',     label: 'Delivered' },
  { value: 'ON_HOLD',       label: 'On Hold' },
  { value: 'CANCELLED',     label: 'Cancelled' },
]

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export function OrdersClient({
  initialData,
  initialQuery,
  initialStatus,
  initialPage,
  initialLimit,
}: OrdersClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)

  // Debounce search box → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (query === initialQuery) return
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      if (query) next.set('q', query)
      else next.delete('q')
      next.set('page', '1')
      router.push(`${pathname}?${next.toString()}`)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const updateParam = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      mutate(next)
      router.push(`${pathname}?${next.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const orders = initialData?.orders ?? []
  const total = initialData?.total ?? 0
  const totalPages = initialData?.totalPages ?? 1

  // Featured = most recent order that's still active (not delivered/cancelled).
  const featured: PortalOrder | null = useMemo(() => {
    return (
      orders.find(
        (o) =>
          o.status !== 'DELIVERED' &&
          o.status !== 'CANCELLED' &&
          o.status !== 'ON_HOLD',
      ) ?? null
    )
  }, [orders])

  const showFeatured = featured && initialPage === 1 && !initialStatus && !initialQuery

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2
            className="text-2xl font-medium leading-tight"
            style={{
              fontFamily: 'var(--font-portal-display, Georgia)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              letterSpacing: '-0.02em',
            }}
          >
            Orders
          </h2>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            {total > 0
              ? `${total.toLocaleString()} order${total === 1 ? '' : 's'} on file`
              : 'No orders yet — start by submitting a quote.'}
          </p>
        </div>
        <Link
          href="/portal/quotes/new"
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
          style={{
            background:
              'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
            color: 'white',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <FilePlus className="w-3.5 h-3.5" />
          New Quote
        </Link>
      </div>

      {/* Featured "in-flight" card */}
      {showFeatured && featured && <FeaturedOrderCard order={featured} />}

      {/* Filter tabs + search */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_TABS.map((tab) => {
            const active = (initialStatus || '') === tab.value
            return (
              <button
                key={tab.value || 'all'}
                type="button"
                onClick={() =>
                  updateParam((next) => {
                    if (tab.value) next.set('status', tab.value)
                    else next.delete('status')
                    next.set('page', '1')
                  })
                }
                className="h-8 px-3 rounded-full text-xs font-medium transition-colors"
                style={
                  active
                    ? {
                        background: 'var(--portal-walnut, #3E2A1E)',
                        color: 'white',
                      }
                    : {
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }
                }
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by order # or product…"
            className="h-9 w-72 pl-9 pr-9 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
            aria-label="Search orders"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full hover:bg-[var(--portal-bg-elevated)]"
              aria-label="Clear search"
            >
              <X
                className="w-3 h-3"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              />
            </button>
          )}
        </div>
      </div>

      {/* Orders table */}
      <PortalCard noBodyPadding>
        {orders.length === 0 ? (
          <EmptyState query={initialQuery} status={initialStatus} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
                >
                  <th className="px-6 py-3 font-semibold">Order</th>
                  <th className="px-2 py-3 font-semibold">Items</th>
                  <th className="px-2 py-3 font-semibold">Total</th>
                  <th className="px-2 py-3 font-semibold">Status</th>
                  <th className="px-2 py-3 font-semibold">Placed</th>
                  <th className="px-6 py-3" aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const itemPreview = ((o as any).itemPreview ?? []) as
                    | string[]
                    | { name: string }[]
                  const previewText = Array.isArray(itemPreview)
                    ? itemPreview
                        .map((it) =>
                          typeof it === 'string' ? it : it?.name ?? '',
                        )
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(', ')
                    : ''
                  return (
                    <tr
                      key={o.id}
                      className="border-t group cursor-pointer transition-colors hover:bg-[var(--portal-bg-elevated)]"
                      style={{
                        borderColor: 'var(--portal-border-light, #F0E8DA)',
                      }}
                      onClick={() => router.push(`/portal/orders/${o.id}`)}
                    >
                      <td className="px-6 py-3 align-top">
                        <Link
                          href={`/portal/orders/${o.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-xs hover:underline"
                          style={{
                            color: 'var(--portal-text-strong, #3E2A1E)',
                          }}
                        >
                          {o.orderNumber}
                        </Link>
                        {previewText && (
                          <div
                            className="text-[11px] mt-0.5 line-clamp-1"
                            style={{
                              color: 'var(--portal-text-muted, #6B6056)',
                            }}
                          >
                            {previewText}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top">{o.itemCount}</td>
                      <td
                        className="px-2 py-3 font-mono tabular-nums align-top"
                        style={{
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      >
                        ${fmtUsd(o.total)}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <PortalStatusBadge status={o.status} />
                      </td>
                      <td
                        className="px-2 py-3 text-xs align-top"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      >
                        {relTime(o.createdAt)}
                      </td>
                      <td className="px-6 py-3 align-top text-right">
                        <ChevronRight
                          className="w-4 h-4 inline-block opacity-30 group-hover:opacity-100 transition-opacity"
                          style={{ color: 'var(--portal-walnut, #3E2A1E)' }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </PortalCard>

      {/* Pagination */}
      {orders.length > 0 && totalPages > 1 && (
        <PortalPagination
          page={initialPage}
          totalPages={totalPages}
          total={total}
          limit={initialLimit}
          onPageChange={(p) =>
            updateParam((next) => next.set('page', String(p)))
          }
          onLimitChange={(l) =>
            updateParam((next) => {
              next.set('limit', String(l))
              next.set('page', '1')
            })
          }
        />
      )}
    </div>
  )
}

function FeaturedOrderCard({ order }: { order: PortalOrder }) {
  const badge = PORTAL_STATUS_BADGE[order.status] || PORTAL_STATUS_BADGE.DRAFT
  return (
    <Link
      href={`/portal/orders/${order.id}`}
      className="block rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-amber,#C9822B)] focus-visible:ring-offset-2"
    >
      <div
        className="relative overflow-hidden rounded-[14px] p-5"
        style={{
          background:
            'linear-gradient(135deg, var(--portal-walnut, #3E2A1E), #4F3829)',
          color: 'white',
          boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(62,42,30,0.18))',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 20%, #C9822B 0, transparent 40%)',
          }}
        />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider opacity-70">
              In flight
            </div>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <h3
                className="text-xl font-semibold tabular-nums font-mono"
                style={{
                  fontFamily: 'var(--font-portal-mono, JetBrains Mono)',
                  letterSpacing: '-0.01em',
                }}
              >
                {order.orderNumber}
              </h3>
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: badge.bg, color: badge.fg }}
              >
                {badge.label}
              </span>
            </div>
            <div className="mt-1 text-sm opacity-80 flex items-center gap-3 flex-wrap">
              <span>{order.itemCount} items · ${fmtUsd(order.total)}</span>
              <span className="opacity-60">·</span>
              <span>{relTime(order.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Package className="w-4 h-4" />
            View details
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
        <div
          className="mt-5 -mx-1 rounded-md px-2 py-2"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <PortalOrderTimeline status={order.status} />
        </div>
      </div>
    </Link>
  )
}

function EmptyState({ query, status }: { query: string; status: string }) {
  if (query || status) {
    return (
      <div
        className="px-6 py-16 text-center"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        <Search
          className="w-8 h-8 mx-auto mb-3 opacity-30"
          aria-hidden="true"
        />
        <p
          className="text-base font-medium"
          style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
        >
          No orders match your filters
        </p>
        <p className="text-sm mt-1">Try clearing the search or filter tabs.</p>
      </div>
    )
  }
  return (
    <div
      className="px-6 py-16 text-center"
      style={{ color: 'var(--portal-text-muted, #6B6056)' }}
    >
      <Package
        className="w-10 h-10 mx-auto mb-3 opacity-30"
        aria-hidden="true"
      />
      <p
        className="text-base font-medium"
        style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
      >
        No orders yet
      </p>
      <p className="text-sm mt-1 max-w-xs mx-auto">
        When your first quote is approved, it&apos;ll show up here.
      </p>
      <Link
        href="/portal/quotes/new"
        className="inline-flex items-center gap-1.5 mt-4 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
        style={{
          background:
            'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
          color: 'white',
        }}
      >
        <FilePlus className="w-3.5 h-3.5" />
        Start a Quote
      </Link>
    </div>
  )
}

// Suppress unused-name lint when only the index helper is used elsewhere.
void portalTimelineIndexForStatus
