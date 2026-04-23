'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  PageHeader, KPICard, Badge, Card, CardHeader, CardTitle, CardDescription, CardBody,
  EmptyState, LiveDataIndicator, InfoTip, Dialog,
} from '@/components/ui'
import {
  Check, X, FileText, Lock, AlertTriangle, CheckCircle2, Clock,
  RefreshCw, DollarSign, FileCheck, Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────────────────────
// Monthly Close Workflow
// ──────────────────────────────────────────────────────────────────────────
// Dawn's month-end checklist. Pick a month → step through invoicing, PO
// receipt, AR/AP review, snapshot, QB sync, reconciliation. Each action
// writes to MonthlyClose and audits.
// ──────────────────────────────────────────────────────────────────────────

interface CloseRow {
  id: string
  year: number
  month: number
  invoicesIssued: boolean
  posReceived: boolean
  arReviewed: boolean
  apReviewed: boolean
  snapshotTaken: boolean
  qbSynced: boolean
  reconciliationVariance: number | null
  reconciliationOk: boolean
  status: string
  closedAt: string | null
  invoicesIssuedAt: string | null
  posReceivedAt: string | null
  arReviewedAt: string | null
  apReviewedAt: string | null
  snapshotTakenAt: string | null
  qbSyncedAt: string | null
  reconciledAt: string | null
}

interface CloseHints {
  draftInvoiceCount: number
  openPOCount: number
}

interface HistoryRow {
  year: number
  month: number
  status: string
  closedAt: string | null
  reconciliationVariance: number | null
}

const STEPS: Array<{
  key: 'invoicesIssued' | 'posReceived' | 'arReviewed' | 'apReviewed' | 'snapshotTaken' | 'qbSynced'
  title: string
  description: string
  critical: boolean
}> = [
  { key: 'invoicesIssued', title: 'All invoices issued for the month', description: 'Every draft invoice has been sent (status != DRAFT).', critical: true },
  { key: 'posReceived',    title: 'All POs received',                  description: 'Open POs for the month have been received or rolled forward.', critical: true },
  { key: 'arReviewed',     title: 'AR aging reviewed',                description: 'Walked the aging waterfall, queued reminders for 60+ day invoices.', critical: true },
  { key: 'apReviewed',     title: 'AP aging reviewed',                description: 'Vendor payables bucketed into pay windows.', critical: true },
  { key: 'snapshotTaken',  title: 'Financial snapshot taken',         description: 'FinancialSnapshot row captured for month-end.', critical: true },
  { key: 'qbSynced',       title: 'Month-end sync to QuickBooks',     description: 'Journal entries pushed to QBO (stub today).', critical: false },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function MonthlyClosePage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [close, setClose] = useState<CloseRow | null>(null)
  const [hints, setHints] = useState<CloseHints | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState<number | null>(null)

  const [varianceModal, setVarianceModal] = useState(false)
  const [varianceInput, setVarianceInput] = useState('')

  const [reportModal, setReportModal] = useState(false)
  const [report, setReport] = useState<any>(null)

  async function fetchData() {
    try {
      const res = await fetch(`/api/ops/finance/monthly-close?year=${year}&month=${month}`)
      const j = await res.json()
      if (res.ok) {
        setClose(j.close)
        setHints(j.hints)
        setHistory(j.history)
        setTick(Date.now())
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setLoading(true); fetchData() /* eslint-disable-next-line */ }, [year, month])

  async function toggleStep(step: string) {
    setBusy(step)
    try {
      const res = await fetch('/api/ops/finance/monthly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, action: 'toggle', step }),
      })
      const j = await res.json()
      if (res.ok) setClose(j.close)
    } finally {
      setBusy(null)
    }
  }

  async function triggerQbSync() {
    setBusy('qbSynced')
    try {
      const res = await fetch('/api/ops/finance/monthly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, action: 'qb_sync' }),
      })
      const j = await res.json()
      if (res.ok) {
        setClose(j.close)
        alert(j.qb?.message ?? 'QB sync triggered.')
      } else {
        alert(j.error ?? 'Failed')
      }
    } finally {
      setBusy(null)
    }
  }

  async function submitVariance() {
    const v = parseFloat(varianceInput)
    if (!Number.isFinite(v)) { alert('Enter a number'); return }
    setBusy('reconcile')
    try {
      const res = await fetch('/api/ops/finance/monthly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, action: 'reconcile', variancePct: v }),
      })
      const j = await res.json()
      if (res.ok) { setClose(j.close); setVarianceModal(false); setVarianceInput('') }
      else alert(j.error ?? 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function closeMonth() {
    if (!confirm(`Close ${MONTHS[month - 1]} ${year}? This marks the month as finalized.`)) return
    setBusy('close')
    try {
      const res = await fetch('/api/ops/finance/monthly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, action: 'close_month' }),
      })
      const j = await res.json()
      if (res.ok) setClose(j.close)
      else alert(j.error ?? 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function generateReport() {
    setBusy('report')
    try {
      const res = await fetch('/api/ops/finance/monthly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, action: 'generate_report' }),
      })
      const j = await res.json()
      if (res.ok) { setReport(j.report); setReportModal(true) }
      else alert(j.error ?? 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const progress = useMemo(() => {
    if (!close) return { completed: 0, total: STEPS.length + 1 }
    let completed = 0
    for (const s of STEPS) if ((close as any)[s.key]) completed++
    if (close.reconciliationOk) completed++
    return { completed, total: STEPS.length + 1 }
  }, [close])

  const pctDone = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0

  return (
    <div className="p-6 space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Accounting"
        title="Monthly Close"
        description="Step through the month-end checklist. All actions are audit-logged."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      {/* Month selector */}
      <Card variant="default" padding="md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="input h-9 w-28 text-sm">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="input h-9 w-24 text-sm">
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {close && (
              <Badge
                variant={close.status === 'CLOSED' ? 'success' : close.status === 'IN_PROGRESS' ? 'warning' : 'neutral'}
                size="sm"
              >
                {close.status === 'CLOSED' && <Lock className="w-3 h-3" />}
                {close.status.replace('_', ' ')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={generateReport} disabled={busy !== null} className="btn btn-secondary btn-sm">
              <FileText className="w-3.5 h-3.5" /> Generate report
            </button>
            {close?.status !== 'CLOSED' && (
              <button onClick={closeMonth} disabled={busy !== null || progress.completed < STEPS.length} className="btn btn-primary btn-sm">
                <Lock className="w-3.5 h-3.5" /> Close month
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Progress */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Progress" value={`${pctDone}%`} subtitle={`${progress.completed}/${progress.total} steps`} icon={<CheckCircle2 className="w-3.5 h-3.5" />} accent={pctDone === 100 ? 'positive' : 'accent'} />
        <KPICard title="Draft invoices" value={hints?.draftInvoiceCount ?? 0} subtitle="to issue for this month" icon={<FileText className="w-3.5 h-3.5" />} accent={hints && hints.draftInvoiceCount > 0 ? 'accent' : 'positive'} />
        <KPICard title="Open POs" value={hints?.openPOCount ?? 0} subtitle="to receive or roll" icon={<FileCheck className="w-3.5 h-3.5" />} accent={hints && hints.openPOCount > 0 ? 'accent' : 'positive'} />
        <KPICard
          title="Variance"
          value={close?.reconciliationVariance != null ? `${close.reconciliationVariance.toFixed(2)}%` : '—'}
          subtitle={close?.reconciliationOk ? 'Within tolerance' : close?.reconciliationVariance != null ? 'Above 1% tolerance' : 'Not entered'}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          accent={close?.reconciliationOk ? 'positive' : close?.reconciliationVariance != null ? 'negative' : 'neutral'}
        />
      </div>

      {/* Checklist */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Close Checklist</CardTitle>
            <CardDescription>Mark each step as you complete it. Critical steps are required to finalize.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="py-6 text-center text-sm text-fg-muted">Loading…</div>
          ) : !close ? (
            <EmptyState icon="document" title="No data" description="Couldn't load the close row." size="compact" />
          ) : (
            <div className="divide-y divide-border">
              {STEPS.map(step => {
                const done = (close as any)[step.key] as boolean
                const at = (close as any)[`${step.key}At`] as string | null
                const isQb = step.key === 'qbSynced'
                return (
                  <div key={step.key} className="flex items-start gap-3 py-3">
                    <button
                      onClick={() => isQb ? triggerQbSync() : toggleStep(step.key)}
                      disabled={busy !== null || close.status === 'CLOSED'}
                      className={cn(
                        'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                        done ? 'bg-data-positive border-data-positive text-white' : 'border-border hover:border-brand',
                      )}
                      title={done ? 'Mark incomplete' : 'Mark complete'}
                      aria-label={done ? 'completed' : 'incomplete'}
                    >
                      {done && <Check className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-fg">{step.title}</span>
                        {step.critical && <Badge variant="neutral" size="xs">required</Badge>}
                        {isQb && <Badge variant="info" size="xs">stub</Badge>}
                      </div>
                      <div className="text-[11px] text-fg-muted">{step.description}</div>
                      {done && at && (
                        <div className="text-[10px] text-fg-subtle mt-0.5">Completed {fmtDate(at)}</div>
                      )}
                    </div>
                    {busy === step.key && <Clock className="w-4 h-4 text-accent animate-pulse" />}
                  </div>
                )
              })}

              {/* Reconciliation step */}
              <div className="flex items-start gap-3 py-3">
                <button
                  onClick={() => { setVarianceInput(close.reconciliationVariance?.toString() ?? ''); setVarianceModal(true) }}
                  disabled={busy !== null || close.status === 'CLOSED'}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                    close.reconciliationOk ? 'bg-data-positive border-data-positive text-white'
                      : close.reconciliationVariance != null ? 'bg-data-negative border-data-negative text-white'
                      : 'border-border hover:border-brand',
                  )}
                >
                  {close.reconciliationOk ? <Check className="w-3.5 h-3.5" /> : close.reconciliationVariance != null ? <X className="w-3.5 h-3.5" /> : null}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-fg">Reconciliation variance &lt; 1%</span>
                    <Badge variant="neutral" size="xs">required</Badge>
                  </div>
                  <div className="text-[11px] text-fg-muted">Compare book vs bank. Enter the variance %.</div>
                  {close.reconciliationVariance != null && (
                    <div className={cn('text-[11px] mt-0.5 font-medium tabular-nums',
                      close.reconciliationOk ? 'text-data-positive' : 'text-data-negative')}>
                      Variance: {close.reconciliationVariance.toFixed(2)}%
                      {close.reconciledAt && ` · ${fmtDate(close.reconciledAt)}`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Close history */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Recent Closes</CardTitle>
            <CardDescription>Last 12 months</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <EmptyState icon="document" size="compact" title="No history" description="No previous closes yet." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => { setMonth(h.month); setYear(h.year) }}
                  className="panel panel-interactive p-2 text-left hover:border-brand/40"
                >
                  <div className="text-[11px] font-semibold text-fg">{MONTHS[h.month - 1]} {h.year}</div>
                  <div className="flex items-center gap-1 mt-1">
                    {h.status === 'CLOSED' ? <Lock className="w-3 h-3 text-data-positive" /> : h.status === 'IN_PROGRESS' ? <Clock className="w-3 h-3 text-accent" /> : null}
                    <span className="text-[10px] text-fg-muted capitalize">{h.status.replace('_', ' ').toLowerCase()}</span>
                  </div>
                  {h.reconciliationVariance != null && (
                    <div className="text-[10px] text-fg-subtle tabular-nums mt-0.5">
                      Var: {h.reconciliationVariance.toFixed(2)}%
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Variance modal */}
      <Dialog
        open={varianceModal}
        onClose={() => setVarianceModal(false)}
        title="Reconciliation Variance"
        description="Enter the variance % between book and bank. < 1% passes."
        size="sm"
        footer={
          <>
            <button onClick={() => setVarianceModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
            <button onClick={submitVariance} disabled={busy !== null} className="btn btn-primary btn-sm">Save</button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-fg-muted">Variance %</label>
          <input
            type="number"
            step="0.01"
            value={varianceInput}
            onChange={e => setVarianceInput(e.target.value)}
            className="input w-full"
            placeholder="0.45"
            autoFocus
          />
        </div>
      </Dialog>

      {/* Report modal */}
      <Dialog
        open={reportModal}
        onClose={() => setReportModal(false)}
        title={report ? `Monthly Report — ${MONTHS[report.month - 1]} ${report.year}` : undefined}
        description={report ? `As of ${new Date(report.asOf).toLocaleDateString()}` : undefined}
        size="lg"
        footer={
          <>
            <button onClick={() => window.print()} className="btn btn-secondary btn-sm">
              <Download className="w-3.5 h-3.5" /> Print
            </button>
            <button onClick={() => setReportModal(false)} className="btn btn-primary btn-sm">Close</button>
          </>
        }
      >
        {report && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="panel p-3">
                <div className="text-[11px] eyebrow">Revenue Issued</div>
                <div className="text-[20px] font-bold tabular-nums text-data-positive">
                  ${report.revenueIssued.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-fg-subtle">{report.invoicesIssued} invoices</div>
              </div>
              <div className="panel p-3">
                <div className="text-[11px] eyebrow">AR Outstanding</div>
                <div className="text-[20px] font-bold tabular-nums text-fg">
                  ${report.arOutstanding.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-fg-subtle">end of period</div>
              </div>
              <div className="panel p-3">
                <div className="text-[11px] eyebrow">AP Outstanding</div>
                <div className="text-[20px] font-bold tabular-nums text-data-negative">
                  ${report.apOutstanding.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-fg-subtle">end of period</div>
              </div>
              <div className="panel p-3">
                <div className="text-[11px] eyebrow">Net position</div>
                <div className="text-[20px] font-bold tabular-nums text-fg">
                  ${(report.arOutstanding - report.apOutstanding).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-fg-subtle">AR − AP</div>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
