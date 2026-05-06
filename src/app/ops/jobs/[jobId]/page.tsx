'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Edit2 } from 'lucide-react'
import DocumentPanel from '@/components/DocumentPanel'
import PresenceAvatars from '@/components/ui/PresenceAvatars'
import { fullName } from '@/lib/formatting'
import HyphenDocumentsTab from './HyphenDocumentsTab'
import HyphenPanel from './HyphenPanel'
import AllocationPanel from './AllocationPanel'
import MaterialConfirmBanner from './MaterialConfirmBanner'
import MaterialDrawer from './MaterialDrawer'
import CoPreviewSheet from './CoPreviewSheet'
import ChangeOrderInbox from './ChangeOrderInbox'
import DeliverySignOff from './DeliverySignOff'
import NotesSection from '@/components/ops/NotesSection'
import EditSlideOver, { type FieldDef } from '@/components/ops/EditSlideOver'

// Feature flags — default ON unless explicitly 'off'. Evaluated at bundle time.
const HYPHEN_PANEL_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_HYPHEN_PANEL !== 'off'
const MATERIAL_DRAWER_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_MATERIAL_DRAWER !== 'off'
const CO_INBOX_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_CO_INBOX !== 'off'
const DELIVERY_SIGNOFF_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_DELIVERY_SIGNOFF !== 'off'

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
  jobType: string | null
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
  installerId: string | null
  trimVendorId: string | null
  assignedPMId: string | null
  buildSheetNotes: string | null
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
    firstName: string | null
    lastName: string | null
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
  // CO impact preview sheet — opens from the Change Orders card header.
  const [showCoPreview, setShowCoPreview] = useState(false)
  // Material drill-down drawer — opens from header "Materials" button.
  const [showMaterialDrawer, setShowMaterialDrawer] = useState(false)
  // 4.5 — Link-to-Order UI state. Search drawer; submit wired to
  // POST /api/ops/jobs/[id]/link-order.
  const [showLinkOrder, setShowLinkOrder] = useState(false)
  const [linkOrderQuery, setLinkOrderQuery] = useState('')
  const [linkOrderResults, setLinkOrderResults] = useState<any[]>([])
  const [linkOrderSearching, setLinkOrderSearching] = useState(false)
  const [linkingOrderId, setLinkingOrderId] = useState<string | null>(null)
  const [linkOrderError, setLinkOrderError] = useState<string | null>(null)
  // Invoice generation state
  const [generatingInvoice, setGeneratingInvoice] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  // 5.5-Part-B — Installer assignment UI state. Schema now has installerId/trimVendorId
  // on Job. Lists are loaded and the dropdown is fully functional.
  const [installCrews, setInstallCrews] = useState<{ id: string; name: string; crewType: string }[]>([])
  const [trimVendors, setTrimVendors] = useState<{ id: string; name: string }[]>([])
  const [installAssigneeChoice, setInstallAssigneeChoice] = useState<string>('')
  const [assigningInstaller, setAssigningInstaller] = useState(false)

  // B-UX-3 — Edit slide-over state.
  const [editOpen, setEditOpen] = useState(false)
  const [pms, setPms] = useState<{ id: string; firstName: string | null; lastName: string | null }[]>([])

  // Hoisted so post-write actions (e.g. link-order) can refetch the job
  // and pick up freshly-joined data (Order, builder, etc.).
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
      // Initialize installer choice from job data
      if (data.installerId) {
        setInstallAssigneeChoice(`crew:${data.installerId}`)
      } else if (data.trimVendorId) {
        setInstallAssigneeChoice(`vendor:${data.trimVendorId}`)
      } else {
        setInstallAssigneeChoice('')
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (jobId) fetchJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 5.5-Part-B — Load installer assignment options. Best-effort; endpoint
  // failures are silent because the field is read-only until a schema column
  // exists to write to.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const r = await fetch('/api/ops/crews?active=true', { cache: 'no-store' })
        if (!r.ok || cancel) return
        const data = await r.json()
        // Endpoint returns a bare array; filter to install-capable crews.
        const list = Array.isArray(data) ? data : (data.crews || [])
        const install = list.filter((c: any) =>
          c.crewType === 'INSTALLATION' || c.crewType === 'DELIVERY_AND_INSTALL' || !c.crewType
        )
        if (!cancel) setInstallCrews(install.map((c: any) => ({ id: c.id, name: c.name, crewType: c.crewType || 'INSTALLATION' })))
      } catch {
        /* ignore — UI is disabled anyway */
      }
    })()
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        // No /api/ops/trim-vendors route exists in this wave — request is
        // expected to 404. Fall back gracefully so the dropdown still renders.
        const r = await fetch('/api/ops/trim-vendors?active=true', { cache: 'no-store' })
        if (!r.ok || cancel) return
        const data = await r.json()
        const list = Array.isArray(data) ? data : (data.trimVendors || data.data || [])
        if (!cancel) setTrimVendors(list.map((v: any) => ({ id: v.id, name: v.name })))
      } catch {
        /* ignore — fallback is empty list */
      }
    })()
    return () => { cancel = true }
  }, [])

  // B-UX-3 — Load active PROJECT_MANAGER staff for the edit slide-over's
  // assignedPM dropdown. Best-effort; if the request fails the dropdown
  // simply shows the current PM by id with a graceful empty list.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const r = await fetch('/api/ops/staff?role=PROJECT_MANAGER', {
          cache: 'no-store',
        })
        if (!r.ok || cancel) return
        const data = await r.json()
        const list = Array.isArray(data) ? data : (data.data || [])
        if (!cancel) {
          setPms(
            list.map((s: any) => ({
              id: s.id,
              firstName: s.firstName ?? null,
              lastName: s.lastName ?? null,
            })),
          )
        }
      } catch {
        /* ignore — empty PM list */
      }
    })()
    return () => { cancel = true }
  }, [])

  // 4.5 — Order search for the "Link to Order" drawer. Debounced light query
  // against the existing /api/ops/orders endpoint.
  useEffect(() => {
    if (!showLinkOrder) return
    const q = linkOrderQuery.trim()
    if (q.length < 2) { setLinkOrderResults([]); return }
    let cancel = false
    setLinkOrderSearching(true)
    const handle = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ops/orders?search=${encodeURIComponent(q)}&limit=10`, { cache: 'no-store' })
        if (!r.ok || cancel) return
        const data = await r.json()
        const rows = data.orders || data.data || []
        if (!cancel) setLinkOrderResults(rows)
      } catch {
        if (!cancel) setLinkOrderResults([])
      } finally {
        if (!cancel) setLinkOrderSearching(false)
      }
    }, 300)
    return () => { cancel = true; clearTimeout(handle) }
  }, [linkOrderQuery, showLinkOrder])

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

  const generateInvoice = async () => {
    if (!job) return
    setGeneratingInvoice(true)
    setInvoiceError(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        // Show success message or redirect
        alert(`Invoice ${data.invoiceNumber} created successfully`)
        router.push(`/ops/invoices/${data.invoiceId}`)
      } else {
        const err = await res.json()
        setInvoiceError(err.error || 'Failed to generate invoice')
      }
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Failed to generate invoice')
    } finally {
      setGeneratingInvoice(false)
    }
  }

  const handleAssignInstaller = async (value: string) => {
    if (!job) return
    setInstallAssigneeChoice(value)

    if (!value) {
      // Clearing the assignment
      setAssigningInstaller(true)
      try {
        const res = await fetch(`/api/ops/jobs/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ installerId: null, trimVendorId: null }),
        })
        if (res.ok) {
          setJob(prev => prev ? { ...prev, installerId: null, trimVendorId: null } : prev)
        }
      } catch { /* ignore */ } finally {
        setAssigningInstaller(false)
      }
      return
    }

    // Parse the selection: crew:id or vendor:id
    const [type, id] = value.split(':')
    setAssigningInstaller(true)
    try {
      const payload = type === 'crew'
        ? { installerId: id, trimVendorId: null }
        : { installerId: null, trimVendorId: id }

      const res = await fetch(`/api/ops/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const updated = await res.json()
        setJob(updated)
      }
    } catch { /* ignore */ } finally {
      setAssigningInstaller(false)
    }
  }

  // 4.5 — Link a selected Order to this Job. Backed by
  // POST /api/ops/jobs/[id]/link-order (ADMIN/MANAGER/PROJECT_MANAGER).
  // Refetches the job on success so the linked Order card replaces the
  // empty-state CTA without requiring a page reload.
  const handleLinkOrder = async (orderId: string) => {
    if (!jobId || !orderId) return
    setLinkingOrderId(orderId)
    setLinkOrderError(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/link-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error || `Failed to link order (status ${res.status})`
        setLinkOrderError(msg)
        alert(msg)
        return
      }
      // Success — close the drawer, clear the search, and refresh job data.
      setShowLinkOrder(false)
      setLinkOrderQuery('')
      setLinkOrderResults([])
      alert(`Linked order ${data?.order?.orderNumber || ''} to job ${data?.job?.jobNumber || ''}`.trim())
      await fetchJob()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to link order'
      setLinkOrderError(msg)
      alert(msg)
    } finally {
      setLinkingOrderId(null)
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-signal mx-auto mb-4" />
          <p className="text-fg-muted">Loading job details...</p>
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
          <button onClick={() => router.push('/ops/jobs')} className="mt-4 px-4 py-2 bg-signal text-fg-on-accent rounded-lg hover:bg-signal-hover">
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
        <button onClick={() => router.push('/ops/jobs')} className="text-fg-subtle hover:text-fg-muted text-2xl">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-fg">{job.jobNumber}</h1>
            <span
              className="px-3 py-1 rounded-full text-white text-sm font-medium"
              style={{ backgroundColor: STATUS_COLORS[job.status] || '#95A5A6' }}
            >
              {STATUS_LABELS[job.status] || job.status}
            </span>
          </div>
          <p className="text-fg-muted mt-1">{job.builderName} — {job.community || 'No community'}{job.lotBlock ? ` • ${job.lotBlock}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars recordId={job.id} recordType="job" />
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium text-fg hover:bg-surface-muted transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Edit
          </button>
          {MATERIAL_DRAWER_ENABLED && (
            <button
              onClick={() => setShowMaterialDrawer(true)}
              className="px-4 py-2 border border-signal text-signal rounded-lg hover:bg-signal hover:text-fg-on-accent font-medium transition-colors"
            >
              Materials
            </button>
          )}
          {(job.status === 'COMPLETE' || job.status === 'DELIVERED') && (
            <button
              onClick={generateInvoice}
              disabled={generatingInvoice}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              {generatingInvoice ? 'Generating...' : 'Generate Invoice'}
            </button>
          )}
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

      {/* Invoice generation error banner */}
      {invoiceError && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-red-800">Invoice Generation Error</p>
              <p className="text-xs text-red-700 mt-0.5">{invoiceError}</p>
            </div>
            <button
              onClick={() => setInvoiceError(null)}
              className="text-red-700 hover:text-red-900 font-semibold"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Status Progress */}
      <div className="bg-surface rounded-lg border p-4 mb-6 overflow-x-auto">
        <div className="flex items-center min-w-[900px]">
          {STATUS_FLOW.slice(0, -1).map((s, i) => {
            const isActive = s === job.status
            const isPast = currentIdx > i
            const color = STATUS_COLORS[s] || '#95A5A6'
            return (
              <div key={s} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${isPast ? 'text-white' : isActive ? 'text-white ring-4 ring-opacity-30' : 'text-fg-subtle bg-surface-muted'}`}
                    style={isPast || isActive ? { backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties : {}}
                  >
                    {isPast ? '✓' : i + 1}
                  </div>
                  <span className={`text-[10px] mt-1 text-center ${isActive ? 'font-semibold text-fg' : isPast ? 'text-fg-muted' : 'text-fg-subtle'}`}>
                    {STATUS_LABELS[s]?.replace(' ', '\n') || s}
                  </span>
                </div>
                {i < STATUS_FLOW.length - 2 && (
                  <div className={`h-0.5 flex-1 ${isPast ? 'bg-green-400' : 'bg-surface-muted'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === 'overview'
              ? 'border-signal text-signal'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px inline-flex items-center gap-2 ${
            activeTab === 'documents'
              ? 'border-signal text-signal'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Documents
          {hyphenDocCount > 0 && (
            <span className="text-[10px] font-mono tabular-nums text-fg-muted bg-surface-muted px-1.5 py-0.5 rounded">
              {hyphenDocCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('allocation')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px inline-flex items-center gap-2 ${
            activeTab === 'allocation'
              ? 'border-signal text-signal'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Allocation
        </button>
      </div>

      {activeTab === 'documents' && (
        <div className="mb-6 space-y-6">
          <HyphenDocumentsTab jobId={jobId} />
          {CO_INBOX_ENABLED && <ChangeOrderInbox jobId={jobId} />}
          {HYPHEN_PANEL_ENABLED && <HyphenPanel jobId={jobId} />}
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
          <div className="bg-surface rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-fg mb-4">Job Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Address</p>
                <p className="text-sm font-medium text-fg">{job.jobAddress || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Lot / Block</p>
                <p className="text-sm font-medium text-fg">{job.lotBlock || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Community</p>
                <p className="text-sm font-medium text-fg">{job.community || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Scope</p>
                <p className="text-sm font-medium text-fg">{job.scopeType?.replace(/_/g, ' ') || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Scheduled Date</p>
                <p className="text-sm font-medium text-fg">{formatDate(job.scheduledDate)}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Actual Date</p>
                <p className="text-sm font-medium text-fg">{formatDate(job.actualDate)}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Drop Plan</p>
                <p className="text-sm font-medium text-fg">{job.dropPlan || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider">Created</p>
                <p className="text-sm font-medium text-fg">{formatDate(job.createdAt)}</p>
              </div>
            </div>
          </div>

          {/* Readiness Checks */}
          <div className="bg-surface rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-fg mb-4">Readiness Checklist</h2>
            <div className="space-y-3">
              {[
                { label: 'Readiness Check (T-72)', done: job.readinessCheck },
                { label: 'Materials Locked (T-48)', done: job.materialsLocked },
                { label: 'Load Confirmed (T-24)', done: job.loadConfirmed },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${item.done ? 'bg-green-100 text-green-600' : 'bg-surface-muted text-fg-subtle'}`}>
                    {item.done ? '✓' : '○'}
                  </div>
                  <span className={`text-sm ${item.done ? 'text-fg font-medium' : 'text-fg-muted'}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Profitability Panel */}
          <div className="bg-surface rounded-lg border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">Job Profitability</h2>
              <button onClick={loadProfitability} className="text-xs px-3 py-1.5 rounded-lg font-medium text-fg-on-accent bg-signal hover:bg-signal-hover">
                {showProfit ? 'Hide' : 'Analyze'}
              </button>
            </div>
            {showProfit && profitability?.profitability ? (
              <div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-fg-muted">Revenue</p>
                    <p className="text-lg font-semibold text-signal">{formatCurrency(profitability.profitability.totalRevenue)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-fg-muted">BOM Cost</p>
                    <p className="text-lg font-semibold text-signal">{formatCurrency(profitability.profitability.totalBomCost)}</p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${profitability.profitability.grossMargin >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className="text-xs text-fg-muted">Gross Margin</p>
                    <p className={`text-lg font-semibold ${profitability.profitability.grossMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(profitability.profitability.grossMargin)}
                    </p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${profitability.profitability.marginPct >= 20 ? 'bg-green-50' : profitability.profitability.marginPct >= 10 ? 'bg-yellow-50' : 'bg-red-50'}`}>
                    <p className="text-xs text-fg-muted">Margin %</p>
                    <p className={`text-lg font-semibold ${profitability.profitability.marginPct >= 20 ? 'text-green-600' : profitability.profitability.marginPct >= 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {profitability.profitability.marginPct}%
                    </p>
                  </div>
                </div>
                {profitability.byCategory?.length > 0 && (
                  <div>
                    <p className="text-xs text-fg-muted uppercase tracking-wider mb-2">By Category</p>
                    <div className="space-y-2">
                      {profitability.byCategory.map((cat: any) => (
                        <div key={cat.category} className="flex items-center justify-between text-sm">
                          <span className="text-fg-muted">{cat.category}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-fg-muted">{formatCurrency(cat.revenue)}</span>
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
              <p className="text-sm text-fg-subtle">Click Analyze to calculate margins using BOM costs</p>
            ) : (
              <p className="text-sm text-fg-subtle">No order linked to this job</p>
            )}
          </div>

          {/* Schedule Entries */}
          {job.scheduleEntries.length > 0 && (
            <div className="bg-surface rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-fg mb-4">Schedule ({job.scheduleEntries.length})</h2>
              <div className="space-y-2">
                {job.scheduleEntries.map((se: any) => (
                  <div key={se.id} className="flex items-center justify-between p-3 bg-surface-muted rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-fg">{se.title || se.entryType}</p>
                      <p className="text-xs text-fg-muted">{formatDate(se.scheduledDate)}{se.scheduledTime ? ` at ${se.scheduledTime}` : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${se.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : se.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-surface-muted text-fg-muted'}`}>
                      {se.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decision Notes */}
          {job.decisionNotes.length > 0 && (
            <div className="bg-surface rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-fg mb-4">Decision Notes ({job.decisionNotes.length})</h2>
              <div className="space-y-3">
                {job.decisionNotes.map((dn: any) => (
                  <div key={dn.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-fg">{dn.note || dn.content}</p>
                    <p className="text-xs text-fg-muted mt-1">{formatDate(dn.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quality Checks */}
          {job.qualityChecks.length > 0 && (
            <div className="bg-surface rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-fg mb-4">Quality Checks ({job.qualityChecks.length})</h2>
              <div className="space-y-2">
                {job.qualityChecks.map((qc: any) => (
                  <div key={qc.id} className="flex items-center justify-between p-3 bg-surface-muted rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-fg">{qc.checkType || qc.type || 'Inspection'}</p>
                      <p className="text-xs text-fg-muted">{qc.notes || '—'}</p>
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
          <div className="bg-surface rounded-lg border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">Change Orders</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCoPreview(true)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-fg-on-accent bg-signal hover:bg-signal-hover"
                  title="Preview material impact before committing a CO"
                >
                  Preview Change Order
                </button>
                <button onClick={() => setShowCOForm(!showCOForm)} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-[#C6A24E] hover:bg-[#A8882A]">+ New</button>
                <button onClick={loadChangeOrders} className="text-xs px-3 py-1.5 rounded-lg font-medium text-signal border border-signal hover:bg-blue-50">
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
                  <button onClick={createChangeOrder} className="px-3 py-2 bg-signal text-fg-on-accent rounded text-sm font-medium hover:bg-signal-hover">Create CO</button>
                  <button onClick={() => setShowCOForm(false)} className="text-xs text-fg-muted hover:text-fg">Cancel</button>
                </div>
              </div>
            )}
            {showCO && (
              <div className="space-y-2">
                {changeOrders.length === 0 ? (
                  <p className="text-sm text-fg-subtle text-center py-3">No change orders</p>
                ) : changeOrders.map((co: any) => (
                  <div key={co.id} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-fg">{co.changeNumber}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        co.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        co.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' :
                        co.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-surface-muted text-fg-muted'
                      }`}>{co.status}</span>
                    </div>
                    <p className="text-sm text-fg-muted">{co.reason}</p>
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
          <div className="bg-surface rounded-lg border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">Punch List</h2>
              <div className="flex gap-2">
                <button onClick={() => setShowPunchForm(!showPunchForm)} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-[#C6A24E] hover:bg-[#A8882A]">+ Add Item</button>
                <button onClick={loadPunchItems} className="text-xs px-3 py-1.5 rounded-lg font-medium text-signal border border-signal hover:bg-blue-50">
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
                  <button onClick={createPunchItem} className="px-3 py-2 bg-signal text-fg-on-accent rounded text-sm font-medium hover:bg-signal-hover">Add Item</button>
                  <button onClick={() => setShowPunchForm(false)} className="text-xs text-fg-muted hover:text-fg">Cancel</button>
                </div>
              </div>
            )}
            {showPunch && (
              <div className="space-y-2">
                {punchItems.length === 0 ? (
                  <p className="text-sm text-fg-subtle text-center py-3">No punch items</p>
                ) : punchItems.map((pi: any) => (
                  <div key={pi.id} className={`p-3 border rounded-lg ${pi.status === 'RESOLVED' ? 'bg-green-50 border-green-200' : pi.severity === 'CRITICAL' ? 'bg-red-50 border-red-200' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-fg">{pi.punchNumber}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          pi.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' :
                          pi.severity === 'MAJOR' ? 'bg-orange-200 text-orange-800' :
                          'bg-surface-muted text-fg-muted'
                        }`}>{pi.severity}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        pi.status === 'RESOLVED' ? 'bg-green-100 text-green-700' :
                        pi.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{pi.status.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-sm text-fg-muted">{pi.description}</p>
                    {pi.location && <p className="text-xs text-fg-muted mt-1">Location: {pi.location}</p>}
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

          {/* Delivery & Install PM Sign-off — Wave-D (D9). */}
          {DELIVERY_SIGNOFF_ENABLED && <DeliverySignOff jobId={jobId} />}
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Builder & Contact */}
          <div className="bg-surface rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-fg mb-4">Builder</h2>
            <p className="text-sm font-semibold text-fg">{job.builderName}</p>
            {job.builderContact && <p className="text-sm text-fg-muted">{job.builderContact}</p>}
            {job.order?.builder && (
              <div className="mt-3 pt-3 border-t space-y-1">
                {job.order.builder.email && <p className="text-sm text-blue-600">{job.order.builder.email}</p>}
                {job.order.builder.phone && <p className="text-sm text-fg-muted">{job.order.builder.phone}</p>}
                <Link href={`/ops/accounts`} className="text-xs text-signal hover:underline">View Account →</Link>
              </div>
            )}
          </div>

          {/* Assigned PM */}
          <div className="bg-surface rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-fg mb-4">Project Manager</h2>
            {job.assignedPM ? (
              <div>
                <p className="text-sm font-semibold text-fg">{fullName(job.assignedPM)}</p>
                {job.assignedPM.email && <p className="text-sm text-blue-600">{job.assignedPM.email}</p>}
                {job.assignedPM.phone && <p className="text-sm text-fg-muted">{job.assignedPM.phone}</p>}
              </div>
            ) : (
              <p className="text-sm text-fg-subtle italic">Unassigned</p>
            )}
          </div>

          {/* Linked Order — 4.5
              When linked: show order# (linked), status, total, optional PO/notes.
              When NOT linked: show "Not linked to an Order" + a disabled
              "Link to Order" action (no /api/ops/jobs/[id]/link-order route
              exists yet — TODO below). */}
          {job.order ? (
            <div className="bg-surface rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-fg mb-4">Linked Order</h2>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-fg-muted">Order #</span>
                  <Link
                    href={`/ops/orders/${job.order.id}`}
                    className="text-sm font-medium text-signal hover:underline"
                  >
                    {job.order.orderNumber} →
                  </Link>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-fg-muted">Total</span>
                  <span className="text-sm font-semibold">{formatCurrency(job.order.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-fg-muted">Status</span>
                  <span className="text-sm">{job.order.status}</span>
                </div>
                {job.order.poNumber && (
                  <div className="flex justify-between">
                    <span className="text-xs text-fg-muted">PO #</span>
                    <span className="text-sm">{job.order.poNumber}</span>
                  </div>
                )}
                {/* Surface shared coding pattern when jobNumber matches orderNumber. */}
                {job.jobNumber && job.order.orderNumber &&
                  (job.jobNumber === job.order.orderNumber ||
                   job.jobNumber.endsWith(job.order.orderNumber) ||
                   job.order.orderNumber.endsWith(job.jobNumber)) && (
                  <p className="text-[11px] text-fg-subtle italic mt-1">
                    Job number tracks order number per shared coding.
                  </p>
                )}
                {job.order.deliveryNotes && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-xs text-fg-muted">Delivery Notes</p>
                    <p className="text-sm text-fg-muted">{job.order.deliveryNotes}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-surface rounded-lg border p-5">
              <h2 className="text-lg font-semibold text-fg mb-4">Linked Order</h2>
              <p className="text-sm text-fg-subtle italic mb-3">Not linked to an Order</p>
              {/* Wired to POST /api/ops/jobs/[id]/link-order. Endpoint
                  enforces same-builder + already-linked-elsewhere guards
                  server-side. */}
              <button
                type="button"
                onClick={() => setShowLinkOrder(true)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface hover:bg-surface-muted text-fg"
              >
                Link to Order
              </button>
              {showLinkOrder && (
                <div className="mt-3 p-3 bg-surface-muted rounded-lg space-y-2">
                  <input
                    type="text"
                    value={linkOrderQuery}
                    onChange={e => setLinkOrderQuery(e.target.value)}
                    placeholder="Search by order # or PO #"
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                  {linkOrderSearching && (
                    <p className="text-xs text-fg-subtle">Searching…</p>
                  )}
                  {!linkOrderSearching && linkOrderResults.length > 0 && (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-border">
                      {linkOrderResults.map((o: any) => (
                        <li key={o.id} className="py-2 text-sm flex items-center justify-between">
                          <span>
                            <span className="font-medium text-fg">{o.orderNumber}</span>
                            {o.poNumber ? <span className="text-fg-muted ml-2">PO {o.poNumber}</span> : null}
                            {o.builder?.companyName ? (
                              <span className="text-fg-muted ml-2">— {o.builder.companyName}</span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            disabled={linkingOrderId !== null}
                            onClick={() => handleLinkOrder(o.id)}
                            className="text-xs px-2 py-1 rounded border border-border text-fg bg-surface hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {linkingOrderId === o.id ? 'Linking…' : 'Link'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {linkOrderError && (
                    <p className="text-xs text-red-600">{linkOrderError}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setShowLinkOrder(false); setLinkOrderQuery(''); setLinkOrderResults([]); setLinkOrderError(null) }}
                    className="text-xs text-fg-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assign Installer — 5.5-Part-B */}
          <div className="bg-surface rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-fg mb-4">Assign Installer</h2>
            <select
              value={installAssigneeChoice}
              onChange={e => handleAssignInstaller(e.target.value)}
              disabled={assigningInstaller}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-fg disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <option value="">— Select installer —</option>
              {installCrews.length > 0 && (
                <optgroup label="In-house Crews">
                  {installCrews.map(c => (
                    <option key={`crew:${c.id}`} value={`crew:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {trimVendors.length > 0 && (
                <optgroup label="Third-Party Trim Vendors">
                  {trimVendors.map(v => (
                    <option key={`vendor:${v.id}`} value={`vendor:${v.id}`}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {installCrews.length === 0 && trimVendors.length === 0 && (
              <p className="mt-2 text-xs text-fg-subtle italic">
                No installer options loaded yet.
              </p>
            )}
          </div>

          {/* Tasks Summary */}
          <div className="bg-surface rounded-lg border p-5">
            <h2 className="text-lg font-semibold text-fg mb-4">Activity Summary</h2>
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
                  <span className="text-sm text-fg-muted">{item.label}</span>
                  <span className={`text-sm font-semibold ${item.count > 0 ? 'text-signal' : 'text-fg-subtle'}`}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Documents */}
          <DocumentPanel jobId={job.id} orderId={job.order?.id || undefined} />

          {/* Notes — B-UX-7 */}
          <div className="bg-surface rounded-lg border p-5">
            <NotesSection entityType="job" entityId={job.id} title="Job Notes" />
          </div>
        </div>
      </div>
      )}

      {/* CO Impact Preview Sheet — mounted at root so it overlays the whole page */}
      <CoPreviewSheet
        jobId={jobId}
        open={showCoPreview}
        onClose={() => setShowCoPreview(false)}
      />

      {/* Material drill-down drawer — root-mounted for full-page overlay. */}
      {MATERIAL_DRAWER_ENABLED && (
        <MaterialDrawer
          jobId={jobId}
          open={showMaterialDrawer}
          onClose={() => setShowMaterialDrawer(false)}
        />
      )}

      {/* B-UX-3 — Edit slide-over. Mirrors the Builder/Community pattern: PATCH
          /api/ops/jobs/[id] (ADMIN/MANAGER/PROJECT_MANAGER) and merge the
          response into local state on success. */}
      <EditSlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Job"
        subtitle={job.jobNumber}
        fields={buildJobEditFields(pms, job.assignedPMId, job.assignedPM)}
        initialValues={{
          jobAddress: job.jobAddress ?? '',
          community: job.community ?? '',
          lotBlock: job.lotBlock ?? '',
          scheduledDate: job.scheduledDate
            ? new Date(job.scheduledDate).toISOString().slice(0, 10)
            : '',
          assignedPMId: job.assignedPMId ?? '',
          jobType: job.jobType ?? '',
          buildSheetNotes: job.buildSheetNotes ?? '',
        }}
        endpoint={`/api/ops/jobs/${jobId}`}
        method="PATCH"
        onSuccess={(body) => {
          // PATCH returns the updated raw row. Merge persisted edit fields
          // into local state so the header line + Job Information card
          // refresh without a full reload. The rest of the page (status,
          // related collections) is unaffected by edit-only fields.
          if (body && typeof body === 'object') {
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    jobAddress: body.jobAddress ?? prev.jobAddress,
                    community: body.community ?? prev.community,
                    lotBlock: body.lotBlock ?? prev.lotBlock,
                    scheduledDate:
                      body.scheduledDate ?? prev.scheduledDate,
                    assignedPMId:
                      body.assignedPMId ?? prev.assignedPMId,
                    jobType: body.jobType ?? prev.jobType,
                    buildSheetNotes:
                      body.buildSheetNotes ?? prev.buildSheetNotes,
                    // Reflect new PM in the right-rail card by looking up
                    // the chosen PM in the loaded list.
                    assignedPM: body.assignedPMId
                      ? (() => {
                          const m = pms.find((p) => p.id === body.assignedPMId)
                          return m
                            ? {
                                id: m.id,
                                firstName: m.firstName,
                                lastName: m.lastName,
                                email: prev.assignedPM?.email ?? null,
                                phone: prev.assignedPM?.phone ?? null,
                              }
                            : prev.assignedPM
                        })()
                      : null,
                  }
                : prev,
            )
          }
          setEditOpen(false)
          // Refetch in the background to pick up any joins (e.g. PM email)
          // that the raw row doesn't include.
          fetchJob()
        }}
      />
    </div>
  )
}

// ── B-UX-3 — Job edit slide-over field defs ─────────────────────────────
// Built dynamically so the assignedPM <select> options reflect the current
// roster fetched from /api/ops/staff?role=PROJECT_MANAGER. We also fold in
// the *currently-assigned* PM as a synthetic option when they aren't in the
// active list (e.g. inactive / role changed) so the dropdown can faithfully
// render the existing value without losing it on save.
function buildJobEditFields(
  pms: { id: string; firstName: string | null; lastName: string | null }[],
  currentPmId: string | null,
  currentPm: { id: string; firstName: string | null; lastName: string | null } | null,
): FieldDef[] {
  const pmOptions = pms.map((p) => ({
    value: p.id,
    label: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.id,
  }))
  if (
    currentPmId &&
    currentPm &&
    !pmOptions.some((o) => o.value === currentPmId)
  ) {
    pmOptions.unshift({
      value: currentPmId,
      label:
        [currentPm.firstName, currentPm.lastName].filter(Boolean).join(' ') ||
        currentPmId,
    })
  }

  return [
    {
      key: 'jobAddress',
      label: 'Job Address',
      type: 'text',
      nullableString: true,
      colSpan: 2,
      placeholder: '123 Main St, Frisco, TX 75033',
    },
    {
      key: 'community',
      label: 'Community',
      type: 'text',
      nullableString: true,
      placeholder: 'e.g. Mobberly Farms',
    },
    {
      key: 'lotBlock',
      label: 'Lot / Block',
      type: 'text',
      nullableString: true,
      placeholder: 'Lot 14 Block 3',
    },
    {
      key: 'scheduledDate',
      label: 'Scheduled Date',
      type: 'text',
      placeholder: 'YYYY-MM-DD',
      hint: 'ISO date — e.g. 2026-05-15',
    },
    {
      key: 'assignedPMId',
      label: 'Assigned PM',
      type: 'select',
      options: pmOptions,
    },
    {
      key: 'jobType',
      label: 'Job Type',
      type: 'select',
      options: [
        { value: 'TRIM_1', label: 'T1 — First Trim' },
        { value: 'TRIM_1_INSTALL', label: 'T1I — First Trim Install' },
        { value: 'TRIM_2', label: 'T2 — Second Trim (Finish)' },
        { value: 'TRIM_2_INSTALL', label: 'T2I — Second Trim Install' },
        { value: 'DOORS', label: 'DR — Door Delivery' },
        { value: 'DOOR_INSTALL', label: 'DRI — Door Install' },
        { value: 'HARDWARE', label: 'HW — Hardware Delivery' },
        { value: 'HARDWARE_INSTALL', label: 'HWI — Hardware Install' },
        { value: 'FINAL_FRONT', label: 'FF — Final Front' },
        { value: 'FINAL_FRONT_INSTALL', label: 'FFI — Final Front Install' },
        { value: 'QC_WALK', label: 'QC — Quality Control Walk' },
        { value: 'PUNCH', label: 'PL — Punch List' },
        { value: 'WARRANTY', label: 'WR — Warranty Callback' },
        { value: 'CUSTOM', label: 'CU — Custom / Other' },
      ],
    },
    {
      key: 'buildSheetNotes',
      label: 'Notes',
      type: 'textarea',
      nullableString: true,
      colSpan: 2,
      placeholder: 'Build sheet notes, special instructions, gotchas…',
    },
  ]
}
