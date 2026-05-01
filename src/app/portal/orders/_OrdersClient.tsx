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
      <div className="portal-section-head">
        <div className="min-w-0">
          <div className="portal-eyebrow mb-2">Order History</div>
          <h1 className="portal-page-title">Orders</h1>
          <p
            className="text-[15px] mt-2"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            {total > 0
              ? `${total.toLocaleString()} order${total === 1 ? '' : 's'} on file`
              : 'No orders yet — start by submitting a quote.'}
          </p>
        </div>
        <Link
          href="/portal/quotes/new"
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-sm font-medium transition-shadow"
          style={{
            background: 'var(--grad)',
            color: 'white',
            boxShadow: '0 6px 20px rgba(79,70,229,0.25)',
            fontFamily: 'var(--font-portal-body)',
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
                <tr className="text-left portal-meta-label">
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
                          className="portal-mono-data text-[13px] hover:underline"
                          style={{ color: 'var(--portal-text-strong)' }}
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
                      <td
                        className="px-2 py-3 align-top portal-mono-data text-[13px]"
                        style={{ color: 'var(--portal-text)' }}
                      >
                        {o.itemCount}
                      </td>
                      <td
                        className="px-2 py-3 portal-mono-data text-[15px] align-top"
                        style={{ color: 'var(--portal-text-strong)' }}
                      >
                        ${fmtUsd(o.total)}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <PortalStatusBadge status={o.status} />
                      </td>
                      <td
                        className="px-2 py-3 text-xs align-top portal-mono-data"
                        style={{ color: 'var(--portal-text-subtle)' }}
                      >
                        {relTime(o.createdAt)}
                      </td>
                      <td className="px-6 py-3 align-top text-right">
                        <ChevronRight
                          className="w-4 h-4 inline-block opacity-30 group-hover:opacity-100 transition-opacity"
                          style={{ color: 'var(--c1)' }}
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
      className="block rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c1)] focus-visible:ring-offset-2"
    >
      <div
        className="relative overflow-hidden rounded-[14px] p-5"
        style={{
          // Mockup-3 hero card — indigo gradient surface for the
          // featured in-flight order. Reads as "active / important"
          // against the warm canvas + glass cards around it.
          background:
            'linear-gradient(135deg, var(--c1) 0%, var(--c2) 50%, var(--c3) 100%)',
          color: 'white',
          boxShadow: '0 12px 40px rgba(79,70,229,0.25)',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.10] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 20%, #06B6D4 0, transparent 45%)',
          }}
        />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div
              className="text-[11px] uppercase opacity-80"
              style={{
                fontFamily: 'var(--font-portal-mono)',
                letterSpacing: '0.18em',
                fontWeight: 600,
              }}
            >
              In Flight
            </div>
            <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
              <h3
                className="text-xl portal-mono-data"
                style={{
                  letterSpacing: '0.04em',
                  fontWeight: 600,
                }}
              >
                {order.orderNumber}
              </h3>
              <span
                className="inline-flex items-center px-2.5 py-[3px] rounded-full uppercase"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  color: 'white',
                  fontFamily: 'var(--font-portal-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                }}
              >
                {badge.label}
              </span>
            </div>
            <div
              className="mt-2 text-sm opacity-90 flex items-center gap-3 flex-wrap"
              style={{ fontFamily: 'var(--font-portal-body)' }}
            >
              <span className="portal-mono-data">
                {order.itemCount} items · ${fmtUsd(order.total)}
              </span>
              <span className="opacity-70">·</span>
              <span className="portal-mono-data">{relTime(order.createdAt)}</span>
            </div>
          </div>
          <div
            className="flex items-center gap-2 text-xs"
            style={{ fontFamily: 'var(--font-portal-body)', fontWeight: 500 }}
          >
            <Package className="w-4 h-4" />
            View details
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
        <div
          className="mt-5 -mx-1 rounded-md px-2 py-2"
          style={{ background: 'rgba(255,255,255,0.08)' }}
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
            'var(--grad)',
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
