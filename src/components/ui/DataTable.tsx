'use client'

import { type ReactNode, type HTMLAttributes, useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc' | null

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  /** Render the cell — defaults to (row as any)[col.key] */
  cell?: (row: T, index: number) => ReactNode
  /** Right-align + tabular-nums */
  numeric?: boolean
  /** Sortable */
  sortable?: boolean
  /** Server-side sort key (defaults to col.key) */
  sortKey?: string
  /** CSS width value */
  width?: string
  /** Hide on mobile */
  hideOnMobile?: boolean
  /** Additional className for the column (applied to both th + td) */
  className?: string
  /** Apply subtle percentile-based heatmap shading to numeric values.
   *  Requires the column's cell() to return a number — or the cell value to be
   *  a number on the row when no cell renderer is provided. */
  heatmap?: boolean
  /** Raw value extractor for heatmap computation (optional). */
  heatmapValue?: (row: T) => number | null
}

export interface DataTableRowAction<T> {
  /** Unique id, e.g. 'edit', 'email' */
  id: string
  /** Icon element */
  icon: ReactNode
  /** Accessible label / tooltip */
  label: string
  /** Click handler */
  onClick: (row: T, index: number) => void
  /** Optional keyboard shortcut hint (e.g. 'E', 'M') — purely for tooltip */
  shortcut?: string
  /** Optional tone to color icon on hover */
  tone?: 'default' | 'danger'
  /** Show only for rows that pass this predicate */
  show?: (row: T) => boolean
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  /** Unique row id — defaults to row.id */
  rowKey?: (row: T, index: number) => string
  /** Row click handler */
  onRowClick?: (row: T, index: number) => void
  /** Currently selected row IDs (controlled) */
  selectedKeys?: Set<string>
  /** Density preset */
  density?: 'compact' | 'default' | 'comfortable'
  /** Current sort column */
  sortBy?: string
  sortDir?: SortDir
  /** Called when a sortable header is clicked */
  onSort?: (key: string) => void
  /** Loading state — renders skeleton rows */
  loading?: boolean
  skeletonRows?: number
  /** Empty state content */
  empty?: ReactNode
  /** Keyboard nav hint shown in an overline row above the table */
  hint?: boolean
  /** Rendered inside the sticky header on top */
  toolbar?: ReactNode
  /** Footer row (for totals, pagination, etc.) */
  footer?: ReactNode
  /** ClassName for the scrollable wrapper */
  className?: string
  /** Test id */
  'data-testid'?: string
  /** Inline row actions — fade in on row hover. Keyboard shortcuts trigger
   *  for the focused/selected row (Enter=click, then action.shortcut char) */
  rowActions?: DataTableRowAction<T>[]
  /** Enable keyboard row navigation (↑↓ / j/k, Enter to click) */
  keyboardNav?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────

function computePercentiles<T>(rows: T[], col: DataTableColumn<T>): Map<number, number> {
  const getter =
    col.heatmapValue ??
    ((r: T) => {
      const v = (r as any)[col.key]
      return typeof v === 'number' ? v : null
    })
  const values = rows.map(getter).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (values.length === 0) return new Map()
  const sorted = [...values].sort((a, b) => a - b)
  const pctByIdx = new Map<number, number>()
  rows.forEach((r, i) => {
    const v = getter(r)
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    // Find rank — equal values get equal percentile.
    const rank = sorted.indexOf(v)
    pctByIdx.set(i, sorted.length <= 1 ? 0.5 : rank / (sorted.length - 1))
  })
  return pctByIdx
}

/** Build a subtle bg color for a given percentile (0..1). */
function heatmapBg(pct: number): string {
  // Mid (.5) = transparent, high = positive tint, low = negative tint.
  // Cap alpha at 0.14 so values never feel garish on a dark canvas.
  if (pct >= 0.5) {
    const a = ((pct - 0.5) / 0.5) * 0.14
    return `rgba(67, 153, 79, ${a.toFixed(3)})` // data-green-400
  } else {
    const a = ((0.5 - pct) / 0.5) * 0.12
    return `rgba(182, 78, 61, ${a.toFixed(3)})` // data-red-400
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  selectedKeys,
  density = 'default',
  sortBy,
  sortDir,
  onSort,
  loading = false,
  skeletonRows = 6,
  empty,
  hint,
  toolbar,
  footer,
  className,
  rowActions,
  keyboardNav = true,
  ...props
}: DataTableProps<T>) {
  const getKey = (row: T, index: number): string => {
    if (rowKey) return rowKey(row, index)
    const id = (row as any)?.id
    return id != null ? String(id) : String(index)
  }

  // Precompute percentiles for heatmap columns once per render.
  const heatmapMaps: Record<string, Map<number, number>> = {}
  for (const col of columns) {
    if (col.heatmap) heatmapMaps[col.key] = computePercentiles(data, col)
  }

  // Keyboard nav state
  const [focusIdx, setFocusIdx] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!keyboardNav) return
    const isTyping = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA'
    if (isTyping) return
    // Only handle keys when user is focused on the table container or page
    if (data.length === 0) return

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      setFocusIdx(i => Math.min(data.length - 1, (i < 0 ? -1 : i) + 1))
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      setFocusIdx(i => Math.max(0, (i < 0 ? 0 : i) - 1))
    } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < data.length) {
      e.preventDefault()
      onRowClick?.(data[focusIdx], focusIdx)
    } else if (rowActions && focusIdx >= 0 && focusIdx < data.length) {
      const char = e.key.toLowerCase()
      const match = rowActions.find(a => a.shortcut?.toLowerCase() === char)
      if (match && (!match.show || match.show(data[focusIdx]))) {
        e.preventDefault()
        match.onClick(data[focusIdx], focusIdx)
      }
    }
  }, [data, focusIdx, keyboardNav, onRowClick, rowActions])

  useEffect(() => {
    if (!keyboardNav) return
    const el = containerRef.current
    if (!el) return
    // Only register when table is in viewport / focused.
    const onDocKey = (e: KeyboardEvent) => {
      if (!el.matches(':hover') && !el.contains(document.activeElement)) return
      handleKey(e)
    }
    document.addEventListener('keydown', onDocKey)
    return () => document.removeEventListener('keydown', onDocKey)
  }, [handleKey, keyboardNav])

  return (
    <div ref={containerRef} className={cn('panel overflow-hidden flex flex-col', className)} {...props}>
      {toolbar && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-surface">
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto scrollbar-thin">
        <table
          className={cn(
            'datatable',
            density === 'compact' && 'density-compact',
            density === 'comfortable' && 'density-comfortable',
            rowActions && 'has-row-actions',
          )}
        >
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = sortBy === (col.sortKey ?? col.key)
                const canSort = col.sortable && !!onSort
                return (
                  <th
                    key={col.key}
                    className={cn(
                      col.numeric && 'num',
                      col.hideOnMobile && 'hidden sm:table-cell',
                      col.className
                    )}
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    onClick={canSort ? () => onSort!(col.sortKey ?? col.key) : undefined}
                  >
                    <span className={cn(
                      'inline-flex items-center gap-1',
                      col.numeric && 'justify-end w-full',
                      canSort && 'cursor-pointer select-none'
                    )}>
                      {col.header}
                      {canSort && (
                        isSorted
                          ? sortDir === 'asc'
                            ? <ArrowUp className="w-3 h-3 text-accent" />
                            : <ArrowDown className="w-3 h-3 text-accent" />
                          : <ChevronsUpDown className="w-3 h-3 text-fg-subtle opacity-0 group-hover:opacity-100" />
                      )}
                    </span>
                  </th>
                )
              })}
              {rowActions && <th style={{ width: 1 }} aria-label="Actions" className="!bg-surface-muted" />}
            </tr>
          </thead>
          <tbody>
            {loading && data.length === 0 ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((col) => (
                    <td key={col.key} className={cn(col.numeric && 'num', col.hideOnMobile && 'hidden sm:table-cell')}>
                      <span className="skeleton block h-3.5 w-[70%]" />
                    </td>
                  ))}
                  {rowActions && <td />}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center py-12 text-fg-muted">
                  {empty ?? 'No results.'}
                </td>
              </tr>
            ) : (
              data.map((row, i) => {
                const k = getKey(row, i)
                const selected = selectedKeys?.has(k) ?? false
                const focused = focusIdx === i
                return (
                  <tr
                    key={k}
                    data-selected={selected || undefined}
                    data-focused={focused || undefined}
                    onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                    onMouseEnter={keyboardNav ? () => setFocusIdx(i) : undefined}
                    className={cn(onRowClick && 'cursor-pointer group/row')}
                  >
                    {columns.map((col) => {
                      const content = col.cell ? col.cell(row, i) : ((row as any)?.[col.key] ?? '—')
                      let bgStyle: React.CSSProperties | undefined
                      if (col.heatmap) {
                        const p = heatmapMaps[col.key]?.get(i)
                        if (typeof p === 'number') bgStyle = { backgroundColor: heatmapBg(p) }
                      }
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            col.numeric && 'num',
                            col.hideOnMobile && 'hidden sm:table-cell',
                            col.className,
                          )}
                          style={bgStyle}
                        >
                          {content}
                        </td>
                      )
                    })}
                    {rowActions && (
                      <td
                        className="row-actions-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="row-actions opacity-0 group-hover/row:opacity-100 group-[[data-focused=true]]/row:opacity-100 transition-opacity duration-fast flex items-center gap-0.5 justify-end pr-2">
                          {rowActions.filter(a => !a.show || a.show(row)).map(action => (
                            <button
                              key={action.id}
                              onClick={(e) => { e.stopPropagation(); action.onClick(row, i) }}
                              title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
                              aria-label={action.label}
                              className={cn(
                                'inline-flex items-center justify-center w-7 h-7 rounded-md',
                                'text-fg-subtle hover:bg-surface-muted',
                                action.tone === 'danger'
                                  ? 'hover:text-data-negative'
                                  : 'hover:text-accent',
                                'transition-colors',
                              )}
                            >
                              {action.icon}
                            </button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {hint && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 text-[11px] text-fg-subtle border-t border-border">
          <span className="kbd">↑↓</span>
          <span>navigate</span>
          <span className="kbd">↵</span>
          <span>open</span>
          {rowActions?.map(a => a.shortcut ? (
            <span key={a.id} className="inline-flex items-center gap-1">
              <span className="kbd">{a.shortcut}</span>
              <span>{a.label.toLowerCase()}</span>
            </span>
          ) : null)}
        </div>
      )}
    </div>
  )
}

export default DataTable
