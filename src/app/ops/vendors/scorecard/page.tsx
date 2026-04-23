'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Award, AlertTriangle, Timer, RefreshCw, Filter, ExternalLink,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, DataTable, EmptyState, LiveDataIndicator,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────

interface VendorScorecardRow {
  vendorId: string
  vendorName: string
  vendorCode: string
  totalPOs: number
  totalSpend: number
  onTimeRate: number | null
  avgLeadDays: number | null
  promisedLeadDays: number | null
  leadTimeSlipDays: number | null
  fillRate: number | null
  reliabilityGrade: 'A' | 'B' | 'C' | 'D' | null
  lastPoAt: string | null
  receivedWithExpected: number
  onTimeCount: number
  fullyReceived: number
  partiallyReceived: number
}

interface ScorecardResponse {
  windowDays: number
  since: string
  scorecards: VendorScorecardRow[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000) return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtDays = (d: number | null) => (d === null || d === undefined ? '—' : `${d >= 0 ? '' : ''}${d.toFixed(1)}d`)
const fmtSlip = (d: number | null) =>
  d === null || d === undefined ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}d`
const fmtPct = (p: number | null) => (p === null || p === undefined ? '—' : `${p.toFixed(1)}%`)
const fmtShort = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })

const GRADE_META: Record<'A' | 'B' | 'C' | 'D', {
  label: string
  textClass: string
  bgClass: string
  badge: 'success' | 'info' | 'warning' | 'danger'
}> = {
  A: { label: 'A · Excellent', textClass: 'text-data-positive-fg', bgClass: 'bg-data-positive-bg', badge: 'success' },
  B: { label: 'B · Good',      textClass: 'text-accent-fg',        bgClass: 'bg-accent-subtle',     badge: 'info' },
  C: { label: 'C · Watch',     textClass: 'text-forecast-fg',      bgClass: 'bg-forecast-bg',       badge: 'warning' },
  D: { label: 'D · Probation', textClass: 'text-data-negative-fg', bgClass: 'bg-data-negative-bg',  badge: 'danger' },
}

function GradeBadge({ grade }: { grade: VendorScorecardRow['reliabilityGrade'] }) {
  if (!grade) {
    return <Badge variant="neutral" size="xs">—</Badge>
  }
  const meta = GRADE_META[grade]
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-7 h-6 rounded-md font-bold text-[12px] tabular-nums',
        meta.bgClass, meta.textClass,
      )}
      title={meta.label}
    >
      {grade}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function VendorScorecardPage() {
  const router = useRouter()
  const [data, setData] = useState<ScorecardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays] = useState(90)
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [tick, setTick] = useState<number | null>(null)

  useEffect(() => { fetchData(days) /* eslint-disable-next-line */ }, [days])

  async function fetchData(windowDays: number) {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/ops/vendors/scorecard?days=${windowDays}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Scorecard fetch failed: ${res.status}`)
      const body = (await res.json()) as ScorecardResponse
      setData(body)
      setTick(Date.now())
    } catch (err) {
      console.error('[VendorScorecard] fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const rows = data?.scorecards ?? []

  const filteredRows = useMemo(() => {
    if (gradeFilter === 'all') return rows
    if (gradeFilter === 'ungraded') return rows.filter(r => r.reliabilityGrade === null)
    return rows.filter(r => r.reliabilityGrade === gradeFilter)
  }, [rows, gradeFilter])

  const kpis = useMemo(() => {
    const graded = rows.filter(r => r.reliabilityGrade !== null)
    const topA = graded
      .filter(r => r.reliabilityGrade === 'A')
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 5)
    const gradeD = graded.filter(r => r.reliabilityGrade === 'D')
    const slips = rows
      .map(r => r.leadTimeSlipDays)
      .filter((v): v is number => typeof v === 'number')
    const avgSlip = slips.length > 0 ? slips.reduce((a, b) => a + b, 0) / slips.length : null
    return {
      topACount: topA.length,
      topANames: topA.map(r => r.vendorName),
      dCount: gradeD.length,
      dNames: gradeD.slice(0, 3).map(r => r.vendorName),
      avgSlip,
      totalGraded: graded.length,
      totalVendors: rows.length,
    }
  }, [rows])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Supply Chain"
          title="Vendor Scorecard"
          description="Promise-vs-actual lead time, on-time rate, and reliability grade. Rolling 90-day window."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Supply Chain"
        title="Vendor Scorecard"
        description={`Promise-vs-actual lead time and reliability grade. Rolling ${data.windowDays}-day window · ${rows.length} vendors with activity.`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => setDays(parseInt(e.target.value, 10))}
              className="input h-8 w-32 text-[12px] font-mono"
            >
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
            </select>
            <button
              onClick={() => fetchData(days)}
              className="btn btn-secondary btn-sm"
              disabled={refreshing}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPICard
          title="Top Grade-A Vendors"
          value={String(kpis.topACount)}
          subtitle={
            kpis.topANames.length > 0
              ? kpis.topANames.slice(0, 3).join(' · ') + (kpis.topANames.length > 3 ? ` · +${kpis.topANames.length - 3}` : '')
              : 'No grade-A vendors in window'
          }
          icon={<Award className="w-3.5 h-3.5" />}
          accent="positive"
        />
        <KPICard
          title="On Probation (Grade D)"
          value={String(kpis.dCount)}
          subtitle={
            kpis.dNames.length > 0
              ? kpis.dNames.join(' · ') + (kpis.dCount > kpis.dNames.length ? ` · +${kpis.dCount - kpis.dNames.length}` : '')
              : 'All graded vendors hitting >70% on-time'
          }
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={kpis.dCount > 0 ? 'negative' : 'positive'}
        />
        <KPICard
          title="Avg Lead-Time Slip"
          value={kpis.avgSlip === null ? '—' : `${kpis.avgSlip > 0 ? '+' : ''}${kpis.avgSlip.toFixed(1)}d`}
          subtitle={
            kpis.avgSlip === null
              ? 'No received-with-promised POs'
              : kpis.avgSlip <= 0
                ? 'Vendors beating promised dates on average'
                : 'Vendors slipping past promised dates'
          }
          icon={<Timer className="w-3.5 h-3.5" />}
          accent={kpis.avgSlip === null ? 'neutral' : kpis.avgSlip <= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Scorecard table */}
      <DataTable
        density="compact"
        data={filteredRows}
        rowKey={(r) => r.vendorId}
        onRowClick={(r) => router.push(`/ops/vendors/scorecard/${r.vendorId}?days=${days}`)}
        keyboardNav
        hint
        toolbar={
          <div className="flex items-center gap-3 w-full flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-fg-muted" />
              <span className="text-[11px] font-medium text-fg-muted">Filter</span>
            </div>
            <select
              value={gradeFilter}
              onChange={e => setGradeFilter(e.target.value)}
              className="input h-7 w-36 text-[12px]"
            >
              <option value="all">All grades</option>
              <option value="A">Grade A (excellent)</option>
              <option value="B">Grade B (good)</option>
              <option value="C">Grade C (watch)</option>
              <option value="D">Grade D (probation)</option>
              <option value="ungraded">Ungraded (no received POs)</option>
            </select>
            <div className="ml-auto text-[11px] text-fg-subtle font-mono tabular-nums">
              {filteredRows.length} of {rows.length}
            </div>
          </div>
        }
        columns={[
          {
            key: 'vendorName', header: 'Vendor', sortable: true,
            cell: r => (
              <div className="flex flex-col">
                <span className="truncate max-w-[220px] font-medium text-fg">{r.vendorName}</span>
                <span className="text-[10px] font-mono text-fg-subtle tracking-wider">{r.vendorCode}</span>
              </div>
            ),
          },
          {
            key: 'reliabilityGrade', header: 'Grade', width: '80px', sortable: true,
            cell: r => <GradeBadge grade={r.reliabilityGrade} />,
          },
          {
            key: 'onTimeRate', header: 'On-Time', numeric: true, sortable: true, width: '110px',
            heatmap: true,
            heatmapValue: r => r.onTimeRate,
            cell: r => (
              <div className="flex flex-col items-end">
                <span className="font-mono font-semibold tabular-nums">{fmtPct(r.onTimeRate)}</span>
                {r.receivedWithExpected > 0 && (
                  <span className="text-[10px] font-mono text-fg-subtle">
                    {r.onTimeCount}/{r.receivedWithExpected}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'avgLeadDays', header: 'Avg Lead', numeric: true, sortable: true, width: '100px',
            cell: r => (
              <span className="font-mono tabular-nums">{fmtDays(r.avgLeadDays)}</span>
            ),
          },
          {
            key: 'leadTimeSlipDays', header: 'Slip', numeric: true, sortable: true, width: '90px',
            cell: r => (
              <span className={cn(
                'font-mono font-semibold tabular-nums',
                r.leadTimeSlipDays === null
                  ? 'text-fg-subtle'
                  : r.leadTimeSlipDays <= 0
                    ? 'text-data-positive'
                    : r.leadTimeSlipDays > 3
                      ? 'text-data-negative'
                      : 'text-accent',
              )}>
                {fmtSlip(r.leadTimeSlipDays)}
              </span>
            ),
          },
          {
            key: 'fillRate', header: 'Fill Rate', numeric: true, sortable: true, width: '100px',
            cell: r => (
              <div className="flex flex-col items-end">
                <span className="font-mono tabular-nums">{fmtPct(r.fillRate)}</span>
                {(r.fullyReceived + r.partiallyReceived) > 0 && (
                  <span className="text-[10px] font-mono text-fg-subtle">
                    {r.fullyReceived}/{r.fullyReceived + r.partiallyReceived}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'totalSpend', header: 'Spend', numeric: true, sortable: true, width: '120px',
            heatmap: true,
            heatmapValue: r => r.totalSpend,
            cell: r => (
              <div className="flex flex-col items-end">
                <span className="font-mono font-semibold tabular-nums">{fmtMoneyCompact(r.totalSpend)}</span>
                <span className="text-[10px] font-mono text-fg-subtle">{r.totalPOs} POs</span>
              </div>
            ),
          },
          {
            key: 'lastPoAt', header: 'Last PO', numeric: true, sortable: true, width: '90px',
            cell: r => (
              <span className="font-mono tabular-nums text-[11px] text-fg-muted">
                {fmtShort(r.lastPoAt)}
              </span>
            ),
          },
        ]}
        rowActions={[
          {
            id: 'detail',
            icon: <ExternalLink className="w-3.5 h-3.5" />,
            label: 'Open scorecard',
            shortcut: '↵',
            onClick: r => router.push(`/ops/vendors/scorecard/${r.vendorId}?days=${days}`),
          },
        ]}
        empty={
          <EmptyState
            icon="package"
            size="compact"
            title="No vendor activity"
            description={gradeFilter === 'all'
              ? `No POs in the last ${days} days.`
              : `No vendors match grade filter "${gradeFilter}".`}
            secondaryAction={gradeFilter !== 'all' ? { label: 'Clear filter', onClick: () => setGradeFilter('all') } : undefined}
          />
        }
      />
    </div>
  )
}
