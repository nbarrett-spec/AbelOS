'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Download, Link as LinkIcon, Mail, Copy, Check, Calendar, RefreshCw } from 'lucide-react'
import { PageHeader, Button } from '@/components/ui'
import type { MonthlyRollup } from '@/lib/finance/monthly-rollup'
import {
  FinancialYtdStrip,
  FinancialMonthTable,
  FinancialLineChart,
  YearQuarterControls,
  type QuarterFilter,
} from '@/components/FinancialChart'

interface KPIData {
  asOf?: string
  isSnapshot?: boolean
  snapshotSource?: 'FinancialSnapshot' | 'live'
  deliveries: {
    thisMonth: number
    completed: number
    late: number
    today: { total: number; completed: number }
  }
  onTimeDeliveryRate: number
  revenue: {
    thisMonth: number
    lastMonth: number
    changePercent: number
  }
  openOrders: number
  jobsPipeline: Array<{ stage: string; count: number }>
  ar: {
    unpaidInvoices: number
    outstandingAmount: number
    overdueCount: number
    overdueAmount: number
  }
  quoteConversion: number
  activeCrews: number
  lowStockItems: number
  arAging: Array<{
    bucket: string
    invoiceCount: number
    amount: number
  }>
}

type SectionId = 'summary' | 'ar-aging' | 'pipeline' | 'revenue' | 'hw-pitch'

export default function KPIDashboard() {
  const sp = useSearchParams()
  const router = useRouter()
  const atParam = sp.get('at')

  const [data, setData] = useState<KPIData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // ── YTD rollup ──
  const currentYear = new Date().getUTCFullYear()
  const currentMonth = new Date().getUTCMonth() + 1
  const [rollup, setRollup] = useState<MonthlyRollup | null>(null)
  const [rollupYear, setRollupYear] = useState<number>(currentYear)
  const [quarter, setQuarter] = useState<QuarterFilter>('YTD')

  useEffect(() => {
    fetch(`/api/ops/finance/monthly-rollup?year=${rollupYear}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setRollup(d) })
      .catch(() => { /* silent */ })
  }, [rollupYear])

  const loadKPIs = useCallback(async () => {
    try {
      const qs = atParam ? `?at=${encodeURIComponent(atParam)}` : ''
      const res = await fetch(`/api/ops/kpis${qs}`)
      if (res.ok) {
        const kpiData = await res.json()
        setData(kpiData)
        setLastUpdated(new Date())
      }
    } catch (err) {
      console.error('Failed to load KPIs:', err)
    } finally {
      setLoading(false)
    }
  }, [atParam])

  useEffect(() => {
    setLoading(true)
    loadKPIs()
    if (atParam) return // snapshot mode — no auto-refresh
    const interval = setInterval(loadKPIs, 60000)
    return () => clearInterval(interval)
  }, [loadKPIs, atParam])

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n)

  // ── Actions ────────────────────────────────────────────────────────────
  const exportCsv = (section: SectionId = 'summary') => {
    const qs = new URLSearchParams({ section, format: 'csv' })
    if (atParam) qs.set('at', atParam)
    window.location.href = `/api/ops/kpis/export?${qs.toString()}`
  }

  const [linkCopied, setLinkCopied] = useState(false)
  const copyShareLink = () => {
    const at = atParam || new Date().toISOString().slice(0, 10)
    const url = `${window.location.origin}/ops/kpis?at=${at}`
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  const emailTo = () => {
    const at = atParam || new Date().toISOString().slice(0, 10)
    const url = `${window.location.origin}/ops/kpis?at=${at}`
    const subject = `Abel KPIs — ${at}`
    const summary = data
      ? [
          `As of: ${at}`,
          `Revenue (MTD): ${fmt(data.revenue.thisMonth)} (${data.revenue.changePercent >= 0 ? '+' : ''}${data.revenue.changePercent}% vs prior)`,
          `Outstanding AR: ${fmt(data.ar.outstandingAmount)} (${data.ar.unpaidInvoices} invoices)`,
          `Overdue: ${fmt(data.ar.overdueAmount)} (${data.ar.overdueCount} invoices)`,
          `Open orders: ${data.openOrders}`,
          `On-time delivery (30d): ${data.onTimeDeliveryRate}%`,
          `Quote conversion (30d): ${data.quoteConversion}%`,
          ``,
          `Full snapshot: ${url}`,
        ].join('\n')
      : `Snapshot: ${url}`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary)}`
  }

  const copySectionCsv = async (section: SectionId) => {
    try {
      const qs = new URLSearchParams({ section, format: 'csv' })
      if (atParam) qs.set('at', atParam)
      const res = await fetch(`/api/ops/kpis/export?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Copy CSV failed:', err)
      alert('Failed to copy CSV')
    }
  }

  // ── Date range picker ──────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const [pickerDate, setPickerDate] = useState<string>(atParam || today)
  const applySnapshot = () => {
    if (!pickerDate || pickerDate === today) {
      router.push('/ops/kpis')
    } else {
      router.push(`/ops/kpis?at=${encodeURIComponent(pickerDate)}`)
    }
  }
  const clearSnapshot = () => {
    setPickerDate(today)
    router.push('/ops/kpis')
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => exportCsv('summary')}>
          <Download className="w-4 h-4 mr-1.5" /> Export
        </Button>
        <Button variant="ghost" size="sm" onClick={copyShareLink}>
          {linkCopied ? (
            <><Check className="w-4 h-4 mr-1.5" /> Copied</>
          ) : (
            <><LinkIcon className="w-4 h-4 mr-1.5" /> Copy link</>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={emailTo}>
          <Mail className="w-4 h-4 mr-1.5" /> Email to…
        </Button>
      </div>
    ),
    [linkCopied, atParam, data], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Operations KPIs"
          description="Real-time key performance indicators"
          actions={headerActions}
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Operations KPIs"
          description="Real-time key performance indicators"
          actions={headerActions}
        />
        <div className="text-center text-gray-500 py-8">
          Failed to load KPI data. Please try again.
        </div>
      </div>
    )
  }

  const onTimeColor = data.onTimeDeliveryRate >= 95 ? 'text-green-600' : data.onTimeDeliveryRate >= 90 ? 'text-signal' : 'text-red-600'
  const onTimeBg = data.onTimeDeliveryRate >= 95 ? 'bg-green-50' : data.onTimeDeliveryRate >= 90 ? 'bg-amber-50' : 'bg-red-50'
  const onTimeArrow = data.onTimeDeliveryRate >= 95 ? '↑' : data.onTimeDeliveryRate >= 85 ? '→' : '↓'

  const revenueArrow = data.revenue.changePercent >= 0 ? '↑' : '↓'
  const revenueColor = data.revenue.changePercent >= 0 ? 'text-green-600' : 'text-red-600'

  const lowStockColor = data.lowStockItems > 5 ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'
  const lowStockText = data.lowStockItems > 5 ? 'text-red-700' : 'text-orange-700'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations KPIs"
        description={
          atParam
            ? `Snapshot as of ${atParam}${data.snapshotSource === 'FinancialSnapshot' ? ' — from FinancialSnapshot' : ' — recomputed'}`
            : `Real-time • Last updated: ${lastUpdated?.toLocaleTimeString() ?? '—'}`
        }
        actions={headerActions}
      />

      {/* Date range / snapshot picker */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Calendar className="w-4 h-4" />
          <span>Snapshot date:</span>
        </div>
        <input
          type="date"
          value={pickerDate}
          max={today}
          onChange={(e) => setPickerDate(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm"
        />
        <Button size="sm" variant="primary" onClick={applySnapshot}>
          Apply
        </Button>
        {atParam && (
          <Button size="sm" variant="ghost" onClick={clearSnapshot}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Back to live
          </Button>
        )}
        {atParam && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
            Viewing historical data
          </span>
        )}
      </div>

      {/* ── YTD KPI strip + per-month table + chart ───────────────────── */}
      {rollup && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide font-semibold text-gray-500">Year to Date</div>
              <div className="text-sm text-gray-600">{rollup.year} · live from Orders / Invoices / Payments / POs</div>
            </div>
            <YearQuarterControls
              year={rollupYear}
              availableYears={[currentYear - 2, currentYear - 1, currentYear]}
              onYearChange={setRollupYear}
              quarter={quarter}
              onQuarterChange={setQuarter}
            />
          </div>
          <FinancialYtdStrip ytd={rollup.ytd} />
          <FinancialMonthTable
            months={rollup.months}
            currentMonth={rollupYear === currentYear ? currentMonth : 12}
            quarter={quarter}
          />
          <FinancialLineChart
            months={rollup.months}
            currentMonth={rollupYear === currentYear ? currentMonth : 0}
          />
        </div>
      )}

      {/* ROW 1: Hero KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-5 ${onTimeBg}`}>
          <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">On-Time Delivery Rate</p>
          <div className="mt-3 flex items-baseline gap-2">
            <p className={`text-3xl font-bold ${onTimeColor}`}>{data.onTimeDeliveryRate}%</p>
            <span className={`text-lg ${onTimeColor}`}>{onTimeArrow}</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {data.onTimeDeliveryRate >= 95 ? 'Excellent performance' : data.onTimeDeliveryRate >= 90 ? 'Good, room to improve' : 'Needs attention'}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 hover:shadow-md transition-shadow">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Revenue This Month</p>
          <div className="mt-3">
            <p className="text-3xl font-bold text-gray-900">{fmt(data.revenue.thisMonth)}</p>
            <div className="flex items-center gap-1 mt-2">
              <span className={`text-sm font-semibold ${revenueColor}`}>
                {revenueArrow} {Math.abs(data.revenue.changePercent)}%
              </span>
              <span className="text-xs text-gray-500">vs last month</span>
            </div>
          </div>
        </div>

        <Link href="/ops/orders" className="group">
          <div className="rounded-xl border bg-white p-5 hover:shadow-md transition-shadow cursor-pointer group-hover:border-[#0f2a3e]">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Open Orders</p>
            <p className="text-3xl font-bold text-gray-900 mt-3">{data.openOrders}</p>
            <p className="text-xs text-gray-400 mt-2">Ready for action →</p>
          </div>
        </Link>

        <div className="rounded-xl border bg-white p-5 hover:shadow-md transition-shadow">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Quote Conversion (30d)</p>
          <p className="text-3xl font-bold text-gray-900 mt-3">{data.quoteConversion}%</p>
          <p className="text-xs text-gray-400 mt-2">{data.jobsPipeline.length} jobs in pipeline</p>
        </div>
      </div>

      {/* ROW 2: Operations Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-white p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Deliveries Today</p>
          <div className="mt-3">
            <p className="text-2xl font-bold text-gray-900">
              {data.deliveries.today.completed} <span className="text-gray-400">/ {data.deliveries.today.total}</span>
            </p>
            <p className="text-xs text-gray-500 mt-2">completed of scheduled</p>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Active Crews</p>
          <p className="text-2xl font-bold text-gray-900 mt-3">{data.activeCrews}</p>
          <p className="text-xs text-gray-500 mt-2">teams deployed</p>
        </div>

        <div className={`rounded-xl border p-5 ${lowStockColor}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Low Stock Alerts</p>
          <p className={`text-2xl font-bold mt-3 ${lowStockText}`}>{data.lowStockItems}</p>
          <p className="text-xs text-gray-500 mt-2">{data.lowStockItems > 5 ? 'Urgent' : 'Monitor closely'}</p>
        </div>

        <div className="rounded-xl border bg-red-50 p-5">
          <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">Overdue Invoices</p>
          <p className="text-2xl font-bold text-red-600 mt-3">{fmt(data.ar.overdueAmount)}</p>
          <p className="text-xs text-gray-600 mt-2">across {data.ar.overdueCount} invoices</p>
        </div>
      </div>

      {/* ROW 3: Job Pipeline */}
      <SectionCard
        title="Job Pipeline"
        section="pipeline"
        onCopy={() => copySectionCsv('pipeline')}
        onExport={() => exportCsv('pipeline')}
      >
        <div className="space-y-2">
          {data.jobsPipeline.map((stage: any) => {
            const total = data.jobsPipeline.reduce((sum: number, s: any) => sum + s.count, 0)
            const pct = total > 0 ? (stage.count / total) * 100 : 0

            const stageColors: Record<string, string> = {
              'CREATED': '#95A5A6',
              'READINESS_CHECK': '#3498DB',
              'MATERIALS_LOCKED': '#3498DB',
              'IN_PRODUCTION': '#C6A24E',
              'STAGED': '#D4B96A',
              'LOADED': '#D4B96A',
              'IN_TRANSIT': '#F1C40F',
              'DELIVERED': '#2ECC71',
              'INSTALLING': '#1ABC9C',
              'PUNCH_LIST': '#E74C3C',
              'COMPLETE': '#27AE60',
              'INVOICED': '#16A085',
              'CLOSED': '#7F8C8D',
            }

            const stageLabels: Record<string, string> = {
              'CREATED': 'Created',
              'READINESS_CHECK': 'T-72',
              'MATERIALS_LOCKED': 'T-48',
              'IN_PRODUCTION': 'Mfg',
              'STAGED': 'Staging',
              'LOADED': 'Loaded',
              'IN_TRANSIT': 'Transit',
              'DELIVERED': 'Delivered',
              'INSTALLING': 'Install',
              'PUNCH_LIST': 'Punch',
              'COMPLETE': 'Complete',
              'INVOICED': 'Invoiced',
              'CLOSED': 'Closed',
            }

            return (
              <div key={stage.stage} className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: stageColors[stage.stage] || '#9CA3AF' }}
                />
                <span className="text-sm text-gray-600 w-16">{stageLabels[stage.stage] || stage.stage}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.max(pct, stage.count > 0 ? 2 : 0)}%`,
                      backgroundColor: stageColors[stage.stage] || '#9CA3AF',
                    }}
                  />
                </div>
                <span className={`text-sm font-medium w-8 text-right ${stage.count > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                  {stage.count}
                </span>
              </div>
            )
          })}
          {data.jobsPipeline.length === 0 && (
            <p className="text-xs text-gray-400 text-center pt-2">No jobs in pipeline</p>
          )}
        </div>
      </SectionCard>

      {/* ROW 4: AR Aging */}
      <SectionCard
        title="AR Aging Summary"
        section="ar-aging"
        onCopy={() => copySectionCsv('ar-aging')}
        onExport={() => exportCsv('ar-aging')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.arAging.map((aging: any) => {
            const agingColors: Record<string, { bg: string; border: string; text: string }> = {
              'Current': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
              '1-30 Days': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
              '31-60 Days': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
              '60+ Days': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
            }

            const colors = agingColors[aging.bucket] || { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' }

            return (
              <div key={aging.bucket} className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
                <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">{aging.bucket}</p>
                <p className={`text-xl font-bold mt-2 ${colors.text}`}>{fmt(aging.amount)}</p>
                <p className="text-xs text-gray-600 mt-1">{aging.invoiceCount} invoice{aging.invoiceCount !== 1 ? 's' : ''}</p>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Summary Stats */}
      <SectionCard
        title="Monthly Summary"
        section="summary"
        onCopy={() => copySectionCsv('summary')}
        onExport={() => exportCsv('summary')}
        tone="muted"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">This Month Deliveries</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{data.deliveries.completed}/{data.deliveries.thisMonth}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Outstanding AR</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{fmt(data.ar.outstandingAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Unpaid Invoices</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{data.ar.unpaidInvoices}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Jobs in Progress</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {data.jobsPipeline.filter(j => !['CREATED', 'CLOSED'].includes(j.stage)).reduce((sum, j) => sum + j.count, 0)}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Section card with its own Copy + Export buttons ────────────────────────
function SectionCard({
  title,
  section,
  onCopy,
  onExport,
  tone,
  children,
}: {
  title: string
  section: SectionId
  onCopy: () => void
  onExport: () => void
  tone?: 'muted'
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const doCopy = async () => {
    try {
      await onCopy()
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // surfaced via alert inside onCopy
    }
  }
  return (
    <div className={`rounded-xl border p-5 ${tone === 'muted' ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={doCopy}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded border border-transparent hover:border-gray-200 transition"
            title="Copy section as CSV"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy as CSV'}
          </button>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded border border-transparent hover:border-gray-200 transition"
            title="Download section as CSV"
            aria-label={`Download ${section} CSV`}
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}
