'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import DocumentPanel from '@/components/DocumentPanel'
import PresenceAvatars from '@/components/ui/PresenceAvatars'
import HyphenDocumentsTab from './HyphenDocumentsTab'
import AllocationPanel from './AllocationPanel'
import MaterialConfirmBanner from './MaterialConfirmBanner'

const STATUS_COLORS: Record<string, string> = {
  CREATED: '#95A5A6',
  READINESS_CHECK: '#3498DB',
  MATERIALS_LOCKED: '#4B0082',
  IN_PRODUCTION: '#9B59B6',
  STAGED: '#F1C40F',
  LOADED: '#C6A24E',
  IN_TRANSIT: '#FFA500',
  DELIVERED: '#1ABC9C',
  INSTALLING: '#00BCD4',
  PUNCH_LIST: '#E74C3C',
  COMPLETE: '#27AE60',
  INVOICED: '#16A085',
  CLOSED: '#7F8C8D',
}

const STATUS_LABELS: Record<string, string> = {
  CREATED: 'New',
  READINESS_CHECK: 'T-72 Check',
  MATERIALS_LOCKED: 'T-48 Lock',
  IN_PRODUCTION: 'Production',
  STAGED: 'Staged',
  LOADED: 'T-24 Loaded',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  INSTALLING: 'Installing',
  PUNCH_LIST: 'Punch List',
  COMPLETE: 'Complete',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
}

const STATUS_FLOW = [
  'CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION',
  'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED',
  'INSTALLING', 'PUNCH_LIST', 'COMPLETE', 'INVOICED', 'CLOSED'
]

interface Job {
  id: string
  jobNumber: string
  orderId: string | null
  builderName: string
  builderContact: string | null
  jobAddress: string | null
  lotBlock: string | null
  community: string | null
  scopeType: string | null
  dropPlan: string | null
  status: string
  readinessCheck: boolean
  materialsLocked: boolean
  loadConfirmed: boolean
  scheduledDate: string | null
  actualDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string | null
  order: {
    id: string
    orderNumber: string
    total: number
    status: string
    deliveryNotes: string | null
    poNumber: string | null
    builder: {
      id: string
      companyName: string
      contactName: string | null
      email: string | null
      phone: string | null
    } | null
  } | null
  assignedPM: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  } | null
  tasks: any[]
  deliveries: any[]
  installations: any[]
  materialPicks: any[]
  scheduleEntries: any[]
  qualityChecks: any[]
  decisionNotes: any[]
}

export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [profitability, setProfitability] = useState<any>(null)
  const [showProfit, setShowProfit] = useState(false)
  const [changeOrders, setChangeOrders] = useState<any[]>([])
  const [showCO, setShowCO] = useState(false)
  const [coForm, setCoForm] = useState({ reason: '', description: '', costImpact: '' })
  const [showCOForm, setShowCOForm] = useState(false)
  const [punchItems, setPunchItems] = useState<any[]>([])
  const [showPunch, setShowPunch] = useState(false)
  const [punchForm, setPunchForm] = useState({ description: '', location: '', severity: 'MINOR', installationId: '' })
  const [showPunchForm, setShowPunchForm] = useState(false)
  const [qcStatus, setQcStatus] = useState<{
    failing: boolean
    passing: boolean
    openPunchItems: number
  } | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'allocation'>('overview')
  const [hyphenDocCount, setHyphenDocCount] = useState<number>(0)

  useEffect(() => {
    const fetchJob = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/ops/jobs/${jobId}`)
        if (!res.ok) {
          if (res.status === 404) throw new Error('Job not found')
          throw new Error('Failed to fetch job')
        }
        const data = await res.json()
        setJob(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }
    if (jobId) fetchJob()
  }, [jobId])

  // Lightweight count of HyphenDocuments for the tab badge.
  useEffect(() => {
    if (!jobId) return
    let cancel = false
    ;(async () => {
      try {
        const r = await fetch(`/api/ops/jobs/${jobId}/documents`, { cache: 'no-store' })
        if (!r.ok || cancel) return
        const j = await r.json()
        if (!cancel) setHyphenDocCount(j.total || 0)
      } catch {
        /* ignore */
      }
    })()
    return () => { cancel = true }
  }, [jobId])

  // Fetch QC status for the banner — failing inspections + open punch items.
  useEffect(() => {
    if (!jobId) return
    let cancel = false
    ;(async () => {
      try {
        const [inspRes, punchRes] = await Promise.all([
          fetch(`/api/ops/inspections?jobId=${jobId}&limit=20`),
          fetch(`/api/ops/punch-items?jobId=${jobId}`),
        ])
        if (cancel) return
        const inspData = inspRes.ok ? await inspRes.json() : { inspections: [] }
        const punchData = punchRes.ok ? await punchRes.json() : { punchItems: [] }

        // Treat most-recent inspection row as the "current" state (sorted DESC
        // by createdAt in the inspections list route).
        const rows = (inspData.inspections || []) as any[]
        const latest = rows[0]
        const failing = !!latest && ['FAIL', 'FAILED'].includes(String(latest.status))
        const passing = !!rows.find((r) =>
          ['PASS', 'PASS_WITH_NOTES', 'PASSED'].includes(String(r.status))
        )
        const openPunch = (punchData.punchItems || []).filter(
          (p: any) => p.status !== 'RESOLVED'
        ).length
        setQcStatus({ failing, passing, openPunchItems: openPunch })
      } catch {
        // ignore — banner is optional
      }
    })()
    return () => { cancel = true }
  }, [jobId])

  const loadProfitability = async () => {
    if (profitability) { setShowProfit(!showProfit); return }
    try {
      const res = await fetch(`/api/ops/jobs/profitability?jobId=${jobId}`)
      if (res.ok) {
        const d = await res.json()
        setProfitability(d)
        setShowProfit(true)
      }
    } catch { /* ignore */ }
  }

  const loadChangeOrders = async () => {
    if (changeOrders.length > 0) { setShowCO(!showCO); return }
    try {
      const res = await fetch(`/api/ops/change-orders?jobId=${jobId}`)
      if (res.ok) { const d = await res.json(); setChangeOrders(d.changeOrders || []); setShowCO(true) }
    } catch { /* ignore */ }
  }

  const createChangeOrder = async () => {
    if (!coForm.reason.trim()) return
    try {
      const res = await fetch('/api/ops/change-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, orderId: job?.order?.id, reason: coForm.reason, description: coForm.description, costImpact: parseFloat(coForm.costImpact) || 0 }),
      })
      if (res.ok) {
        setCoForm({ reason: '', description: '', costImpact: '' })
        setShowCOForm(false)
        setChangeOrders([])
        loadChangeOrders()
      }
    } catch { /* ignore */ }
  }

  const updateCOStatus = async (coId: string, action: string) => {
    try {
      await fetch('/api/ops/change-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: coId, action }) })
      setChangeOrders([])
      loadChangeOrders()
    } catch { /* ignore */ }
  }

  const loadPunchItems = async () => {
    if (punchItems.length > 0 && showPunch) { setShowPunch(false); return }
    try {
      const res = await fetch(`/api/ops/punch-items?jobId=${jobId}`)
      if (res.ok) { const d = await res.json(); setPunchItems(d.punchItems || []); setShowPunch(true) }
    } catch { /* ignore */ }
  }

  const createPunchItem = async () => {
    if (!punchForm.description.trim() || !punchForm.installationId) return
    try {
      const res = await fetch('/api/ops/punch-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, installationId: punchForm.installationId, description: punchForm.description, location: punchForm.location, severity: punchForm.severity }),
      })
      if (res.ok) {
        setPunchForm({ description: '', location: '', severity: 'MINOR', installationId: '' })
        setShowPunchForm(false)
        setPunchItems([])
        loadPunchItems()
      }
    } catch { /* ignore */ }
  }

  const updatePunchStatus = async (piId: string, action: string, resolutionNotes?: string) => {
    try {
      await fetch('/api/ops/punch-items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: piId, action, resolutionNotes }) })
      setPunchItems([])
      loadPunchItems()
    } catch { /* ignore */ }
  }

  const advanceStatus = async () => {
    if (!job) return
    const currentIdx = STATUS_FLOW.indexOf(job.status)
    if (currentIdx < 0 || currentIdx >= STATUS_FLOW.length - 1) return
    const nextStatus = STATUS_FLOW[currentIdx + 1]

    setUpdating(true)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.ok) {
        setJob(prev => prev ? { ...prev, status: nextStatus } : prev)
      }
    } catch {
      // ignore
    } finally {
      setUpdating(false)
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatCurrency = (n: number | null) => {
    if (n == null) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0f2a3e] mx-auto mb-4" />
          <p className="text-gray-500">Loading job details...</p>
        </div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 text-lg font-semibold mb-2">Error</p>
          <p className="text-red-600">{error || 'Job not found'}</p>
          <button onClick={() => router.push('/ops/jobs')} className="mt-4 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#163d5a]">
            Back to Pipeline
          </button>
        </div>
      </div>
    )
  }

  const currentIdx = STATUS_FLOW.indexOf(job.status)
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/ops/jobs')} className="text-gray-400 hover:text-gray-600 text-2xl">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{job.jobNumber}</h1>
            <span
              className="px-3 py-1 rounded-full text-white text-sm font-medium"
              style={{ backgroundColor: STATUS_COLORS[job.status] || '#95A5A6' }}
            >
              {STATUS_LABELS[job.status] || job.status}
            </span>
          </div>
          <p className="text-gray-500 mt-1">{job.builderName} — {job.community || 'No community'}{job.lotBlock ? ` • ${job.lotBlock}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars recordId={job.id} recordType="job" />
          {nextStatus && (
            <button
              onClick={advanceStatus}
              disabled={updating}
              className="px-4 py-2 bg-[#C6A24E] text-white rounded-lg hover:bg-[#A8882A] disabled:opacity-50 font-medium"
            >
              {updating ? 'Updating...' : `Advance → ${STATUS_LABELS[nextStatus] || nextStatus}`}
            </button>
          )}
        </div>
      </div>

      {/* T-7 Material Confirm checkpoint banner — shows when scheduled within 7 days & not yet confirmed. */}
      <MaterialConfirmBanner
        jobId={job.id}
        jobStatus={job.status}
        scheduledDate={job.scheduledDate}
      />

      {/* QC status banner — blocks the eye whenever a failing inspection exists. */}
      {qcStatus?.failing && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-800">
              QC FAIL — Blocked from advancement.
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              {qcStatus.openPunchItems > 0
                ? `Resolve ${qcStatus.openPunchItems} punch item${qcStatus.openPunchItems === 1 ? '' : 's'} and record a passing inspection to proceed.`
                : 'Record a passing inspection to proceed.'}
            </p>
          </div>
          <Link
            href="/ops/portal/qc/queue"
            className="px-3 py-1.5 bg-[#C0392B] text-white rounded text-sm font-medium hover:bg-[#A93226]"
          >
            Go to QC Queue
          </Link>
        </div>
      )}

      {/* Status Progress */}
      <div className="bg-white rounded-lg border p-4 mb-6 overflow-x-auto">
        <div className="flex items-center min-w-[900px]">
          {STATUS_FLOW.slice(0, -1).map((s, i) => {
            const isActive = s === job.status
            const isPast = currentIdx > i
            const color = STATUS_COLORS[s] || '#95A5A6'
            return (
              <div key={s} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isPast ? 'text-white' : isActive ? 'text-white ring-4 ring-opacity-30' : 'text-gray-400 bg-gray-200'}`}
                    style={isPast || isActive ? { backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties : {}}
                  >
                    {isPast ? '✓' : i + 1}
                  </div>
                  <span className={`text-[10px] mt-1 text-center ${isActive ? 'font-bold text-gray-900' : isPast ? 'text-gray-600' : 'text-gray-400'}`}>
                    {STATUS_LABELS[s]?.replace(' ', '\n') || s}
                  </span>
                </div>
                {i < STATUS_FLOW.length - 2 && (
                  <div className={`h-0.5 flex-1 ${isPast ? 'bg-green-400' : 'bg-gray-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === 'overview'
              ? 'border-[#0f2a3e] text-[#0f2a3e]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px inline-flex items-center gap-2 ${
            activeTab === 'documents'
              ? 'border-[#0f2a3e] text-[#0f2a3e]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Documents
          {hyphenDocCount > 0 && (
            <span className="text-[10px] font-mono tabular-nums text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
              {hyphenDocCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('allocation')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px inline-flex items-center gap-2 ${
            activeTab === 'allocation'
              ? 'border-[#0f2a3e] text-[#0f2a3e]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Allocation
        </button>
      </div>

      {activeTab === 'documents' && (
        <div className="mb-6">
          <HyphenDocumentsTab jobId={jobId} />
        </div>
      )}

      {activeTab === 'allocation' && (
        <div className="mb-6">
          <AllocationPanel jobId={jobId} />
        </div>
      )}

      {/* Main Content Grid */}
      {activeTab === 'overview' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Job Info */}
          <div className="bg-white rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Address</p>
                <p className="text-sm font-medium text-gray-900">{job.jobAddress || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Lot / Block</p>
                <p className="text-sm font-medium text-gray-900">{job.lotBlock || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Community</p>
                <p className="text-sm font-medium text-gray-900">{job.community || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Scope</p>
                <p className="text-sm font-medium text-gray-900">{job.scopeType?.replace(/_/g, ' ') || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Scheduled Date</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(job.scheduledDate)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Actual Date</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(job.actualDate)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Drop Plan</p>
                <p className="text-sm font-medium text-gray-900">{job.dropPlan || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Created</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(job.createdAt)}</p>
              </div>
            </div>
          </div>

          {/* Readiness Checks */}
          <div className="bg-white rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Readiness Checklist</h2>
            <div className="space-y-3">
              {[
                { label: 'Readiness Check (T-72)', done: job.readinessCheck },
                { label: 'Materials Locked (T-48)', done: job.materialsLocked },
                { label: 'Load Confirmed (T-24)', done: job.loadConfirmed },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${item.done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {item.done ? '✓' : '○'}
                  </div>
                  <span className={`text-sm ${item.done ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Profitability Panel */}
          <div className="bg-white rounded-lg border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Job Profitability</h2>
              <button onClick={loadProfitability} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-[#0f2a3e] hover:bg-[#163d5a]">
                {showProfit ? 'Hide' : 'Analyze'}
              </button>
            </div>
            {showProfit && profitability?.profitability ? (
              <div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="text-lg font-bold text-[#0f2a3e]">{formatCurrency(profitability.profitability.totalRevenue)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">BOM Cost</p>
                    <p className="text-lg font-bold text-[#C6A24E]">{formatCurrency(profitability.profitability.totalBomCost)}</p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${profitability.profitability.grossMargin >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className="text-xs text-gray-500">Gross Margin</p>
                    <p className={`text-lg font-bold ${profitability.profitability.grossMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(profitability.profitability.grossMargin)}
                    </p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${profitability.profitability.marginPct >= 20 ? 'bg-green-50' : profitability.profitability.marginPct >= 10 ? 'bg-yellow-50' : 'bg-red-50'}`}>
                    <p className="text-xs text-gray-500">Margin %</p>
                    <p className={`text-lg font-bold ${profitability.profitability.marginPct >= 20 ? 'text-green-600' : profitability.profitability.marginPct >= 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {profitability.profitability.marginPct}%
                    </p>
                  </div>
                </div>
                {profitability.byCategory?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Category</p>
                    <div className="space-y-2">
                      {profitability.byCategory.map((cat: any) => (
                        <div key={cat.category} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700">{cat.category}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-gray-500">{formatCurrency(cat.revenue)}</span>
                            <span className={`font-medium ${cat.marginPct >= 20 ? 'text-green-600' : cat.marginPct >= 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {cat.marginPct}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : !showProfit ? (
              <p className="text-sm text-gray-400">Click Analyze to calculate margins using BOM costs</p>
            ) : (
              <p className="text-sm text-gray-400">No order linked to this job</p>
            )}
          </div>

          {/* Schedule Entries */}
          {job.scheduleEntries.length > 0 && (
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule ({job.scheduleEntries.length})</h2>
              <div className="space-y-2">
                {job.scheduleEntries.map((se: any) => (
                  <div key={se.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{se.title || se.entryType}</p>
                      <p className="text-xs text-gray-500">{formatDate(se.scheduledDate)}{se.scheduledTime ? ` at ${se.scheduledTime}` : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${se.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : se.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {se.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decision Notes */}
          {job.decisionNotes.length > 0 && (
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Decision Notes ({job.decisionNotes.length})</h2>
              <div className="space-y-3">
                {job.decisionNotes.map((dn: any) => (
                  <div key={dn.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-gray-900">{dn.note || dn.content}</p>
                    <p className="text-xs text-gray-500 mt-1">{formatDate(dn.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quality Checks */}
          {job.qualityChecks.length > 0 && (
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Quality Checks ({job.qualityChecks.length})</h2>
              <div className="space-y-2">
                {job.qualityChecks.map((qc: any) => (
                  <div key={qc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{qc.checkType || qc.type || 'Inspection'}</p>
                      <p className="text-xs text-gray-500">{qc.notes || '—'}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${qc.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {qc.passed ? 'Passed' : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Change Orders */}
          <div className="bg-white rounded-lg border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Change Orders</h2>
              <div className="flex gap-2">
                <button onClick={() => setShowCOForm(!showCOForm)} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-[#C6A24E] hover:bg-[#A8882A]">+ New</button>
                <button onClick={loadChangeOrders} className="text-xs px-3 py-1.5 rounded-lg font-medium text-[#0f2a3e] border border-[#0f2a3e] hover:bg-blue-50">
                  {showCO ? 'Hide' : 'Load'}
                </button>
              </div>
            </div>
            {showCOForm && (
              <div className="mb-4 p-3 bg-orange-50 rounded-lg space-y-2">
                <input value={coForm.reason} onChange={e => setCoForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for change *" className="w-full border rounded px-3 py-2 text-sm" />
                <textarea value={coForm.description} onChange={e => setCoForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="w-full border rounded px-3 py-2 text-sm" rows={2} />
                <div className="flex gap-2 items-center">
                  <input value={coForm.costImpact} onChange={e => setCoForm(f => ({ ...f, costImpact: e.target.value }))} placeholder="Cost impact ($)" className="border rounded px-3 py-2 text-sm w-32" type="number" />
                  <button onClick={createChangeOrder} className="px-3 py-2 bg-[#0f2a3e] text-white rounded text-sm font-medium hover:bg-[#163d5a]">Create CO</button>
                  <button onClick={() => setShowCOForm(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              </div>
            )}
            {showCO && (
              <div className="space-y-2">
                {changeOrders.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">No change orders</p>
                ) : changeOrders.map((co: any) => (
                  <div key={co.id} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">{co.changeNumber}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        co.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        co.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' :
                        co.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{co.status}</span>
                    </div>
                    <p className="text-sm text-gray-700">{co.reason}</p>
                    {co.costImpact !== 0 && <p className="text-xs mt-1 font-medium" style={{ color: co.costImpact > 0 ? '#E74C3C' : '#27AE60' }}>Cost Impact: {formatCurrency(co.costImpact)}</p>}
                    {co.status === 'DRAFT' && (
                      <button onClick={() => updateCOStatus(co.id, 'submit')} className="mt-2 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Submit for Approval</button>
                    )}
                    {co.status === 'SUBMITTED' && (
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => updateCOStatus(co.id, 'approve')} className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700">Approve</button>
                        <button onClick={() => updateCOStatus(co.id, 'reject')} className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700">Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Punch List */}
          <div className="bg-white rounded-lg border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Punch List</h2>
              <div className="flex gap-2">
                <button onClick={() => setShowPunchForm(!showPunchForm)} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-[#C6A24E] hover:bg-[#A8882A]">+ Add Item</button>
                <button onClick={loadPunchItems} className="text-xs px-3 py-1.5 rounded-lg font-medium text-[#0f2a3e] border border-[#0f2a3e] hover:bg-blue-50">
                  {showPunch ? 'Hide' : 'Load'}
                </button>
              </div>
            </div>
            {showPunchForm && (
              <div className="mb-4 p-3 bg-orange-50 rounded-lg space-y-2">
                <select value={punchForm.installationId} onChange={e => setPunchForm(f => ({ ...f, installationId: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm">
                  <option value="">Select Installation *</option>
                  {job.installations.map((inst: any) => (
                    <option key={inst.id} value={inst.id}>{inst.installNumber || inst.id.slice(0, 8)}</option>
                  ))}
                </select>
                <input value={punchForm.description} onChange={e => setPunchForm(f => ({ ...f, description: e.target.value }))} placeholder="Issue description *" className="w-full border rounded px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <input value={punchForm.location} onChange={e => setPunchForm(f => ({ ...f, location: e.target.value }))} placeholder="Location" className="flex-1 border rounded px-3 py-2 text-sm" />
                  <select value={punchForm.severity} onChange={e => setPunchForm(f => ({ ...f, severity: e.target.value }))} className="border rounded px-3 py-2 text-sm">
                    <option value="MINOR">Minor</option>
                    <option value="MAJOR">Major</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={createPunchItem} className="px-3 py-2 bg-[#0f2a3e] text-white rounded text-sm font-medium hover:bg-[#163d5a]">Add Item</button>
                  <button onClick={() => setShowPunchForm(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              </div>
            )}
            {showPunch && (
              <div className="space-y-2">
                {punchItems.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">No punch items</p>
                ) : punchItems.map((pi: any) => (
                  <div key={pi.id} className={`p-3 border rounded-lg ${pi.status === 'RESOLVED' ? 'bg-green-50 border-green-200' : pi.severity === 'CRITICAL' ? 'bg-red-50 border-red-200' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{pi.punchNumber}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          pi.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' :
                          pi.severity === 'MAJOR' ? 'bg-orange-200 text-orange-800' :
                          'bg-gray-200 text-gray-700'
                        }`}>{pi.severity}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        pi.status === 'RESOLVED' ? 'bg-green-100 text-green-700' :
                        pi.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{pi.status.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-sm text-gray-700">{pi.description}</p>
                    {pi.location && <p className="text-xs text-gray-500 mt-1">Location: {pi.location}</p>}
                    {pi.status === 'OPEN' && (
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => updatePunchStatus(pi.id, 'start')} className="text-xs px-2 py-1 bg-blue-600 text-white rounded">Start</button>
                        <button onClick={() => updatePunchStatus(pi.id, 'resolve', 'Resolved')} className="text-xs px-2 py-1 bg-green-600 text-white rounded">Resolve</button>
                      </div>
                    )}
                    {pi.status === 'IN_PROGRESS' && (
                      <button onClick={() => updatePunchStatus(pi.id, 'resolve', 'Resolved')} className="mt-2 text-xs px-2 py-1 bg-green-600 text-white rounded">Mark Resolved</button>
                    )}
                    {pi.status === 'RESOLVED' && pi.resolutionNotes && (
                      <p className="text-xs text-green-700 mt-1">Fix: {pi.resolutionNotes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Builder & Contact */}
          <div className="bg-white rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Builder</h2>
            <p className="text-sm font-bold text-gray-900">{job.builderName}</p>
            {job.builderContact && <p className="text-sm text-gray-600">{job.builderContact}</p>}
            {job.order?.builder && (
              <div className="mt-3 pt-3 border-t space-y-1">
                {job.order.builder.email && <p className="text-sm text-blue-600">{job.order.builder.email}</p>}
                {job.order.builder.phone && <p className="text-sm text-gray-600">{job.order.builder.phone}</p>}
                <Link href={`/ops/accounts`} className="text-xs text-[#0f2a3e] hover:underline">View Account →</Link>
              </div>
            )}
          </div>

          {/* Assigned PM */}
          <div className="bg-white rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Project Manager</h2>
            {job.assignedPM ? (
              <div>
                <p className="text-sm font-bold text-gray-900">{job.assignedPM.firstName} {job.assignedPM.lastName}</p>
                {job.assignedPM.email && <p className="text-sm text-blue-600">{job.assignedPM.email}</p>}
                {job.assignedPM.phone && <p className="text-sm text-gray-600">{job.assignedPM.phone}</p>}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Unassigned</p>
            )}
          </div>

          {/* Linked Order */}
          {job.order && (
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Linked Order</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Order #</span>
                  <span className="text-sm font-medium text-[#0f2a3e]">{job.order.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-sm font-bold">{formatCurrency(job.order.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Status</span>
                  <span className="text-sm">{job.order.status}</span>
                </div>
                {job.order.poNumber && (
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">PO #</span>
                    <span className="text-sm">{job.order.poNumber}</span>
                  </div>
                )}
                {job.order.deliveryNotes && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-xs text-gray-500">Delivery Notes</p>
                    <p className="text-sm text-gray-700">{job.order.deliveryNotes}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tasks Summary */}
          <div className="bg-white rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Activity Summary</h2>
            <div className="space-y-2">
              {[
                { label: 'Tasks', count: job.tasks.length },
                { label: 'Deliveries', count: job.deliveries.length },
                { label: 'Installations', count: job.installations.length },
                { label: 'Material Picks', count: job.materialPicks.length },
                { label: 'Schedule Entries', count: job.scheduleEntries.length },
                { label: 'Quality Checks', count: job.qualityChecks.length },
                { label: 'Decision Notes', count: job.decisionNotes.length },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">{item.label}</span>
                  <span className={`text-sm font-bold ${item.count > 0 ? 'text-[#0f2a3e]' : 'text-gray-300'}`}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Documents */}
          <DocumentPanel jobId={job.id} orderId={job.order?.id || undefined} />
        </div>
      </div>
      )}
    </div>
  )
}
