'use client'

import {
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Table primitives ────────────────────────────
// Dense, zebra-less, sticky header with mono overline. Rows separated by
// 1px borders. Numeric cols right-aligned mono tabular-nums.
// ─────────────────────────────────────────────────────────────────────────

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Wrap in a scrollable container */
  scrollable?: boolean
  density?: 'compact' | 'default' | 'comfortable'
}

export function Table({
  scrollable = true,
  density = 'default',
  className,
  children,
  ...props
}: TableProps) {
  const table = (
    <table
      {...props}
      className={cn(
        'datatable w-full text-left',
        density === 'compact' && 'density-compact',
        density === 'comfortable' && 'density-comfortable',
        className,
      )}
    >
      {children}
    </table>
  )

  if (!scrollable) return table
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
      {table}
    </div>
  )
}

export function TableHead({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn(className)} {...props}>
      {children}
    </thead>
  )
}

interface TableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean
  sorted?: 'asc' | 'desc' | false
  numeric?: boolean
}

export function TableHeader({
  sortable,
  sorted,
  numeric,
  className,
  children,
  ...props
}: TableHeaderProps) {
  return (
    <th
      {...props}
      aria-sort={
        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
      }
      className={cn(
        'px-3 py-2.5 text-[10px] font-mono font-semibold uppercase',
        'tracking-[0.22em] leading-none',
        'bg-[var(--bg-raised,var(--surface-elevated))] text-fg-muted',
        'border-b border-[var(--border-strong)]',
        numeric && 'num text-right',
        sortable &&
          'cursor-pointer select-none hover:text-fg transition-colors',
        sorted && 'text-fg',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          numeric && 'justify-end w-full',
        )}
      >
        {children}
        {sorted === 'asc' && <span aria-hidden>↑</span>}
        {sorted === 'desc' && <span aria-hidden>↓</span>}
      </span>
      {sorted && (
        <span
          aria-hidden
          className="absolute left-0 right-0 bottom-0 h-[2px]"
          style={{ background: 'var(--signal, var(--gold))' }}
        />
      )}
    </th>
  )
}

export function TableBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  )
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  clickable?: boolean
  selected?: boolean
}

export function TableRow({
  clickable,
  selected,
  className,
  children,
  ...props
}: TableRowProps) {
  return (
    <tr
      {...props}
      data-selected={selected || undefined}
      className={cn(
        'transition-colors',
        clickable && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  )
}

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  mono?: boolean
  muted?: boolean
  numeric?: boolean
}

export function TableCell({
  mono,
  muted,
  numeric,
  className,
  children,
  ...props
}: TableCellProps) {
  return (
    <td
      {...props}
      className={cn(
        'px-3 py-2.5 text-[13px] border-b border-border',
        'align-middle text-fg',
        (mono || numeric) && 'font-mono tabular-nums',
        numeric && 'num text-right',
        muted && 'text-fg-muted',
        className,
      )}
    >
      {children}
    </td>
  )
}

// ── Empty state — single drafting-line illustration ──────────────────────

interface TableEmptyProps {
  icon?: ReactNode
  title?: string
  description?: string
  action?: ReactNode
  colSpan?: number
}

export function TableEmpty({
  icon,
  title = 'No data yet',
  description,
  action,
  colSpan = 99,
}: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center border-0">
        <div className="flex flex-col items-center gap-3">
          {icon ?? (
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
          )}
          <div>
            <p className="text-[13px] font-medium text-fg-muted">{title}</p>
            {description && (
              <p className="text-[12px] text-fg-subtle mt-1">{description}</p>
            )}
          </div>
          {action}
        </div>
      </td>
    </tr>
  )
}

export default Table
