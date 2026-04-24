'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Camera, CheckSquare, AlertTriangle, Pen, Play, CheckCircle2,
  Plus, Trash2, MapPin, Phone, Clipboard, Upload, Loader2, X,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import Dialog from '@/components/ui/Dialog'
import SignaturePad from '@/components/ui/SignaturePad'
import { useToast } from '@/contexts/ToastContext'

// ── Types ────────────────────────────────────────────────────────────────

interface BOMLine {
  id: string
  description: string
  quantity: number
  sku: string | null
  name: string | null
  displayName: string | null
}

interface JobNote {
  id: string
  subject: string
  body: string
  priority: string
  noteType: string
  createdAt: string
  firstName?: string
  lastName?: string
}

interface PunchItem {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
}

interface JobDetail {
  id: string
  jobNumber: string
  builderName: string
  builderContact: string | null
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  latitude: number | null
  longitude: number | null
  status: string
  scopeType: string
  scheduledDate: string | null
  actualDate: string | null
  completedAt: string | null
  order: { id: string; orderNumber: string; poNumber: string | null; total: number; deliveryNotes: string | null } | null
  pm: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null } | null
  bom: BOMLine[]
  notes: JobNote[]
  punchItems: PunchItem[]
  photos: string[]
}

// ── Utilities ────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Local-only punch item used before first save
interface LocalPunch {
  id: string // local temp id (starts with "local-")
  title: string
  description: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  resolved: boolean
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function InstallerJobDetailPage() {
  const router = useRouter()
  const params = useParams()
  const jobId = params?.jobId as string
  const { addToast } = useToast()

  const [job, setJob] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Local state
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [localPunch, setLocalPunch] = useState<LocalPunch[]>([])
  const [resolvedServerPunch, setResolvedServerPunch] = useState<Set<string>>(new Set())
  const [newPunchTitle, setNewPunchTitle] = useState('')
  const [newPunchPriority, setNewPunchPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM')

  // Dialogs
  const [sigOpen, setSigOpen] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [escalateReason, setEscalateReason] = useState('')
  const [escalating, setEscalating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')

  const photoInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/ops/portal/installer/jobs/${jobId}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setJob(data)
    } catch {
      setError('Could not load job.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (jobId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  // ── Actions ────────────────────────────────────────────────────────

  const startInstall = async () => {
    setStarting(true)
    try {
      const res = await fetch(`/api/ops/portal/installer/jobs/${jobId}/start`, { method: 'POST' })
      if (!res.ok) throw new Error()
      addToast({ type: 'success', title: 'Install started' })
      await load()
    } catch {
      addToast({ type: 'error', title: 'Could not start install' })
    } finally {
      setStarting(false)
    }
  }

  const uploadPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const arr: string[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (!f.type.startsWith('image/')) continue
        const dataUrl = await readFileAsDataUrl(f)
        arr.push(dataUrl)
      }
      if (arr.length === 0) return
      // Post to API and also keep locally until reload
      const res = await fetch(`/api/ops/portal/installer/jobs/${jobId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: arr, phase: job?.status === 'INSTALLING' ? 'during' : 'before' }),
      })
      if (!res.ok) throw new Error()
      setPhotos((prev) => [...prev, ...arr])
      addToast({ type: 'success', title: `${arr.length} photo${arr.length === 1 ? '' : 's'} uploaded` })
    } catch {
      addToast({ type: 'error', title: 'Photo upload failed' })
    } finally {
      setUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const submitEscalation = async () => {
    if (!escalateReason.trim()) return
    setEscalating(true)
    try {
      const res = await fetch(`/api/ops/portal/installer/jobs/${jobId}/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: escalateReason, severity: 'HIGH' }),
      })
      if (!res.ok) throw new Error()
      addToast({ type: 'success', title: 'PM notified', message: 'Escalation queued in their inbox.' })
      setEscalateOpen(false)
      setEscalateReason('')
    } catch {
      addToast({ type: 'error', title: 'Could not escalate' })
    } finally {
      setEscalating(false)
    }
  }

  const togglePunchResolved = (id: string, isLocal: boolean) => {
    if (isLocal) {
      setLocalPunch((arr) =>
        arr.map((p) => (p.id === id ? { ...p, resolved: !p.resolved } : p)),
      )
    } else {
      setResolvedServerPunch((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
    }
  }

  const addLocalPunch = () => {
    if (!newPunchTitle.trim()) return
    setLocalPunch((arr) => [
      ...arr,
      {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: newPunchTitle.trim(),
        description: '',
        priority: newPunchPriority,
        resolved: false,
      },
    ])
    setNewPunchTitle('')
    setNewPunchPriority('MEDIUM')
  }

  const removeLocalPunch = (id: string) => {
    setLocalPunch((arr) => arr.filter((p) => p.id !== id))
  }

  const completeInstall = async () => {
    setCompleting(true)
    try {
      // Keep unresolved local punch items as new punch items
      const newPunchItems = localPunch
        .filter((p) => !p.resolved)
        .map((p) => ({ title: p.title, description: p.description, priority: p.priority }))
      const body = {
        signatureDataUrl: signature,
        photos,
        punchItems: newPunchItems,
        punchItemsResolved: Array.from(resolvedServerPunch),
        notes: completionNotes,
      }
      const res = await fetch(`/api/ops/portal/installer/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      addToast({
        type: 'success',
        title: data.status === 'COMPLETE' ? 'Install complete' : 'Punch list created',
        message: data.status === 'COMPLETE' ? 'Job marked complete.' : 'PM will follow up on open items.',
      })
      router.push('/ops/portal/installer')
    } catch {
      addToast({ type: 'error', title: 'Could not complete install' })
    } finally {
      setCompleting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3 pb-20">
        <Skeleton variant="blueprint" className="h-10 w-48" />
        <Skeleton variant="blueprint" className="h-40 w-full" />
        <Skeleton variant="blueprint" className="h-64 w-full" />
      </div>
    )
  }
  if (error || !job) {
    return (
      <EmptyState
        title="Job not found"
        description={error || 'No job detail returned.'}
        action={{ label: 'Back to queue', href: '/ops/portal/installer' }}
      />
    )
  }

  const isInstalling = job.status === 'INSTALLING'
  const isComplete = job.status === 'COMPLETE' || job.status === 'INVOICED' || job.status === 'CLOSED'
  const canStart = !isInstalling && !isComplete
  const canComplete = isInstalling || job.status === 'DELIVERED' || job.status === 'PUNCH_LIST'

  const resolvedPunchCount = job.punchItems.filter((p) => resolvedServerPunch.has(p.id)).length
  + localPunch.filter((p) => p.resolved).length
  const totalPunchCount = job.punchItems.length + localPunch.length
  const outstandingPunch = totalPunchCount - resolvedPunchCount

  return (
    <div className="space-y-4 pb-28">
      {/* Sticky header bar */}
      <div className="sticky top-0 -mx-5 -mt-5 lg:-mx-7 lg:-mt-7 z-20 px-5 lg:px-7 py-3 border-b border-border backdrop-blur-md bg-canvas/85">
        <div className="flex items-center gap-3">
          <Link href="/ops/portal/installer">
            <button
              className="w-12 h-12 flex items-center justify-center rounded-md hover:bg-surface-muted transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-fg" />
            </button>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">{job.community || 'Job'}</p>
            <h1 className="text-[15px] font-semibold text-fg font-mono truncate">{job.jobNumber}</h1>
          </div>
          <StatusBadge status={job.status} />
        </div>
      </div>

      {/* Job summary */}
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div>
          <p className="text-[13px] font-medium text-fg">{job.builderName}</p>
          {job.lotBlock && <p className="text-[12px] text-fg-muted mt-0.5">{job.lotBlock}</p>}
          {job.jobAddress && (
            <div className="flex items-start gap-2 mt-2">
              <MapPin className="w-4 h-4 text-fg-muted mt-0.5 shrink-0" />
              <div className="text-[13px] text-fg">{job.jobAddress}</div>
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {job.latitude && job.longitude && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 h-11 px-3 rounded-md border border-border text-[13px] font-medium text-fg hover:bg-surface-muted"
            >
              <MapPin className="w-4 h-4" /> Navigate
            </a>
          )}
          {job.pm?.phone && (
            <a
              href={`tel:${job.pm.phone}`}
              className="inline-flex items-center gap-1.5 h-11 px-3 rounded-md border border-border text-[13px] font-medium text-fg hover:bg-surface-muted"
            >
              <Phone className="w-4 h-4" /> Call PM
            </a>
          )}
        </div>
      </div>

      {/* Order / BOM */}
      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clipboard className="w-4 h-4 text-fg-muted" />
            <h2 className="text-[13px] font-semibold text-fg">Door schedule / BOM</h2>
          </div>
          {job.order && (
            <span className="text-[11px] text-fg-subtle font-mono">{job.order.orderNumber}</span>
          )}
        </div>
        {job.bom.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-fg-subtle">
            No BOM lines linked to this job.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {job.bom.map((b) => (
              <li key={b.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-fg">{b.displayName || b.name || b.description}</p>
                  {b.sku && (
                    <p className="text-[11px] text-fg-subtle font-mono mt-0.5">{b.sku}</p>
                  )}
                </div>
                <span className="text-[13px] font-mono font-semibold text-fg shrink-0">
                  ×{b.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Photos */}
      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-fg-muted" />
            <h2 className="text-[13px] font-semibold text-fg">Photos</h2>
            <span className="text-[11px] text-fg-subtle font-mono">
              {job.photos.length + photos.length}
            </span>
          </div>
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md bg-accent-subtle text-accent-fg text-[12px] font-semibold hover:bg-accent hover:text-fg-on-accent disabled:opacity-60"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading' : 'Add'}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => uploadPhotos(e.target.files)}
          />
        </div>
        {job.photos.length + photos.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-fg-subtle">
            No photos yet. Tap <span className="font-semibold text-fg">Add</span> to capture.
          </div>
        ) : (
          <div className="p-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {[...job.photos, ...photos].map((p, i) => (
              <div key={i} className="aspect-square rounded-md overflow-hidden border border-border bg-surface-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt={`Install photo ${i + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Punch list */}
      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-fg-muted" />
            <h2 className="text-[13px] font-semibold text-fg">Punch list</h2>
            <span className="text-[11px] text-fg-subtle font-mono">
              {outstandingPunch} open · {totalPunchCount} total
            </span>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {job.punchItems.map((p) => {
            const resolved = resolvedServerPunch.has(p.id) || p.status === 'DONE'
            return (
              <li key={p.id} className="px-4 py-3 flex items-start gap-3">
                <button
                  onClick={() => togglePunchResolved(p.id, false)}
                  className="mt-0.5 w-6 h-6 rounded-md border border-border flex items-center justify-center shrink-0"
                  aria-label={resolved ? 'Mark open' : 'Mark resolved'}
                >
                  {resolved && <CheckCircle2 className="w-4 h-4 text-data-positive" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] ${resolved ? 'line-through text-fg-subtle' : 'text-fg'}`}>
                    {p.title}
                  </p>
                  {p.description && (
                    <p className="text-[11px] text-fg-muted mt-0.5">{p.description}</p>
                  )}
                </div>
              </li>
            )
          })}
          {localPunch.map((p) => (
            <li key={p.id} className="px-4 py-3 flex items-start gap-3">
              <button
                onClick={() => togglePunchResolved(p.id, true)}
                className="mt-0.5 w-6 h-6 rounded-md border border-border flex items-center justify-center shrink-0"
                aria-label={p.resolved ? 'Mark open' : 'Mark resolved'}
              >
                {p.resolved && <CheckCircle2 className="w-4 h-4 text-data-positive" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] ${p.resolved ? 'line-through text-fg-subtle' : 'text-fg'}`}>
                  {p.title}
                </p>
                <p className="text-[11px] text-fg-subtle mt-0.5 font-mono">{p.priority}</p>
              </div>
              <button
                onClick={() => removeLocalPunch(p.id)}
                className="w-9 h-9 rounded-md flex items-center justify-center text-fg-subtle hover:text-data-negative hover:bg-data-negative-bg"
                aria-label="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-3 border-t border-border bg-surface-muted/40 flex gap-2">
          <input
            value={newPunchTitle}
            onChange={(e) => setNewPunchTitle(e.target.value)}
            placeholder="Add punch item…"
            className="flex-1 h-11 px-3 rounded-md border border-border bg-surface text-[13px] text-fg focus:outline-none focus:border-border-strong"
          />
          <select
            value={newPunchPriority}
            onChange={(e) => setNewPunchPriority(e.target.value as any)}
            className="h-11 px-2 rounded-md border border-border bg-surface text-[13px] text-fg"
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Med</option>
            <option value="HIGH">High</option>
          </select>
          <button
            onClick={addLocalPunch}
            disabled={!newPunchTitle.trim()}
            className="h-11 w-11 rounded-md bg-accent text-fg-on-accent flex items-center justify-center disabled:opacity-50"
            aria-label="Add punch item"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Completion notes */}
      <section className="rounded-xl border border-border bg-surface p-4 space-y-2">
        <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-fg-subtle">
          Completion notes (optional)
        </label>
        <textarea
          value={completionNotes}
          onChange={(e) => setCompletionNotes(e.target.value)}
          rows={3}
          placeholder="Anything the PM / homeowner should know…"
          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-[13px] text-fg focus:outline-none focus:border-border-strong resize-none"
        />
      </section>

      {/* Action strip — sticky bottom */}
      <div className="fixed left-0 right-0 bottom-0 z-30 border-t border-border bg-canvas/95 backdrop-blur-md px-4 py-3">
        <div className="max-w-7xl mx-auto grid grid-cols-4 gap-2">
          <button
            onClick={() => setEscalateOpen(true)}
            className="col-span-1 h-12 rounded-md border border-border text-data-negative-fg bg-data-negative-bg text-[12px] font-semibold flex items-center justify-center gap-1.5"
          >
            <AlertTriangle className="w-4 h-4" /> <span className="hidden xs:inline">PM Help</span>
          </button>
          <button
            onClick={() => setSigOpen(true)}
            className={`col-span-1 h-12 rounded-md border text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              signature ? 'border-data-positive bg-data-positive-bg text-data-positive-fg' : 'border-border bg-surface text-fg'
            }`}
          >
            <Pen className="w-4 h-4" /> {signature ? 'Signed' : 'Signature'}
          </button>
          {canStart && (
            <button
              onClick={startInstall}
              disabled={starting}
              className="col-span-2 h-12 rounded-md bg-accent text-fg-on-accent text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start Install
            </button>
          )}
          {!canStart && canComplete && (
            <button
              onClick={completeInstall}
              disabled={completing}
              className="col-span-2 h-12 rounded-md bg-data-positive text-white text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {completing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Complete Install
            </button>
          )}
          {!canStart && !canComplete && (
            <div className="col-span-2 h-12 rounded-md bg-surface-muted text-fg-subtle text-[13px] font-semibold flex items-center justify-center">
              No action
            </div>
          )}
        </div>
      </div>

      {/* Signature dialog */}
      <Dialog open={sigOpen} onClose={() => setSigOpen(false)} title="Customer signature">
        <SignaturePad
          height={280}
          onCancel={() => setSigOpen(false)}
          onConfirm={(dataUrl) => {
            setSignature(dataUrl)
            setSigOpen(false)
            addToast({ type: 'success', title: 'Signature captured' })
          }}
        />
      </Dialog>

      {/* Escalate dialog */}
      <Dialog open={escalateOpen} onClose={() => setEscalateOpen(false)} title="Request PM help">
        <div className="space-y-3">
          <p className="text-[12px] text-fg-muted">
            {job.pm ? `This will notify ${job.pm.firstName} ${job.pm.lastName}.` : 'This will go to the ops inbox for dispatch.'}
          </p>
          <textarea
            value={escalateReason}
            onChange={(e) => setEscalateReason(e.target.value)}
            rows={4}
            placeholder="What's going on? Be specific."
            className="w-full px-3 py-2 rounded-md border border-border bg-surface text-[13px] text-fg focus:outline-none focus:border-border-strong resize-none"
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="lg" fullWidth className="!min-h-[48px]" onClick={() => setEscalateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={escalating}
              disabled={!escalateReason.trim()}
              className="!min-h-[48px]"
              onClick={submitEscalation}
            >
              Send
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
