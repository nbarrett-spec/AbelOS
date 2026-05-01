'use client'

/**
 * Builder Portal — Catalog client.
 *
 * §4.4 Catalog. Renders a search bar, category tabs, the product grid
 * (PortalProductCard wrapper for Magic UI's MagicCard), and pagination.
 *
 * URL is the source of truth: `?search=…&category=Doors&page=2`. Search
 * input is debounced 350ms before pushing the URL — same pattern as
 * orders.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Filter, Search, Sparkles, X } from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { PortalPagination } from '@/components/portal/PortalPagination'
import { PortalProductCard } from '@/components/portal/PortalProductCard'
import type { CatalogResponse } from '@/types/portal'

interface CatalogClientProps {
  initialData: CatalogResponse | null
  initialSearch: string
  initialCategory: string
  initialPage: number
  initialLimit: number
}

export function CatalogClient({
  initialData,
  initialSearch,
  initialCategory,
  initialPage,
  initialLimit,
}: CatalogClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialSearch)

  useEffect(() => {
    const t = setTimeout(() => {
      if (query === initialSearch) return
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      if (query) next.set('search', query)
      else next.delete('search')
      next.set('page', '1')
      router.push(`${pathname}?${next.toString()}`)
    }, 350)
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

  const products = initialData?.products ?? []
  const total = initialData?.total ?? 0
  const totalPages = initialData?.totalPages ?? 1
  const categories = useMemo(() => {
    const list = initialData?.categories ?? []
    return ['All', ...list]
  }, [initialData?.categories])
  const hasPricing = !!initialData?.hasPricing
  const tier = initialData?.pricingTier

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="portal-section-head">
        <div className="min-w-0">
          <div className="portal-eyebrow mb-2">Doors · Trim · Hardware</div>
          <h1 className="portal-page-title">Catalog</h1>
          <p
            className="text-[15px] mt-2"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            {hasPricing && tier ? (
              <>
                Showing your <strong>{tier}</strong> tier pricing.{' '}
                {total > 0 && (
                  <span style={{ color: 'var(--portal-text-subtle)' }}>
                    {total.toLocaleString()} products available.
                  </span>
                )}
              </>
            ) : total > 0 ? (
              `${total.toLocaleString()} products available.`
            ) : (
              'Browse our product catalog.'
            )}
          </p>
        </div>
        {hasPricing && (
          <div
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium"
            style={{
              background: 'rgba(201,130,43,0.12)',
              color: '#7A4E0F',
              border: '1px solid rgba(201,130,43,0.2)',
            }}
          >
            <Sparkles className="w-3 h-3" />
            Tier pricing applied
          </div>
        )}
      </div>

      {/* Search + categories */}
      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, SKU, or description…"
            className="h-10 w-full pl-10 pr-9 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
            aria-label="Search catalog"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full hover:bg-[var(--portal-bg-elevated)]"
              aria-label="Clear search"
            >
              <X
                className="w-3 h-3"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {categories.map((cat) => {
            const active = (initialCategory || 'All') === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() =>
                  updateParam((next) => {
                    if (cat === 'All') next.delete('category')
                    else next.set('category', cat)
                    next.set('page', '1')
                  })
                }
                className="h-8 px-3 rounded-full text-xs font-medium transition-colors"
                style={
                  active
                    ? {
                        background: 'var(--grad)',
                        color: 'white',
                        fontFamily: 'var(--font-portal-body)',
                      }
                    : {
                        background: 'var(--glass)',
                        backdropFilter: 'var(--glass-blur)',
                        WebkitBackdropFilter: 'var(--glass-blur)',
                        color: 'var(--portal-text-strong)',
                        border: '1px solid var(--glass-border)',
                        fontFamily: 'var(--font-portal-body)',
                      }
                }
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>

      {/* Grid / empty / loading */}
      {products.length === 0 ? (
        <PortalCard>
          <div
            className="px-6 py-16 text-center"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Filter
              className="w-10 h-10 mx-auto mb-3 opacity-30"
              aria-hidden="true"
            />
            <p
              className="text-base font-medium"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              No products match
            </p>
            <p className="text-sm mt-1 max-w-xs mx-auto">
              Try clearing the search or switching categories.
            </p>
          </div>
        </PortalCard>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {products.map((p) => (
            <PortalProductCard
              key={p.id}
              product={p}
              showBuilderPrice={hasPricing}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {products.length > 0 && totalPages > 1 && (
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
