'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import {
  PageHeader, Badge, DataTable, EmptyState, LiveDataIndicator,
} from '@/components/ui'
import { cn } from '@/lib/utils'

interface ScorecardPO {
  id: string
  poNumber: string
  status: string
  total: number
  orderedAt: string | null
  expectedDate: string | null
  receivedAt: string | null
  createdAt: string
  actualLeadDays: number | null
  promisedLeadDays: number | null
  slipDays: number | null
  onTime: boolean | null
}

interface ScorecardDetailResponse {
  vendor: { id: string; name: string; code: string }
  windowDays: number
  since: string
  purchaseOrders: ScorecardPO[]
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtDays = (d: number | null) =>
  d === null || d === undefined ? '—' : `${d.toFixed(1)}d`

const fmtSlip = (d: number | null) =>
  d === null || d === undefined ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}d`

const fmtShort = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })

export default function VendorScorecardDetailPage() {
  const params = useParams<{ vendorId: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const days = parseInt(search.get('days') || '90', 10)
  const [data, setData] = useState<ScorecardDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState<number | null>(null)

  useEffect(() => { if (params?.vendorId) fetchData() /* eslint-disable-next-line */ }, [params?.vendorId, days])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch(
        `/api/ops/vendors/scorecard/${params.vendorId}?days=${days}`,
        { credentials: 'include', cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
      const body = (await res.json()) as ScorecardDetailResponse
      setData(body)
      setTick(Date.now())
    } catch (err) {
      console.error('[VendorScorecardDetail] fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Vendor Scorecard" title="Loading…" description="Fetching PO history." />
      </div>
    )
  }

  const pos = data.purchaseOrders

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Vendor Scorecard"
        title={data.vendor.name}
        description={`${data.vendor.code} · Rolling ${data.windowDays}-day window · ${pos.length} POs`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/ops/vendors/scorecard?days=${days}`} className="btn btn-ghost btn-sm">
              <ArrowLeft className="w-3.5 h-3.5" />
              All vendors
            </Link>
            <Link href={`/ops/vendors/${data.vendor.id}`} className="btn btn-secondary btn-sm">
              Vendor profile
            </Link>
            <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
      />

      <DataTable
        density="compact"
        data={pos}
        rowKey={r => r.id}
        keyboardNav
        hint
        columns={[
          {
            key: 'poNumber', header: 'PO', width: '130px', sortable: true,
            cell: r => <span className="font-mono text-[12px] font-semibold text-fg">{r.poNumber}</span>,
          },
          {
            key: 'status', header: 'Status', width: '140px', sortable: true,
            cell: r => (
              <Badge
                variant={
                  r.status === 'RECEIVED' ? 'success'
                  : r.status === 'PARTIALLY_RECEIVED' ? 'info'
                  : r.status === 'CANCELLED' ? 'danger'
                  : 'neutral'
                }
                size="xs"
              >
                {r.status}
              </Badge>
            ),
          },
          {
            key: 'total', header: 'Total', numeric: true, sortable: true, width: '110px',
            cell: r => <span className="font-mono font-semibold tabular-nums">{fmtMoney(r.total)}</span>,
          },
          {
            key: 'orderedAt', header: 'Ordered', numeric: true, sortable: true, width: '100px',
            cell: r => <span className="font-mono tabular-nums text-[11px] text-fg-muted">{fmtShort(r.orderedAt)}</span>,
          },
          {
            key: 'expectedDate', header: 'Promised', numeric: true, sortable: true, width: '100px',
            cell: r => <span className="font-mono tabular-nums text-[11px] text-fg-muted">{fmtShort(r.expectedDate)}</span>,
          },
          {
            key: 'receivedAt', header: 'Received', numeric: true, sortable: true, width: '100px',
            cell: r => <span className="font-mono tabular-nums text-[11px] text-fg-muted">{fmtShort(r.receivedAt)}</span>,
          },
          {
            key: 'promisedLeadDays', header: 'Promised Lead', numeric: true, sortable: true, width: '120px',
            cell: r => <span className="font-mono tabular-nums">{fmtDays(r.promisedLeadDays)}</span>,
          },
          {
            key: 'actualLeadDays', header: 'Actual Lead', numeric: true, sortable: true, width: '110px',
            cell: r => <span className="font-mono tabular-nums">{fmtDays(r.actualLeadDays)}</span>,
          },
          {
            key: 'slipDays', header: 'Slip', numeric: true, sortable: true, width: '90px',
            cell: r => (
              <span className={cn(
                'font-mono font-semibold tabular-nums',
                r.slipDays === null
                  ? 'text-fg-subtle'
                  : r.slipDays <= 0
                    ? 'text-data-positive'
                    : r.slipDays > 3
                      ? 'text-data-negative'
                      : 'text-accent',
              )}>
                {fmtSlip(r.slipDays)}
              </span>
            ),
          },
          {
            key: 'onTime', header: 'On-Time', width: '90px',
            cell: r => (
              r.onTime === null
                ? <Badge variant="neutral" size="xs">—</Badge>
                : r.onTime
                  ? <Badge variant="success" size="xs">on-time</Badge>
                  : <Badge variant="danger" size="xs">late</Badge>
            ),
          },
        ]}
        empty={
          <EmptyState
            icon="package"
            size="compact"
            title="No POs in window"
            description={`No purchase orders for ${data.vendor.name} in the last ${data.windowDays} days.`}
          />
        }
      />
    </div>
  )
}
