'use client'

/**
 * Offset-based pagination control for portal lists.
 *
 * §4.2 Orders, §4.4 Catalog. Renders Prev / page-numbers / Next plus a
 * page-size dropdown. Keyboard friendly. The control is purely visual —
 * the parent owns the URL state (server pages re-fetch on navigation).
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PortalPaginationProps {
  page: number
  totalPages: number
  total: number
  limit: number
  onPageChange: (page: number) => void
  onLimitChange?: (limit: number) => void
  pageSizeOptions?: number[]
  className?: string
}

export function PortalPagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  pageSizeOptions = [20, 40, 60, 100],
  className,
}: PortalPaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  // Show 5 page numbers max, centered on current.
  const pageNumbers: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i)
  } else {
    pageNumbers.push(1)
    if (page > 3) pageNumbers.push('…')
    const lo = Math.max(2, page - 1)
    const hi = Math.min(totalPages - 1, page + 1)
    for (let i = lo; i <= hi; i++) pageNumbers.push(i)
    if (page < totalPages - 2) pageNumbers.push('…')
    pageNumbers.push(totalPages)
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 flex-wrap text-xs ${
        className ?? ''
      }`}
      style={{ color: 'var(--portal-text-muted, #6B6056)' }}
    >
      <div>
        Showing <span className="font-mono tabular-nums">{start}–{end}</span> of{' '}
        <span className="font-mono tabular-nums">{total}</span>
      </div>
      <div className="flex items-center gap-1">
        {onLimitChange && (
          <select
            value={limit}
            onChange={(e) => onLimitChange(parseInt(e.target.value, 10))}
            className="text-xs h-8 px-2 rounded mr-2"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
            aria-label="Page size"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="h-8 w-8 inline-flex items-center justify-center rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pageNumbers.map((p, i) =>
          p === '…' ? (
            <span
              key={`gap-${i}`}
              className="h-8 w-8 inline-flex items-center justify-center"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className="h-8 min-w-8 px-2 inline-flex items-center justify-center rounded text-xs font-medium transition-colors"
              style={
                p === page
                  ? {
                      background: 'var(--portal-walnut, #3E2A1E)',
                      color: 'white',
                    }
                  : {
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }
              }
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="h-8 w-8 inline-flex items-center justify-center rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
