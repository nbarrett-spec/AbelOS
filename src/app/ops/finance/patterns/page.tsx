'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  RefreshCw, Award, AlertTriangle, CheckCircle2, Clock, TrendingUp,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  LiveDataIndicator,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────────────────────
// Builder Payment Patterns
// ──────────────────────────────────────────────────────────────────────────
// Per-builder: avg days to pay, term compliance %, grade A..F.
// Click → builder AR detail.
// ──────────────────────────────────────────────────────────────────────────

interface Pattern {
  builderId: string
  builderName: string
  paymentTerm: string | null
  contractedTermDays: number
  avgDaysToPay: number | null
  avgDaysLate: number | null
  termCompliance: number | null
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | '—'
  sampleSize: number
  paidAmount: number
  currentOutstanding: number
  openInvoiceCount: number
  creditLimit: number | null
}

interface PatternsData {
  asOf: string
  patterns: Pattern[]
  pendingGrade: Pattern[]
}

const GRADE_COLOR: Record<Pattern['grade'], string> = {
  A: 'bg-data-positive/15 text-data-positive border-data-positive/30',
  B: 'bg-forecast/15 text-forecast border-forecast/30',
  C: 'bg-accent/15 text-accent border-accent/30',
  D: 'bg-data-negative/10 text-data-negative border-data-negative/30',
  F: 'bg-data-negative/20 text-data-negative border-data-negative/40',
  '—': 'bg-surface-muted text-fg-subtle border-border',
}

const fmtMoney = (n: number) =>
  n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export default function BuilderPatternsPage() {
  const router = useRouter()
  const [data, setData] = useState<PatternsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState<number | null>(null)
  const [gradeFilter, setGradeFilter] = useState<string>('all')

  async function fetchData() {
    try {
      const res = await fetch('/api/ops/finance/payment-patterns')
      if (!res.ok) throw new Error('Failed')
      setData(await res.json())
      setTick(Date.now())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const summary = useMemo(() => {
    if (!data) return { A: 0, B: 0, C: 0, D: 0, F: 0 }
    const s = { A: 0, B: 0, C: 0, D: 0, F: 0 } as Record<string, number>
    for (const p of data.patterns) s[p.grade] = (s[p.grade] ?? 0) + 1
    return s as { A: number; B: number; C: number; D: number; F: number }
  }, [data])

  const filteredPatterns = useMemo(() => {
    if (!data) return []
    if (gradeFilter === 'all') return data.patterns
    return data.patterns.filter(p => p.grade === gradeFilter)
  }, [data, gradeFilter])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Builder Payment Patterns" description="Per-builder grade: avg days to pay, term compliance." />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0,1,2,3,4].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Finance"
        title="Builder Payment Patterns"
        description="Grade every builder on payment behavior. Click a row to jump to their AR detail."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      {/* Grade summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard title="Grade A" value={summary.A} subtitle="On-time ≥ 95%" icon={<Award className="w-3.5 h-3.5" />} accent="positive" onClick={() => setGradeFilter('A')} />
        <KPICard title="Grade B" value={summary.B} subtitle="Mostly on time"     icon={<CheckCircle2 className="w-3.5 h-3.5" />} accent="forecast" onClick={() => setGradeFilter('B')} />
        <KPICard title="Grade C" value={summary.C} subtitle="Occasionally late"  icon={<Clock className="w-3.5 h-3.5" />} accent="accent" onClick={() => setGradeFilter('C')} />
        <KPICard title="Grade D" value={summary.D} subtitle="Chronically late"   icon={<AlertTriangle className="w-3.5 h-3.5" />} accent="negative" onClick={() => setGradeFilter('D')} />
        <KPICard title="Grade F" value={summary.F} subtitle="Collections risk"   icon={<AlertTriangle className="w-3.5 h-3.5" />} accent="negative" onClick={() => setGradeFilter('F')} />
      </div>

      {/* Pending grade (no payment history yet) */}
      {data.pendingGrade.length > 0 && (
        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>Awaiting First Payment</CardTitle>
              <CardDescription>Builders with open invoices but no payment history — no grade yet.</CardDescription>
            </div>
            <Badge variant="neutral" size="sm">{data.pendingGrade.length}</Badge>
          </CardHeader>
          <CardBody>
            <div className="flex gap-2 flex-wrap">
              {data.pendingGrade.map(p => (
                <button
                  key={p.builderId}
                  onClick={() => router.push(`/ops/accounts/${p.builderId}`)}
                  className="panel panel-interactive p-2 px-3 flex items-center gap-2 hover:border-brand/40"
                >
                  <span className="text-[12px] font-semibold text-fg">{p.builderName}</span>
                  <span className="text-[10px] text-fg-subtle">· {p.paymentTerm?.replace('_', ' ') ?? '—'}</span>
                  <span className="text-[10px] text-data-negative tabular-nums">{fmtMoney(p.currentOutstanding)}</span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Filter bar */}
      {gradeFilter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-fg-muted">Showing only grade {gradeFilter}</span>
          <button onClick={() => setGradeFilter('all')} className="btn btn-ghost btn-xs">Clear</button>
        </div>
      )}

      {/* Patterns table */}
      <DataTable
        density="default"
        data={filteredPatterns}
        rowKey={r => r.builderId}
        onRowClick={r => router.push(`/ops/accounts/${r.builderId}`)}
        keyboardNav
        hint
        columns={[
          { key: 'builderName', header: 'Builder', sortable: true,
            cell: r => (
              <div className="flex items-center gap-2">
                <span className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md border font-bold text-[12px]', GRADE_COLOR[r.grade])}>
                  {r.grade}
                </span>
                <div>
                  <div className="font-semibold text-fg text-[13px]">{r.builderName}</div>
                  <div className="text-[10px] text-fg-subtle">{r.paymentTerm?.replace('_', ' ') ?? '—'} · {r.sampleSize} pymts</div>
                </div>
              </div>
            ) },
          { key: 'avgDaysToPay', header: 'Avg days to pay', numeric: true, sortable: true, width: '110px',
            cell: r => <span className="tabular-nums text-[12px]">{r.avgDaysToPay ?? '—'}d</span> },
          { key: 'avgDaysLate', header: 'Avg days late', numeric: true, sortable: true, width: '110px',
            cell: r => {
              const v = r.avgDaysLate
              if (v == null) return <span className="text-fg-subtle">—</span>
              return (
                <span className={cn('tabular-nums text-[12px] font-medium',
                  v <= 0 ? 'text-data-positive' : v <= 5 ? 'text-fg' : v <= 15 ? 'text-accent' : 'text-data-negative')}>
                  {v > 0 ? '+' : ''}{v}d
                </span>
              )
            } },
          { key: 'termCompliance', header: 'Term compliance', numeric: true, sortable: true, width: '140px',
            cell: r => {
              const c = r.termCompliance
              if (c == null) return <span className="text-fg-subtle">—</span>
              return (
                <div className="flex items-center gap-2 justify-end">
                  <div className="w-20 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full transition-all',
                        c >= 90 ? 'bg-data-positive' : c >= 70 ? 'bg-accent' : 'bg-data-negative')}
                      style={{ width: `${c}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-[11px] font-semibold w-9 text-right">{c}%</span>
                </div>
              )
            } },
          { key: 'currentOutstanding', header: 'Outstanding', numeric: true, sortable: true,
            cell: r => (
              <div className="flex flex-col items-end">
                <span className="font-semibold tabular-nums">{fmtMoney(r.currentOutstanding)}</span>
                <span className="text-[10px] text-fg-subtle">{r.openInvoiceCount} open</span>
              </div>
            ) },
          { key: 'paidAmount', header: 'Lifetime paid', numeric: true, sortable: true,
            cell: r => <span className="tabular-nums text-fg-muted">{fmtMoney(r.paidAmount)}</span> },
          { key: 'creditLimit', header: 'Credit limit', numeric: true, width: '100px',
            cell: r => <span className="tabular-nums text-[11px] text-fg-muted">{r.creditLimit ? fmtMoney(r.creditLimit) : '—'}</span> },
        ]}
        empty={<EmptyState icon="users" size="compact" title="No payment history" description="Grades will appear once payments are recorded." />}
      />
    </div>
  )
}
