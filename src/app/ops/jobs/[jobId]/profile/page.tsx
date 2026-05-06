'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { fullName } from '@/lib/formatting'

// ──────────────────────────────────────────────────────────────────────────
// Job Profile — Deep multi-tab view of everything associated with a job
//
// Tabs: Overview | Phases | Deliveries | Invoices & POs | Materials |
//       Blueprints & Takeoffs | Comm Log | Activity | Documents
// ──────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  CREATED: { label: 'New', color: '#95A5A6', bg: 'bg-gray-100 text-gray-700' },
  READINESS_CHECK: { label: 'T-72 Check', color: '#3498DB', bg: 'bg-blue-100 text-blue-700' },
  MATERIALS_LOCKED: { label: 'T-48 Lock', color: '#4B0082', bg: 'bg-indigo-100 text-indigo-700' },
  IN_PRODUCTION: { label: 'Production', color: '#9B59B6', bg: 'bg-purple-100 text-purple-700' },
  STAGED: { label: 'Staged', color: '#F1C40F', bg: 'bg-yellow-100 text-yellow-800' },
  LOADED: { label: 'T-24 Loaded', color: '#C6A24E', bg: 'bg-orange-100 text-orange-700' },
  IN_TRANSIT: { label: 'In Transit', color: '#FFA500', bg: 'bg-amber-100 text-amber-700' },
  DELIVERED: { label: 'Delivered', color: '#1ABC9C', bg: 'bg-teal-100 text-teal-700' },
  INSTALLING: { label: 'Installing', color: '#00BCD4', bg: 'bg-cyan-100 text-cyan-700' },
  PUNCH_LIST: { label: 'Punch List', color: '#E74C3C', bg: 'bg-red-100 text-red-700' },
  COMPLETE: { label: 'Complete', color: '#27AE60', bg: 'bg-green-100 text-green-700' },
  INVOICED: { label: 'Invoiced', color: '#16A085', bg: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: 'Closed', color: '#7F8C8D', bg: 'bg-gray-200 text-gray-600' },
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'phases', label: 'Phases' },
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'invoices', label: 'Invoices & POs' },
  { key: 'materials', label: 'Materials' },
  { key: 'blueprints', label: 'Blueprints' },
  { key: 'comm-log', label: 'Comm Log' },
  { key: 'activity', label: 'Activity' },
]

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function JobProfilePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const jobId = params.jobId as string

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const res = await fetch(`/api/ops/jobs/${jobId}/profile`)
        if (!res.ok) throw new Error(res.status === 404 ? 'Job not found' : 'Failed to load')
        setData(await res.json())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading job profile')
      } finally {
        setLoading(false)
      }
    }
    if (jobId) load()
  }, [jobId])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse p-6">
        <div className="h-8 w-64 bg-gray-200 dark:bg-gray-800 rounded-lg" />
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl" />
        <div className="h-96 bg-gray-200 dark:bg-gray-800 rounded-2xl" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{error || 'Job not found'}</p>
        <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline">Go Back</button>
      </div>
    )
  }

  const { job, invoices, commLogs, changeOrders, blueprints, community, phaseSummary } = data
  const status = STATUS_CONFIG[job.status] || { label: job.status, color: '#6B7280', bg: 'bg-gray-100 text-gray-700' }
  const builder = job.order?.builder

  return (
    <div className="space-y-0">
      {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
      <div className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <Link href="/ops/jobs" className="hover:text-gray-700 dark:hover:text-gray-300">Jobs</Link>
        <span>/</span>
        {builder && (
          <>
            <Link href={`/ops/accounts/${builder.id}`} className="hover:text-gray-700 dark:hover:text-gray-300">{builder.companyName}</Link>
            <span>/</span>
          </>
        )}
        {community && (
          <>
            <Link href={`/ops/communities/${community.id}`} className="hover:text-gray-700 dark:hover:text-gray-300">{community.name}</Link>
            <span>/</span>
          </>
        )}
        <span className="text-gray-900 dark:text-white font-medium">{job.jobNumber}</span>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-6 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{job.jobNumber}</h1>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${status.bg}`}>
                {status.label}
              </span>
            </div>
            <p className="text-base text-gray-700 dark:text-gray-300">{job.builderName}</p>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
              {job.community && <span>{job.community}{job.lotBlock ? ` — ${job.lotBlock}` : ''}</span>}
              {job.jobAddress && <span>{job.jobAddress}</span>}
              {job.scopeType && <span>{job.scopeType.replace(/_/g, ' ')}</span>}
            </div>
          </div>

          {/* Right side stats */}
          <div className="flex items-center gap-6 text-right">
            {job.order && (
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Order Total</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(job.order.total || 0)}</p>
              </div>
            )}
            {phaseSummary.totalPhases > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Phase Progress</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">
                  {phaseSummary.completedPhases}/{phaseSummary.totalPhases}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Scheduled</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatDate(job.scheduledDate)}</p>
            </div>
          </div>
        </div>

        {/* Status Pipeline */}
        <div className="mt-4 flex items-center gap-0.5 overflow-x-auto pb-1">
          {['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'COMPLETE', 'INVOICED'].map((s) => {
            const sc = STATUS_CONFIG[s]
            const current = job.status === s
            const past = Object.keys(STATUS_CONFIG).indexOf(job.status) > Object.keys(STATUS_CONFIG).indexOf(s)
            return (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full min-w-[24px] transition-all ${
                  current ? 'ring-2 ring-offset-1' : ''
                }`}
                style={{
                  backgroundColor: past || current ? sc?.color || '#ccc' : '#e5e7eb',
                  ...(current && sc?.color ? { '--tw-ring-color': sc.color } as any : {}),
                }}
                title={sc?.label || s}
              />
            )
          })}
        </div>
      </div>

      {/* ── Tab Bar ──────────────────────────────────────────────────────
          BUG-12 (2026-05-06): bumped z-index from z-10 to z-30 so the
          sticky bar always paints over tab content (page chrome elsewhere
          uses z-10/z-20). Solid bg + isolate makes sure scroll under the
          bar doesn't bleed through. */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-30 isolate">
        <div className="px-6 flex items-center gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-[#0f2a3e] text-[#0f2a3e] dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
              {tab.key === 'deliveries' && job.deliveries?.length > 0 && (
                <span className="ml-1.5 text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{job.deliveries.length}</span>
              )}
              {tab.key === 'phases' && phaseSummary.totalPhases > 0 && (
                <span className="ml-1.5 text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{phaseSummary.completedPhases}/{phaseSummary.totalPhases}</span>
              )}
              {tab.key === 'invoices' && invoices?.length > 0 && (
                <span className="ml-1.5 text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{invoices.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────────
          Each tab is mounted only when active so unrelated tab contents
          can never visually overlap (BUG-12 defensive measure). */}
      <div className="p-6 relative z-0">
        {activeTab === 'overview' && <OverviewTab job={job} builder={builder} community={community} phaseSummary={phaseSummary} invoices={invoices} setActiveTab={setActiveTab} />}
        {activeTab === 'phases' && <PhasesTab phases={job.phases || []} phaseSummary={phaseSummary} jobId={jobId} />}
        {activeTab === 'deliveries' && <DeliveriesTab deliveries={job.deliveries || []} />}
        {activeTab === 'invoices' && <InvoicesTab invoices={invoices || []} order={job.order} changeOrders={changeOrders || []} />}
        {activeTab === 'materials' && <MaterialsTab items={job.order?.items || []} materialPicks={job.materialPicks || []} />}
        {activeTab === 'blueprints' && <BlueprintsTab blueprints={blueprints || []} />}
        {activeTab === 'comm-log' && <CommLogTab commLogs={commLogs || []} />}
        {activeTab === 'activity' && <ActivityTab activities={job.activities || []} decisionNotes={job.decisionNotes || []} tasks={job.tasks || []} />}
      </div>
    </div>
  )
}

// ── Tab Components ───────────────────────────────────────────────────────

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
    </div>
  )
}

// ── Profitability Card (FIX-23) ──────────────────────────────────────────

type ProfitabilityData = {
  revenue: number
  cogs: number
  laborCost: number
  grossMargin: { dollars: number; percent: number }
  status: 'green' | 'yellow' | 'red' | 'empty'
  invoiceCount: number
}

function ProfitabilityCard({ jobId }: { jobId: string }) {
  const [data, setData] = useState<ProfitabilityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const res = await fetch(`/api/ops/jobs/${jobId}/profitability`)
        if (!res.ok) throw new Error('Failed to load profitability')
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (jobId) load()
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (loading) {
    return (
      <SectionCard title="Profitability">
        <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
      </SectionCard>
    )
  }

  if (err || !data) {
    return (
      <SectionCard title="Profitability">
        <p className="text-sm text-gray-500 dark:text-gray-400">{err || 'Unavailable'}</p>
      </SectionCard>
    )
  }

  if (data.status === 'empty') {
    return (
      <SectionCard title="Profitability">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Profitability will calculate after invoice is created.
        </p>
      </SectionCard>
    )
  }

  const pillStyle =
    data.status === 'green'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : data.status === 'yellow'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'

  return (
    <SectionCard title="Profitability">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
        <Stat label="Revenue" value={formatCurrency(data.revenue)} />
        <Stat label="COGS" value={formatCurrency(data.cogs)} />
        <Stat label="Labor" value={formatCurrency(data.laborCost)} />
        <Stat label="Gross Margin $" value={formatCurrency(data.grossMargin.dollars)} />
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Gross Margin %
          </p>
          <span
            className={`inline-flex items-center mt-1 px-2.5 py-1 rounded-full text-sm font-bold ${pillStyle}`}
          >
            {data.grossMargin.percent.toFixed(1)}%
          </span>
        </div>
      </div>
    </SectionCard>
  )
}

// ── Overview Tab ─────────────────────────────────────────────────────────

function OverviewTab({ job, jobId, builder, community, phaseSummary, invoices, setActiveTab }: any) {
  return (
    <div className="space-y-5">
      {/* Key Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Stat label="Order Total" value={formatCurrency(job.order?.total || 0)} />
        <Stat label="Deliveries" value={job.deliveries?.length || 0} />
        <Stat label="Invoices" value={invoices?.length || 0} />
        <Stat label="Tasks" value={job.tasks?.length || 0} />
        <Stat label="Installs" value={job.installations?.length || 0} />
        <Stat label="QC Checks" value={job.qualityChecks?.length || 0} />
      </div>

      {/* Profitability */}
      <ProfitabilityCard jobId={jobId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Builder Info */}
        {builder && (
          <SectionCard
            title="Builder"
            action={<Link href={`/ops/accounts/${builder.id}`} className="text-xs font-semibold text-blue-600 hover:underline">View Account →</Link>}
          >
            <div className="space-y-2">
              <p className="text-base font-bold text-gray-900 dark:text-white">{builder.companyName}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">{builder.contactName}</p>
              <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                {builder.email && <span>{builder.email}</span>}
                {builder.phone && <span>{builder.phone}</span>}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {builder.builderType}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {builder.paymentTerm?.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-500">Credit: {formatCurrency(builder.creditLimit || 0)}</span>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Community */}
        {community && (
          <SectionCard
            title="Community"
            action={<Link href={`/ops/communities/${community.id}`} className="text-xs font-semibold text-blue-600 hover:underline">View Community →</Link>}
          >
            <div className="space-y-2">
              <p className="text-base font-bold text-gray-900 dark:text-white">{community.name}</p>
              {community.address && <p className="text-sm text-gray-600 dark:text-gray-400">{community.address}, {community.city} {community.state}</p>}
              <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span>{community.totalLots} lots ({community.activeLots} active)</span>
                {community.phase && <span>Phase: {community.phase}</span>}
              </div>
              {community.floorPlans?.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{community.floorPlans.length} floor plans</p>
              )}
            </div>
          </SectionCard>
        )}

        {/* Project Manager */}
        {job.assignedPM && (
          <SectionCard title="Project Manager">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#0f2a3e] flex items-center justify-center text-sm font-bold text-white">
                {(job.assignedPM.firstName?.[0] ?? '?')}{(job.assignedPM.lastName?.[0] ?? '')}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fullName(job.assignedPM)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{job.assignedPM.title || 'Project Manager'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{job.assignedPM.email} {job.assignedPM.phone ? `· ${job.assignedPM.phone}` : ''}</p>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Order Details */}
        {job.order && (
          <SectionCard
            title="Order"
            action={<Link href={`/ops/orders/${job.order.id}`} className="text-xs font-semibold text-blue-600 hover:underline">View Order →</Link>}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{job.order.orderNumber}</span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(job.order.total)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>Status: {job.order.status}</span>
                {job.order.poNumber && <span>PO: {job.order.poNumber}</span>}
                <span>{job.order.items?.length || 0} items</span>
              </div>
            </div>
          </SectionCard>
        )}
      </div>

      {/* Phase Progress (compact) */}
      {phaseSummary.totalPhases > 0 && (
        <SectionCard title="Billing Phases" action={<button onClick={() => setActiveTab?.('phases')} className="text-xs font-semibold text-blue-600 hover:underline">View All →</button>}>
          <div className="space-y-2">
            {(job.phases || []).map((phase: any) => (
              <div key={phase.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    phase.status === 'PAID' ? 'bg-green-500' :
                    phase.status === 'INVOICED' ? 'bg-emerald-500' :
                    phase.status === 'ACTIVE' ? 'bg-blue-500 animate-pulse' :
                    phase.status === 'READY' ? 'bg-signal' :
                    phase.status === 'SKIPPED' ? 'bg-gray-300' :
                    'bg-gray-300'
                  }`} />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{phase.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{phase.status}</span>
                </div>
                {phase.expectedAmount != null && (
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(phase.expectedAmount)}</span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Recent Deliveries (compact) */}
      {job.deliveries?.length > 0 && (
        <SectionCard title={`Deliveries (${job.deliveries.length})`}>
          <div className="space-y-2">
            {job.deliveries.slice(0, 3).map((d: any) => (
              <div key={d.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{d.deliveryNumber}</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{d.address} · {d.crew?.name || '—'}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  d.status === 'COMPLETE' ? 'bg-green-100 text-green-700' :
                  d.status === 'IN_TRANSIT' ? 'bg-orange-100 text-orange-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Phases Tab ───────────────────────────────────────────────────────────

function PhasesTab({ phases, phaseSummary, jobId }: { phases: any[]; phaseSummary: any; jobId: string }) {
  if (phases.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">No phases configured</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">Initialize billing phases from the builder&apos;s template to start tracking.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Total Phases" value={phaseSummary.totalPhases} />
        <Stat label="Completed" value={phaseSummary.completedPhases} />
        <Stat label="Expected Total" value={formatCurrency(phaseSummary.totalExpected)} />
        <Stat label="Invoiced" value={formatCurrency(phaseSummary.totalInvoiced)} />
      </div>

      {/* Phase cards */}
      <div className="space-y-3">
        {phases.map((phase: any, i: number) => (
          <div key={phase.id} className={`rounded-2xl border overflow-hidden transition-all ${
            phase.status === 'ACTIVE' ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10' :
            phase.status === 'PAID' ? 'border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-900/10' :
            'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
          }`}>
            <div className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold ${
                  phase.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  phase.status === 'INVOICED' ? 'bg-emerald-100 text-emerald-700' :
                  phase.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' :
                  phase.status === 'READY' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  {phase.status === 'PAID' ? '✓' : phase.status === 'SKIPPED' ? '—' : i + 1}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{phase.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-semibold uppercase">{phase.status}</span>
                    {phase.amountType === 'PERCENTAGE' && phase.percentage && <span>{phase.percentage}%</span>}
                    {phase.amountType === 'MILESTONE' && <span>Milestone</span>}
                    {phase.startedAt && <span>Started {formatDate(phase.startedAt)}</span>}
                    {phase.completedAt && <span>Completed {formatDate(phase.completedAt)}</span>}
                  </div>
                </div>
              </div>

              <div className="text-right">
                {phase.expectedAmount != null && (
                  <p className="text-base font-bold text-gray-900 dark:text-white">{formatCurrency(phase.expectedAmount)}</p>
                )}
                {phase.actualAmount != null && phase.actualAmount !== phase.expectedAmount && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Actual: {formatCurrency(phase.actualAmount)}</p>
                )}
              </div>
            </div>
            {phase.notes && (
              <div className="px-5 pb-3 text-xs text-gray-600 dark:text-gray-400">{phase.notes}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Deliveries Tab ───────────────────────────────────────────────────────

function DeliveriesTab({ deliveries }: { deliveries: any[] }) {
  if (deliveries.length === 0) {
    return <div className="text-center py-16 text-sm text-gray-500 dark:text-gray-400">No deliveries scheduled yet.</div>
  }

  return (
    <div className="space-y-4">
      {deliveries.map((d: any) => (
        <div key={d.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-gray-900 dark:text-white">{d.deliveryNumber}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  d.status === 'COMPLETE' ? 'bg-green-100 text-green-700' :
                  d.status === 'IN_TRANSIT' ? 'bg-orange-100 text-orange-700' :
                  d.status === 'LOADING' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  {d.status}
                </span>
              </div>
              <Link href={`/ops/delivery?id=${d.id}`} className="text-xs font-semibold text-blue-600 hover:underline">Details →</Link>
            </div>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{d.address}</p>

            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              {d.crew && <span>Crew: {d.crew.name}</span>}
              {d.crew?.members?.length > 0 && (
                <span>{d.crew.members.map((m: any) => `${m.staff.firstName} ${m.staff.lastName[0]}.`).join(', ')}</span>
              )}
              {d.departedAt && <span>Departed {formatDateTime(d.departedAt)}</span>}
              {d.arrivedAt && <span>Arrived {formatDateTime(d.arrivedAt)}</span>}
            </div>

            {/* Tracking History */}
            {d.tracking?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Recent Tracking</p>
                {d.tracking.slice(0, 3).map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                    <span className="font-medium">{t.status}</span>
                    {t.location && <span>— {t.location}</span>}
                    <span className="text-gray-400">{formatDateTime(t.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}

            {d.damageNotes && (
              <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/10 text-xs text-red-700 dark:text-red-400">
                Damage: {d.damageNotes}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Invoices Tab ─────────────────────────────────────────────────────────

function InvoicesTab({ invoices, order, changeOrders }: { invoices: any[]; order: any; changeOrders: any[] }) {
  return (
    <div className="space-y-5">
      {/* Order line items */}
      {order && (
        <SectionCard title={`Order ${order.orderNumber}`} action={<span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(order.total)}</span>}>
          <div className="space-y-1">
            {(order.items || []).map((item: any) => (
              <div key={item.id} className="flex items-center justify-between py-1.5 text-sm border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{item.product?.name || item.description}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{item.product?.sku}</span>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(item.total || item.unitPrice * item.quantity)}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">× {item.quantity}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Invoices */}
      <SectionCard title={`Invoices (${invoices.length})`}>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No invoices yet.</p>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div>
                  <Link href={`/ops/invoices/${inv.id}`} className="text-sm font-semibold text-gray-900 dark:text-white hover:text-blue-600">{inv.invoiceNumber}</Link>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {inv.status} · Due {formatDate(inv.dueDate)} · {Number(inv.paymentCount) || 0} payments
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(inv.total)}</p>
                  {inv.balanceDue > 0 && <p className="text-xs text-red-600">Balance: {formatCurrency(inv.balanceDue)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Change Orders */}
      {changeOrders.length > 0 && (
        <SectionCard title={`Change Orders (${changeOrders.length})`}>
          <div className="space-y-2">
            {changeOrders.map((co: any) => (
              <div key={co.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{co.reason}</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{co.status} · {formatDate(co.createdAt)}</p>
                </div>
                <span className={`text-sm font-bold ${co.costImpact > 0 ? 'text-red-600' : co.costImpact < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                  {co.costImpact > 0 ? '+' : ''}{formatCurrency(co.costImpact || 0)}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Materials Tab ────────────────────────────────────────────────────────

function MaterialsTab({ items, materialPicks }: { items: any[]; materialPicks: any[] }) {
  return (
    <div className="space-y-5">
      <SectionCard title={`Order Items (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">No items.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
                <th className="text-left py-2 font-semibold">Product</th>
                <th className="text-left py-2 font-semibold">SKU</th>
                <th className="text-right py-2 font-semibold">Qty</th>
                <th className="text-right py-2 font-semibold">Price</th>
                <th className="text-right py-2 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="py-2 font-medium text-gray-900 dark:text-white">{item.product?.name || item.description}</td>
                  <td className="py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">{item.product?.sku || '—'}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-gray-300">{item.quantity}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(item.unitPrice)}</td>
                  <td className="py-2 text-right font-semibold text-gray-900 dark:text-white">{formatCurrency(item.total || item.unitPrice * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {materialPicks.length > 0 && (
        <SectionCard title={`Material Picks (${materialPicks.length})`}>
          <div className="space-y-2">
            {materialPicks.map((pick: any) => (
              <div key={pick.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0 text-sm">
                <span className="text-gray-900 dark:text-white">{pick.productName || pick.sku || 'Item'}</span>
                <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 text-xs">
                  <span>Qty: {pick.quantity}</span>
                  <span>{pick.status}</span>
                  <span>{formatDate(pick.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Blueprints Tab ───────────────────────────────────────────────────────

function BlueprintsTab({ blueprints }: { blueprints: any[] }) {
  if (blueprints.length === 0) {
    return <div className="text-center py-16 text-sm text-gray-500 dark:text-gray-400">No blueprints attached to this job.</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {blueprints.map((bp: any) => (
        <div key={bp.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{bp.fileName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {bp.pageCount ? `${bp.pageCount} pages · ` : ''}{Math.round((bp.fileSize || 0) / 1024)} KB · {formatDate(bp.createdAt)}
              </p>
            </div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              bp.processingStatus === 'COMPLETE' ? 'bg-green-100 text-green-700' :
              bp.processingStatus === 'PROCESSING' ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {bp.processingStatus}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span>{Number(bp.takeoffCount) || 0} takeoffs</span>
            {bp.fileUrl && (
              <a href={bp.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View PDF →</a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Comm Log Tab ─────────────────────────────────────────────────────────

function CommLogTab({ commLogs }: { commLogs: any[] }) {
  if (commLogs.length === 0) {
    return <div className="text-center py-16 text-sm text-gray-500 dark:text-gray-400">No communication logs for this builder.</div>
  }

  return (
    <div className="space-y-3">
      {commLogs.map((log: any) => (
        <div key={log.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                log.type === 'EMAIL' ? 'bg-blue-100 text-blue-700' :
                log.type === 'PHONE' ? 'bg-green-100 text-green-700' :
                log.type === 'MEETING' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {log.type || 'NOTE'}
              </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{log.subject || 'Communication'}</span>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(log.createdAt)}</span>
          </div>
          {log.body && <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-3">{log.body}</p>}
          {(log.staffFirstName || log.staffLastName) && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">By {log.staffFirstName} {log.staffLastName}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Activity Tab ─────────────────────────────────────────────────────────

function ActivityTab({ activities, decisionNotes, tasks }: { activities: any[]; decisionNotes: any[]; tasks: any[] }) {
  return (
    <div className="space-y-5">
      {/* Tasks */}
      {tasks.length > 0 && (
        <SectionCard title={`Tasks (${tasks.length})`}>
          <div className="space-y-2">
            {tasks.map((task: any) => (
              <div key={task.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0 text-sm">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{task.title || task.description}</span>
                  {task.assignedTo && <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">→ {task.assignedTo}</span>}
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  task.status === 'COMPLETE' || task.status === 'DONE' ? 'bg-green-100 text-green-700' :
                  task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Decision Notes */}
      {decisionNotes.length > 0 && (
        <SectionCard title={`Decision Notes (${decisionNotes.length})`}>
          <div className="space-y-2">
            {decisionNotes.map((note: any) => (
              <div key={note.id} className="py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <p className="text-sm text-gray-900 dark:text-white">{note.content || note.note}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDateTime(note.createdAt)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Activity Timeline */}
      {activities.length > 0 && (
        <SectionCard title="Activity Timeline">
          <div className="space-y-0">
            {activities.map((a: any) => (
              <div key={a.id} className="flex gap-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div className="w-1.5 h-1.5 mt-2 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{a.description || a.action || 'Activity'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
