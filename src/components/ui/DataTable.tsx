'use client'

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import Sparkline from './Sparkline'

// ── Aegis v2 "Drafting Room" DataTable ───────────────────────────────────
// Virtualized with @tanstack/react-virtual. Sticky mono-overline header.
// Gold active-sort underline. Row actions slide in on hover (120ms).
// Density-aware row heights via --density-row-height token.
// 80ms opacity content-fade on load.
// ─────────────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc' | null

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  cell?: (row: T, index: number) => ReactNode
  numeric?: boolean
  sortable?: boolean
  sortKey?: string
  width?: string
  hideOnMobile?: boolean
  className?: string
  heatmap?: boolean
  heatmapValue?: (row: T) => number | null
  /** Render as a Sparkline — expects number[] from the row */
  sparkline?: boolean
  sparklineValue?: (row: T) => number[] | null
}

export interface DataTableRowAction<T> {
  id: string
  icon: ReactNode
  label: string
  onClick: (row: T, index: number) => void
  shortcut?: string
  tone?: 'default' | 'danger'
  show?: (row: T) => boolean
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  rowKey?: (row: T, index: number) => string
  onRowClick?: (row: T, index: number) => void
  selectedKeys?: Set<string>
  density?: 'compact' | 'default' | 'comfortable'
  sortBy?: string
  sortDir?: SortDir
  onSort?: (key: string) => void
  loading?: boolean
  skeletonRows?: number
  empty?: ReactNode
  hint?: boolean
  toolbar?: ReactNode
  footer?: ReactNode
  className?: string
  'data-testid'?: string
  rowActions?: DataTableRowAction<T>[]
  keyboardNav?: boolean
  /** Turn on virtualization (default: true when data.length > 50) */
  virtualize?: boolean
  /** Viewport max-height for the scroll container */
  maxHeight?: number | string
}

const ROW_HEIGHT: Record<'compact' | 'default' | 'comfortable', number> = {
  compact: 32,
  default: 40,
  comfortable: 48,
}

function computePercentiles<T>(
  rows: T[],
  col: DataTableColumn<T>,
): Map<number, number> {
  const getter =
    col.heatmapValue ??
    ((r: T) => {
      const v = (r as unknown as Record<string, unknown>)[col.key]
      return typeof v === 'number' ? v : null
    })
  const values = rows
    .map(getter)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (values.length === 0) return new Map()
  const sorted = [...values].sort((a, b) => a - b)
  const out = new Map<number, number>()
  rows.forEach((r, i) => {
    const v = getter(r)
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    const rank = sorted.indexOf(v)
    out.set(i, sorted.length <= 1 ? 0.5 : rank / (sorted.length - 1))
  })
  return out
}

function heatmapBg(pct: number): string {
  if (pct >= 0.5) {
    const a = ((pct - 0.5) / 0.5) * 0.14
    return `rgba(67, 153, 79, ${a.toFixed(3)})`
  }
  const a = ((0.5 - pct) / 0.5) * 0.12
  return `rgba(182, 78, 61, ${a.toFixed(3)})`
}

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
  virtualize,
  maxHeight = 600,
  ...props
}: DataTableProps<T>) {
  const rowHeight = ROW_HEIGHT[density]
  const shouldVirtualize = virtualize ?? data.length > 50

  const getKey = useCallback(
    (row: T, index: number): string => {
      if (rowKey) return rowKey(row, index)
      const id = (row as unknown as Record<string, unknown>)?.id
      return id != null ? String(id) : String(index)
    },
    [rowKey],
  )

  const heatmapMaps = useMemo(() => {
    const out: Record<string, Map<number, number>> = {}
    for (const col of columns) {
      if (col.heatmap) out[col.key] = computePercentiles(data, col)
    }
    return out
  }, [columns, data])

  const [focusIdx, setFocusIdx] = useState<number>(-1)
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    enabled: shouldVirtualize,
  })

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!keyboardNav) return
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return
      if (data.length === 0) return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setFocusIdx((i) => Math.min(data.length - 1, (i < 0 ? -1 : i) + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setFocusIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1))
      } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < data.length) {
        e.preventDefault()
        onRowClick?.(data[focusIdx], focusIdx)
      } else if (rowActions && focusIdx >= 0 && focusIdx < data.length) {
        const char = e.key.toLowerCase()
        const match = rowActions.find((a) => a.shortcut?.toLowerCase() === char)
        if (match && (!match.show || match.show(data[focusIdx]))) {
          e.preventDefault()
          match.onClick(data[focusIdx], focusIdx)
        }
      }
    },
    [data, focusIdx, keyboardNav, onRowClick, rowActions],
  )

  useEffect(() => {
    if (!keyboardNav) return
    const el = scrollRef.current
    if (!el) return
    const onDocKey = (e: KeyboardEvent) => {
      if (!el.matches(':hover') && !el.contains(document.activeElement)) return
      handleKey(e)
    }
    document.addEventListener('keydown', onDocKey)
    return () => document.removeEventListener('keydown', onDocKey)
  }, [handleKey, keyboardNav])

  const colsWithActions = rowActions ? columns.length + 1 : columns.length

  function renderRow(row: T, i: number) {
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
        className={cn('aegis-dt-row group/row', onRowClick && 'cursor-pointer')}
        style={{ height: rowHeight }}
      >
        {columns.map((col) => {
          let content: ReactNode
          if (col.sparkline) {
            const values =
              col.sparklineValue?.(row) ??
              ((row as unknown as Record<string, unknown>)[col.key] as
                | number[]
                | undefined)
            content =
              Array.isArray(values) && values.length > 1 ? (
                <Sparkline data={values} width={48} height={16} />
              ) : (
                '—'
              )
          } else {
            content = col.cell
              ? col.cell(row, i)
              : ((row as unknown as Record<string, unknown>)?.[col.key] as ReactNode) ?? '—'
          }
          let bgStyle: React.CSSProperties | undefined
          if (col.heatmap) {
            const p = heatmapMaps[col.key]?.get(i)
            if (typeof p === 'number') bgStyle = { backgroundColor: heatmapBg(p) }
          }
          return (
            <td
              key={col.key}
              className={cn(
                'px-3 align-middle border-b border-border text-[13px]',
                col.numeric && 'num text-right font-mono tabular-nums',
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
            className="row-actions-cell border-b border-border align-middle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aegis-dt-actions flex items-center gap-0.5 justify-end pr-2">
              {rowActions
                .filter((a) => !a.show || a.show(row))
                .map((action) => (
                  <button
                    key={action.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      action.onClick(row, i)
                    }}
                    title={
                      action.shortcut
                        ? `${action.label} (${action.shortcut})`
                        : action.label
                    }
                    aria-label={action.label}
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle',
                      'hover:bg-surface-muted transition-colors',
                      action.tone === 'danger'
                        ? 'hover:text-[var(--ember)]'
                        : 'hover:text-[var(--signal)]',
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
  }

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className={cn('panel overflow-hidden flex flex-col aegis-dt', className)}
      data-density={density}
      {...props}
    >
      {toolbar && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border" style={{ background: 'var(--glass)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          {toolbar}
        </div>
      )}

      <div
        ref={scrollRef}
        className="overflow-auto scrollbar-thin"
        style={{
          maxHeight,
          ['--density-row-height' as string]: `${rowHeight}px`,
        }}
      >
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-[1]">
            <tr>
              {columns.map((col) => {
                const isSorted = sortBy === (col.sortKey ?? col.key)
                const canSort = col.sortable && !!onSort
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      'relative px-3 py-2.5 text-left align-middle',
                      'text-[10px] font-mono font-semibold uppercase',
                      'text-fg-muted',
                      'bg-[var(--bg-raised,var(--surface-elevated))]',
                      'border-b border-[var(--border-strong)]',
                      col.numeric && 'text-right',
                      col.hideOnMobile && 'hidden sm:table-cell',
                      canSort && 'cursor-pointer select-none hover:text-fg transition-colors',
                      isSorted && 'text-fg',
                      col.className,
                    )}
                    style={{
                      letterSpacing: '0.22em',
                      width: col.width,
                    }}
                    aria-sort={
                      isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    onClick={canSort ? () => onSort!(col.sortKey ?? col.key) : undefined}
                  >
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        col.numeric && 'justify-end w-full',
                      )}
                    >
                      {col.header}
                      {canSort &&
                        (isSorted ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3 text-[var(--signal)]" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-[var(--signal)]" />
                          )
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        ))}
                    </span>
                    {isSorted && (
                      <span
                        aria-hidden
                        className="absolute left-0 right-0 bottom-0 h-[2px]"
                        style={{ background: 'var(--grad, var(--signal))' }}
                      />
                    )}
                  </th>
                )
              })}
              {rowActions && (
                <th
                  style={{ width: 1 }}
                  aria-label="Actions"
                  className="bg-[var(--bg-raised,var(--surface-elevated))] border-b border-[var(--border-strong)]"
                />
              )}
            </tr>
          </thead>
          <tbody
            className="transition-opacity"
            style={{
              opacity: mounted ? 1 : 0,
              transitionDuration: '80ms',
              transitionTimingFunction: 'var(--ease)',
            }}
          >
            {loading && data.length === 0 ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`} style={{ height: rowHeight }}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-3 border-b border-border',
                        col.numeric && 'num text-right',
                        col.hideOnMobile && 'hidden sm:table-cell',
                      )}
                    >
                      <span
                        aria-hidden
                        className="block h-3 rounded-sm"
                        style={{
                          background: 'var(--bg-sunken, var(--surface-muted))',
                          width: '70%',
                        }}
                      />
                    </td>
                  ))}
                  {rowActions && <td className="border-b border-border" />}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colsWithActions} className="text-center py-12 text-fg-muted border-b-0">
                  {empty ?? (
                    <div className="flex flex-col items-center gap-3">
                      <svg
                        width="56"
                        height="32"
                        viewBox="0 0 56 32"
                        aria-hidden
                        className="text-[var(--signal)]"
                      >
                        <path
                          d="M 4 28 L 20 8 L 36 20 L 52 4"
                          fill="none"
                          stroke="currentColor"
                          strokeOpacity="0.5"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx="52" cy="4" r="2" fill="currentColor" />
                      </svg>
                      <p className="text-[13px]">No data yet</p>
                    </div>
                  )}
                </td>
              </tr>
            ) : shouldVirtualize ? (
              (() => {
                const items = virtualizer.getVirtualItems()
                if (items.length === 0) return null
                const totalSize = virtualizer.getTotalSize()
                const paddingTop = items[0].start
                const paddingBottom = totalSize - items[items.length - 1].end
                return (
                  <>
                    {paddingTop > 0 && (
                      <tr style={{ height: paddingTop }} aria-hidden>
                        <td colSpan={colsWithActions} />
                      </tr>
                    )}
                    {items.map((vi) => renderRow(data[vi.index], vi.index))}
                    {paddingBottom > 0 && (
                      <tr style={{ height: paddingBottom }} aria-hidden>
                        <td colSpan={colsWithActions} />
                      </tr>
                    )}
                  </>
                )
              })()
            ) : (
              data.map((row, i) => renderRow(row, i))
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {hint && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 text-[11px] text-fg-subtle border-t border-border">
          <kbd className="kbd">↑↓</kbd>
          <span>navigate</span>
          <kbd className="kbd">↵</kbd>
          <span>open</span>
          {rowActions?.map((a) =>
            a.shortcut ? (
              <span key={a.id} className="inline-flex items-center gap-1">
                <kbd className="kbd">{a.shortcut}</kbd>
                <span>{a.label.toLowerCase()}</span>
              </span>
            ) : null,
          )}
        </div>
      )}

      <style jsx>{`
        .aegis-dt-row {
          transition: background-color 120ms var(--ease);
        }
        .aegis-dt-row:hover {
          background: var(--signal-subtle);
        }
        .aegis-dt-row[data-selected='true'] {
          background: var(--signal-glow);
        }
        .aegis-dt-row[data-focused='true'] {
          background: var(--signal-subtle);
          box-shadow: inset 2px 0 0 var(--signal);
        }
        .aegis-dt-actions {
          opacity: 0;
          transform: translateX(8px);
          transition:
            opacity 120ms var(--ease),
            transform 120ms var(--ease);
        }
        .aegis-dt-row:hover .aegis-dt-actions,
        .aegis-dt-row[data-focused='true'] .aegis-dt-actions {
          opacity: 1;
          transform: translateX(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .aegis-dt-row,
          .aegis-dt-actions {
            transition-duration: 80ms !important;
          }
        }
      `}</style>
    </div>
  )
}

export default DataTable
