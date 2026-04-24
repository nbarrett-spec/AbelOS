'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ComparisonTable — client component for /ops/pm/compare
//
// Renders all PMs as rows × metrics as columns:
//   PM (name + role) · Active Jobs · Total $ · Materials Ready % · Red-Mat Jobs
//   · Overdue Tasks · Closings ≤7d · Avg Days to Close · YTD Completed
//
// Features:
//   • Every column sortable via header click (stable, client-side).
//   • Conditional coloring: redJobs > 5, materialsReady < 50, overdue > 10.
//   • Row click → /ops/pm/book/[staffId].
//   • CSV export — builds a file from the loaded data, triggers download.
//   • "Mine" row highlight — left accent border when row.staffId matches the
//     signed-in staff id (passed from the server component).
//   • Mobile: <md breakpoint renders stacked cards (one per PM) with metric
//     pairs in a 2-col grid. Same sort order applies.
//
// The shared <Table/> primitive is used for desktop so we stay visually
// consistent with BookTable and the Blueprint palette.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableEmpty,
  Avatar,
} from '@/components/ui'
import { Download, RefreshCw, ArrowRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComparePM {
  staffId: string
  firstName: string
  lastName: string
  email: string
  title: string | null
  role: string
  activeJobs: number
  totalJobDollars: number
  materialsReadyPct: number
  redJobs: number
  overdueTasks: number
  closingsThisWeek: number
  avgDaysToClose: number | null
  ytdCompleted: number
}

interface Props {
  pms: ComparePM[]
  asOf: string
  monthKey: string
  fallbackUsed: boolean
  viewerStaffId: string | null
}

// ── Sortable columns — keyed by ComparePM field ──────────────────────────────
type SortKey =
  | 'name'
  | 'activeJobs'
  | 'totalJobDollars'
  | 'materialsReadyPct'
  | 'redJobs'
  | 'overdueTasks'
  | 'closingsThisWeek'
  | 'avgDaysToClose'
  | 'ytdCompleted'

type SortDir = 'asc' | 'desc'

interface ColumnSpec {
  key: SortKey
  label: string
  numeric?: boolean
  // Sort value extractor. Non-null numbers sort before null.
  sortVal: (p: ComparePM) => number | string
}

const COLUMNS: ColumnSpec[] = [
  {
    key: 'name',
    label: 'PM',
    sortVal: (p) => `${p.lastName} ${p.firstName}`.toLowerCase(),
  },
  {
    key: 'activeJobs',
    label: 'Active Jobs',
    numeric: true,
    sortVal: (p) => p.activeJobs,
  },
  {
    key: 'totalJobDollars',
    label: 'Total $',
    numeric: true,
    sortVal: (p) => p.totalJobDollars,
  },
  {
    key: 'materialsReadyPct',
    label: 'Mat. Ready %',
    numeric: true,
    sortVal: (p) => p.materialsReadyPct,
  },
  {
    key: 'redJobs',
    label: 'Red-Mat Jobs',
    numeric: true,
    sortVal: (p) => p.redJobs,
  },
  {
    key: 'overdueTasks',
    label: 'Overdue',
    numeric: true,
    sortVal: (p) => p.overdueTasks,
  },
  {
    key: 'closingsThisWeek',
    label: 'Close ≤ 7d',
    numeric: true,
    sortVal: (p) => p.closingsThisWeek,
  },
  {
    key: 'avgDaysToClose',
    label: 'Avg Days/Close',
    numeric: true,
    // Null sorts last in either direction.
    sortVal: (p) =>
      p.avgDaysToClose === null ? Number.POSITIVE_INFINITY : p.avgDaysToClose,
  },
  {
    key: 'ytdCompleted',
    label: 'YTD Done',
    numeric: true,
    sortVal: (p) => p.ytdCompleted,
  },
]

// ── Conditional cell classes — drive the red-is-bad tone ──────────────────
function redJobsClass(n: number): string {
  return n > 5 ? 'bg-data-negative-bg text-data-negative-fg font-semibold' : ''
}
function materialsReadyClass(pct: number): string {
  return pct < 50 ? 'bg-data-negative-bg text-data-negative-fg font-semibold' : ''
}
function overdueClass(n: number): string {
  return n > 10 ? 'bg-data-negative-bg text-data-negative-fg font-semibold' : ''
}

// ── Currency formatter — compact for the comparison view ───────────────────
function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  if (n > 0) return `$${n.toFixed(0)}`
  return '—'
}

function fmtPct(n: number): string {
  return `${n}%`
}

function fmtDays(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return `${n}d`
}

// ── CSV export ─────────────────────────────────────────────────────────────
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  // Quote if the string contains a comma, quote, or newline. Double any
  // embedded quotes per RFC 4180.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildCsv(rows: ComparePM[], asOf: string): string {
  const header = [
    'PM',
    'Role/Title',
    'Email',
    'Active Jobs',
    'Total Job $',
    'Materials Ready %',
    'Red-Material Jobs',
    'Overdue Tasks',
    'Closings ≤7d',
    'Avg Days to Close',
    'YTD Completed',
  ]
  const lines = [
    `# Abel Lumber PM Comparison — exported ${new Date(asOf).toISOString()}`,
    header.map(csvEscape).join(','),
  ]
  for (const p of rows) {
    lines.push(
      [
        `${p.firstName} ${p.lastName}`.trim(),
        p.title ?? p.role,
        p.email,
        p.activeJobs,
        p.totalJobDollars.toFixed(2),
        p.materialsReadyPct,
        p.redJobs,
        p.overdueTasks,
        p.closingsThisWeek,
        p.avgDaysToClose === null ? '' : p.avgDaysToClose,
        p.ytdCompleted,
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return lines.join('\r\n')
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Role/title label helper ────────────────────────────────────────────────
function displayTitle(p: ComparePM): string {
  if (p.title) return p.title
  if (p.role === 'PROJECT_MANAGER') return 'Project Manager'
  return p.role.replace(/_/g, ' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ComparisonTable({
  pms,
  asOf,
  monthKey,
  fallbackUsed,
  viewerStaffId,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [lastRefreshed, setLastRefreshed] = useState(asOf)

  // Default sort — active jobs desc to surface "who's overloaded" first.
  const [sortKey, setSortKey] = useState<SortKey>('activeJobs')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey)
    if (!col) return pms
    const copy = [...pms]
    copy.sort((a, b) => {
      const av = col.sortVal(a)
      const bv = col.sortVal(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av)
      const bs = String(bv)
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return copy
  }, [pms, sortKey, sortDir])

  const onHeaderClick = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(k)
      // Numeric columns default to desc (most interesting first).
      const col = COLUMNS.find((c) => c.key === k)
      setSortDir(col?.numeric ? 'desc' : 'asc')
    }
  }

  const onRowClick = (staffId: string) => {
    router.push(`/ops/pm/book/${encodeURIComponent(staffId)}`)
  }

  const onRefresh = () => {
    startTransition(() => {
      router.refresh()
      setLastRefreshed(new Date().toISOString())
    })
  }

  const onExport = () => {
    const csv = buildCsv(sorted, lastRefreshed)
    const filename = `pm-comparison-${monthKey}.csv`
    downloadCsv(csv, filename)
  }

  const asOfLabel = new Date(lastRefreshed).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          {fallbackUsed ? (
            <span className="text-accent-fg">
              Showing staff with assigned jobs (role-based lookup returned empty).
            </span>
          ) : (
            <>Refreshed {asOfLabel}</>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={sorted.length === 0}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60',
              'bg-surface hover:bg-surface-muted hover:border-border-strong',
              'transition-colors text-xs font-medium text-fg',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isPending}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60',
              'bg-surface hover:bg-surface-muted hover:border-border-strong',
              'transition-colors text-xs font-medium text-fg',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isPending && 'animate-spin')} />
            {isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table density="default">
          <TableHead>
            <tr>
              {COLUMNS.map((c) => (
                <TableHeader
                  key={c.key}
                  sortable
                  sorted={sortKey === c.key ? sortDir : false}
                  numeric={c.numeric}
                  onClick={() => onHeaderClick(c.key)}
                >
                  {c.label}
                </TableHeader>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            {sorted.length === 0 ? (
              <TableEmpty
                title="No Project Managers configured."
                description="Add staff via /ops/staff with role PROJECT_MANAGER."
                colSpan={COLUMNS.length}
              />
            ) : (
              sorted.map((p) => {
                const isMe = viewerStaffId && p.staffId === viewerStaffId
                return (
                  <TableRow
                    key={p.staffId}
                    clickable
                    onClick={() => onRowClick(p.staffId)}
                    className={cn(
                      'hover:bg-surface-muted',
                      isMe && 'border-l-2 border-l-accent-fg'
                    )}
                  >
                    {/* PM name + role */}
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          name={`${p.firstName} ${p.lastName}`.trim()}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-fg truncate">
                            {p.firstName} {p.lastName}
                            {isMe && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-accent-fg">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-fg-muted truncate">
                            {displayTitle(p)}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell numeric>{p.activeJobs}</TableCell>
                    <TableCell numeric>{fmtUSD(p.totalJobDollars)}</TableCell>
                    <TableCell
                      numeric
                      className={materialsReadyClass(p.materialsReadyPct)}
                    >
                      {fmtPct(p.materialsReadyPct)}
                    </TableCell>
                    <TableCell numeric className={redJobsClass(p.redJobs)}>
                      <span className="inline-flex items-center gap-1 justify-end w-full">
                        {p.redJobs > 5 && (
                          <AlertTriangle className="w-3 h-3" aria-hidden />
                        )}
                        {p.redJobs}
                      </span>
                    </TableCell>
                    <TableCell numeric className={overdueClass(p.overdueTasks)}>
                      {p.overdueTasks}
                    </TableCell>
                    <TableCell numeric>{p.closingsThisWeek}</TableCell>
                    <TableCell numeric muted={p.avgDaysToClose === null}>
                      {fmtDays(p.avgDaysToClose)}
                    </TableCell>
                    <TableCell numeric>{p.ytdCompleted}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {sorted.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="text-sm font-semibold text-fg mb-1">
              No Project Managers configured.
            </div>
            <div className="text-xs text-fg-muted">
              Add staff via /ops/staff with role PROJECT_MANAGER.
            </div>
          </div>
        ) : (
          sorted.map((p) => {
            const isMe = viewerStaffId && p.staffId === viewerStaffId
            return (
              <button
                key={p.staffId}
                type="button"
                onClick={() => onRowClick(p.staffId)}
                className={cn(
                  'glass-card w-full text-left p-4 flex flex-col gap-3',
                  'transition-[border-color,box-shadow] duration-fast ease-out',
                  'hover:border-border-strong hover:shadow-elevation-2',
                  isMe && 'border-l-2 border-l-accent-fg'
                )}
              >
                {/* Header */}
                <div className="flex items-center gap-3">
                  <Avatar
                    name={`${p.firstName} ${p.lastName}`.trim()}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-fg truncate">
                      {p.firstName} {p.lastName}
                      {isMe && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-accent-fg">
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted truncate">
                      {displayTitle(p)}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-fg-muted shrink-0" />
                </div>

                {/* Metric grid */}
                <div className="grid grid-cols-2 gap-2">
                  <MetricCell label="Active Jobs" value={p.activeJobs} />
                  <MetricCell label="Total $" value={fmtUSD(p.totalJobDollars)} />
                  <MetricCell
                    label="Mat. Ready"
                    value={fmtPct(p.materialsReadyPct)}
                    tone={p.materialsReadyPct < 50 ? 'negative' : 'neutral'}
                  />
                  <MetricCell
                    label="Red-Mat Jobs"
                    value={p.redJobs}
                    tone={p.redJobs > 5 ? 'negative' : 'neutral'}
                  />
                  <MetricCell
                    label="Overdue"
                    value={p.overdueTasks}
                    tone={p.overdueTasks > 10 ? 'negative' : 'neutral'}
                  />
                  <MetricCell label="Close ≤ 7d" value={p.closingsThisWeek} />
                  <MetricCell label="Avg Days/Close" value={fmtDays(p.avgDaysToClose)} />
                  <MetricCell label="YTD Done" value={p.ytdCompleted} />
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Mobile metric cell ───────────────────────────────────────────────────────
function MetricCell({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'neutral' | 'negative'
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-border/60 p-2 flex flex-col gap-0.5',
        tone === 'negative' && 'bg-data-negative-bg'
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">
        {label}
      </div>
      <div
        className={cn(
          'text-sm font-semibold font-numeric tabular-nums leading-none',
          tone === 'negative' ? 'text-data-negative-fg' : 'text-fg'
        )}
      >
        {value}
      </div>
    </div>
  )
}
