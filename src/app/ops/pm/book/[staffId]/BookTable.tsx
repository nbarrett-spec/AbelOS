'use client'

// ─────────────────────────────────────────────────────────────────────────────
// BookTable — client-side table for the PM Book page.
//
// Receives the already-fetched job rows from the server component and
// renders them through the shared <DataTable/> primitive. Adds client-side
// filters (builder, semantic status, closing-date window) and row-click
// navigation to the job detail page.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DataTable, StatusDot, Badge, Input, Button } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { ExternalLink } from 'lucide-react'

export type MaterialsStatus = 'GREEN' | 'AMBER' | 'RED' | 'NONE'

export interface BookJobRow {
  id: string
  jobNumber: string
  community: string | null
  lotBlock: string | null
  builderName: string
  status: string
  materialsStatus: MaterialsStatus
  materialsBreakdown: {
    total: number
    picked: number
    consumed: number
    reserved: number
    backordered: number
    other: number
  }
  closingDate: string | null
  scheduledDate: string | null
  lastActivityAt: string | null
  updatedAt: string
}

type SemanticBucket = 'ACTIVE' | 'BUILDING' | 'CLOSED'

// JobStatus → semantic bucket. BUILDING covers the in-flight production/install
// statuses; CLOSED covers terminal statuses; everything else is ACTIVE.
const BUILDING_STATUSES = new Set([
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'INSTALLING',
  'PUNCH_LIST',
])
const CLOSED_STATUSES = new Set(['COMPLETE', 'INVOICED', 'CLOSED'])

function bucketOf(status: string): SemanticBucket {
  if (CLOSED_STATUSES.has(status)) return 'CLOSED'
  if (BUILDING_STATUSES.has(status)) return 'BUILDING'
  return 'ACTIVE'
}

function materialsTone(
  m: MaterialsStatus
): 'success' | 'active' | 'alert' | 'offline' {
  switch (m) {
    case 'GREEN':
      return 'success'
    case 'AMBER':
      return 'active'
    case 'RED':
      return 'alert'
    default:
      return 'offline'
  }
}

function materialsLabel(row: BookJobRow): string {
  const b = row.materialsBreakdown
  if (b.total === 0) return 'no allocations'
  if (row.materialsStatus === 'GREEN') return `${b.total} ready`
  if (row.materialsStatus === 'RED')
    return `${b.backordered} backorder / ${b.total} total`
  if (row.materialsStatus === 'AMBER')
    return `${b.reserved} reserved / ${b.total} total`
  return `${b.total} allocations`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return fmtDate(iso)
  const mins = Math.round(ms / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(iso)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BookTable({ jobs }: { jobs: BookJobRow[] }) {
  const router = useRouter()

  const [builderFilter, setBuilderFilter] = useState<Set<string>>(new Set())
  const [bucketFilter, setBucketFilter] = useState<Set<SemanticBucket>>(
    new Set(['ACTIVE', 'BUILDING'])
  )
  const [closingFrom, setClosingFrom] = useState<string>('')
  const [closingTo, setClosingTo] = useState<string>('')

  const builders = useMemo(() => {
    const set = new Set<string>()
    for (const j of jobs) if (j.builderName) set.add(j.builderName)
    return Array.from(set).sort()
  }, [jobs])

  const filtered = useMemo(() => {
    const fromMs = closingFrom ? Date.parse(closingFrom) : null
    const toMs = closingTo ? Date.parse(closingTo) : null
    return jobs.filter((j) => {
      if (builderFilter.size > 0 && !builderFilter.has(j.builderName))
        return false
      if (bucketFilter.size > 0 && !bucketFilter.has(bucketOf(j.status)))
        return false
      if (fromMs !== null || toMs !== null) {
        if (!j.closingDate) return false
        const cd = Date.parse(j.closingDate)
        if (!Number.isFinite(cd)) return false
        if (fromMs !== null && cd < fromMs) return false
        if (toMs !== null && cd > toMs + 24 * 60 * 60 * 1000 - 1) return false
      }
      return true
    })
  }, [jobs, builderFilter, bucketFilter, closingFrom, closingTo])

  const columns: DataTableColumn<BookJobRow>[] = [
    {
      key: 'jobNumber',
      header: 'Job #',
      sortable: true,
      width: '120px',
      cell: (row) => (
        <span className="font-mono text-[13px] font-medium">
          {row.jobNumber}
        </span>
      ),
    },
    {
      key: 'community',
      header: 'Community',
      sortable: true,
      cell: (row) => row.community ?? '—',
    },
    {
      key: 'lotBlock',
      header: 'Lot',
      width: '110px',
      hideOnMobile: true,
      cell: (row) => row.lotBlock ?? '—',
    },
    {
      key: 'builderName',
      header: 'Builder',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => (
        <span className="truncate max-w-[180px] inline-block">
          {row.builderName}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      sortable: true,
      cell: (row) => {
        const b = bucketOf(row.status)
        const variant =
          b === 'CLOSED' ? 'success' : b === 'BUILDING' ? 'info' : 'neutral'
        return (
          <Badge variant={variant as any} size="sm">
            {row.status.replace(/_/g, ' ')}
          </Badge>
        )
      },
    },
    {
      key: 'materialsStatus',
      header: 'Materials',
      width: '180px',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot
            tone={materialsTone(row.materialsStatus)}
            size={8}
            label={`materials ${row.materialsStatus.toLowerCase()}`}
          />
          <span className="text-[12px] text-fg-muted">
            {materialsLabel(row)}
          </span>
        </div>
      ),
    },
    {
      key: 'closingDate',
      header: 'Closing',
      width: '120px',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-[13px] font-mono">{fmtDate(row.closingDate)}</span>
      ),
    },
    {
      key: 'lastActivityAt',
      header: 'Last Activity',
      width: '130px',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-[12px] text-fg-muted">
          {fmtRelative(row.lastActivityAt ?? row.updatedAt)}
        </span>
      ),
    },
    {
      key: 'open',
      header: '',
      width: '60px',
      cell: () => (
        <span className="inline-flex items-center justify-center text-fg-subtle">
          <ExternalLink className="w-3.5 h-3.5" />
        </span>
      ),
    },
  ]

  function toggleBuilder(b: string) {
    setBuilderFilter((prev) => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  }

  function toggleBucket(b: SemanticBucket) {
    setBucketFilter((prev) => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  }

  function clearFilters() {
    setBuilderFilter(new Set())
    setBucketFilter(new Set(['ACTIVE', 'BUILDING']))
    setClosingFrom('')
    setClosingTo('')
  }

  const hasFilters =
    builderFilter.size > 0 ||
    bucketFilter.size < 3 ||
    bucketFilter.size === 0 ||
    closingFrom !== '' ||
    closingTo !== ''

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 w-full text-[12px]">
      {/* Bucket chips */}
      <div className="flex items-center gap-1.5">
        <span className="text-fg-subtle uppercase tracking-wider text-[10px]">
          Status
        </span>
        {(['ACTIVE', 'BUILDING', 'CLOSED'] as SemanticBucket[]).map((b) => {
          const on = bucketFilter.has(b)
          return (
            <button
              key={b}
              onClick={() => toggleBucket(b)}
              className={[
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                on
                  ? 'bg-brand-subtle text-fg border border-brand/40'
                  : 'bg-transparent text-fg-muted border border-border hover:border-border-strong',
              ].join(' ')}
              aria-pressed={on}
            >
              {b}
            </button>
          )
        })}
      </div>

      {/* Builder chips (inline, capped to keep the toolbar tight) */}
      {builders.length > 0 && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-fg-subtle uppercase tracking-wider text-[10px] shrink-0">
            Builder
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            {builders.slice(0, 8).map((b) => {
              const on = builderFilter.has(b)
              return (
                <button
                  key={b}
                  onClick={() => toggleBuilder(b)}
                  className={[
                    'px-2 py-0.5 rounded text-[11px] transition-colors',
                    on
                      ? 'bg-accent-subtle text-accent-fg border border-accent/40'
                      : 'text-fg-muted border border-transparent hover:text-fg',
                  ].join(' ')}
                  aria-pressed={on}
                >
                  {b}
                </button>
              )
            })}
            {builders.length > 8 && (
              <span className="text-fg-subtle">+{builders.length - 8}</span>
            )}
          </div>
        </div>
      )}

      {/* Closing date window */}
      <div className="flex items-center gap-1.5">
        <span className="text-fg-subtle uppercase tracking-wider text-[10px]">
          Closing
        </span>
        <Input
          type="date"
          size="sm"
          fullWidth={false}
          floating={false}
          value={closingFrom}
          onChange={(e) => setClosingFrom(e.target.value)}
          aria-label="Closing from"
          className="w-[130px]"
        />
        <span className="text-fg-subtle">→</span>
        <Input
          type="date"
          size="sm"
          fullWidth={false}
          floating={false}
          value={closingTo}
          onChange={(e) => setClosingTo(e.target.value)}
          aria-label="Closing to"
          className="w-[130px]"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-fg-subtle">
          {filtered.length} of {jobs.length}
        </span>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Reset
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <DataTable<BookJobRow>
      data={filtered}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={(row) => router.push(`/ops/jobs/${row.id}`)}
      toolbar={toolbar}
      empty={
        jobs.length === 0
          ? 'No jobs assigned to this PM yet.'
          : 'No jobs match the current filters.'
      }
      density="default"
      hint
      maxHeight={640}
      data-testid="pm-book-table"
    />
  )
}
