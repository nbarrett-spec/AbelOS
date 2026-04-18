'use client'

import { type ReactNode, type HTMLAttributes, type ThHTMLAttributes, type TdHTMLAttributes } from 'react'
import { clsx } from 'clsx'

// ── Root ──────────────────────────────────────────────────────────────────

interface TableProps extends HTMLAttributes<HTMLDivElement> {
  /** Wrap in a scrollable container */
  scrollable?: boolean
}

export function Table({ scrollable = true, className, children, ...props }: TableProps) {
  const table = (
    <table className={clsx('w-full text-sm text-left', className)} {...props}>
      {children}
    </table>
  )

  if (!scrollable) return table

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      {table}
    </div>
  )
}

// ── Head ──────────────────────────────────────────────────────────────────

export function TableHead({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={clsx(
        'bg-gray-50/80 dark:bg-gray-800/50',
        'border-b border-gray-200 dark:border-gray-700',
        className
      )}
      {...props}
    >
      {children}
    </thead>
  )
}

// ── Header cell ───────────────────────────────────────────────────────────

interface TableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean
  sorted?: 'asc' | 'desc' | false
}

export function TableHeader({ sortable, sorted, className, children, ...props }: TableHeaderProps) {
  return (
    <th
      className={clsx(
        'px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider',
        sortable && 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors',
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-1.5">
        {children}
        {sorted === 'asc' && <span className="text-abel-navy">↑</span>}
        {sorted === 'desc' && <span className="text-abel-navy">↓</span>}
      </div>
    </th>
  )
}

// ── Body ──────────────────────────────────────────────────────────────────

export function TableBody({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={clsx('divide-y divide-gray-100 dark:divide-gray-800', className)}
      {...props}
    >
      {children}
    </tbody>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  clickable?: boolean
  selected?: boolean
}

export function TableRow({ clickable, selected, className, children, ...props }: TableRowProps) {
  return (
    <tr
      className={clsx(
        'transition-colors',
        clickable && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50',
        selected && 'bg-abel-navy/5 dark:bg-abel-navy/10',
        className
      )}
      {...props}
    >
      {children}
    </tr>
  )
}

// ── Cell ──────────────────────────────────────────────────────────────────

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  mono?: boolean
  muted?: boolean
}

export function TableCell({ mono, muted, className, children, ...props }: TableCellProps) {
  return (
    <td
      className={clsx(
        'px-4 py-3.5 text-gray-900 dark:text-gray-100',
        mono && 'font-mono text-xs',
        muted && 'text-gray-500 dark:text-gray-400',
        className
      )}
      {...props}
    >
      {children}
    </td>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────

interface TableEmptyProps {
  icon?: ReactNode
  title?: string
  description?: string
  action?: ReactNode
  colSpan?: number
}

export function TableEmpty({
  icon,
  title = 'No results',
  description,
  action,
  colSpan = 99,
}: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center">
        <div className="flex flex-col items-center gap-3">
          {icon && (
            <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
              {icon}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</p>
            {description && (
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{description}</p>
            )}
          </div>
          {action}
        </div>
      </td>
    </tr>
  )
}
