'use client'

/**
 * Builder Portal — Warranty client.
 *
 * §4.11 Warranty. v1 stub per spec — basic CRUD: list of claims, "New
 * Claim" button → form (subject, type, description, product fields,
 * site address, contact info), submit → POST /api/builders/warranty.
 */

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileWarning,
  Image as ImageIcon,
  Loader2,
  Plus,
  Shield,
  Trash2,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { usePortal } from '@/components/portal/PortalContext'

export interface WarrantyClaim {
  id: string
  claimNumber: string
  type: string
  status: string
  priority: string
  subject: string
  description: string
  productName: string | null
  resolutionType: string | null
  resolutionNotes: string | null
  creditAmount: number | null
  orderId: string | null
  photoUrls: string[] | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface OrderLookup {
  id: string
  orderNumber: string
  poNumber: string | null
  status: string
  total: number
  createdAt: string
}

export interface JobLookup {
  id: string
  jobNumber: string
  lotBlock: string | null
  community: string | null
  address: string | null
  status: string
  scheduledDate: string | null
  orderNumber: string | null
}

export interface WarrantyPolicy {
  id: string
  name: string
  type: string
  category: string | null
  durationMonths: number | null
  coverageDetails: string | null
  exclusions: string | null
  claimProcess: string | null
}

const STATUS_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  SUBMITTED:   { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Submitted' },
  IN_REVIEW:   { bg: 'rgba(212,165,74,0.16)',  fg: '#7A5413', label: 'In Review' },
  APPROVED:    { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Approved' },
  REJECTED:    { bg: 'rgba(110,42,36,0.10)',   fg: '#7E2417', label: 'Rejected' },
  RESOLVED:    { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Resolved' },
  CLOSED:      { bg: 'rgba(107,96,86,0.12)',   fg: '#5A4F46', label: 'Closed' },
  WAITING_INFO:{ bg: 'rgba(184,135,107,0.16)', fg: '#7A5A45', label: 'Waiting' },
}

const PRIORITY_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  LOW:    { bg: 'rgba(107,96,86,0.12)', fg: '#5A4F46', label: 'Low' },
  MEDIUM: { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Medium' },
  HIGH:   { bg: 'rgba(212,165,74,0.16)', fg: '#7A5413', label: 'High' },
  URGENT: { bg: 'rgba(110,42,36,0.10)', fg: '#7E2417', label: 'Urgent' },
}

const TYPE_OPTIONS = [
  { value: 'PRODUCT_DEFECT', label: 'Product defect' },
  { value: 'INSTALLATION', label: 'Installation issue' },
  { value: 'WARRANTY', label: 'Warranty repair' },
  { value: 'DAMAGE', label: 'Damage / cosmetic' },
  { value: 'MISSING_PARTS', label: 'Missing parts' },
  { value: 'OTHER', label: 'Other' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

interface FormState {
  type: string
  subject: string
  description: string
  productName: string
  productSku: string
  installDate: string
  issueDate: string
  contactName: string
  contactEmail: string
  contactPhone: string
  siteAddress: string
  siteCity: string
  siteState: string
  siteZip: string
  policyId: string
  orderId: string
  jobId: string
}

const EMPTY_FORM: FormState = {
  type: 'PRODUCT_DEFECT',
  subject: '',
  description: '',
  productName: '',
  productSku: '',
  installDate: '',
  issueDate: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  siteAddress: '',
  siteCity: '',
  siteState: '',
  siteZip: '',
  policyId: '',
  orderId: '',
  jobId: '',
}

// ── File upload guards (mirror /photos route caps) ──────────────────────
const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5 MB / file
const MAX_PHOTOS = 10 // per submission — server caps total at 20
const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/gif',
])

interface QueuedPhoto {
  key: string
  fileName: string
  fileSize: number
  dataUrl: string
  status: 'queued' | 'uploading' | 'success' | 'error'
  error?: string
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('Read failed'))
    reader.readAsDataURL(file)
  })
}

export function WarrantyClient({
  claims,
  policies,
}: {
  claims: WarrantyClaim[]
  policies: WarrantyPolicy[]
}) {
  const router = useRouter()
  const { builder } = usePortal()
  const [showForm, setShowForm] = useState(claims.length === 0)
  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    contactEmail: builder.email,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Lookups (orders + active jobs for autocomplete) ──────────────
  const [orders, setOrders] = useState<OrderLookup[]>([])
  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [lookupsLoaded, setLookupsLoaded] = useState(false)

  // ── Photo upload queue ──────────────────────────────────────────
  const [photos, setPhotos] = useState<QueuedPhoto[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Lazy-load lookups when the form first opens — keeps the initial
  // page render thin (a builder with 0 claims still pays for the
  // small lookups round trip, but only once per session).
  useEffect(() => {
    if (!showForm || lookupsLoaded) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/builders/warranty/lookups?limit=50', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) {
          // Soft-fail — autocomplete just won't have suggestions
          if (!cancelled) setLookupsLoaded(true)
          return
        }
        const data = await res.json()
        if (cancelled) return
        setOrders(Array.isArray(data?.orders) ? data.orders : [])
        setJobs(Array.isArray(data?.jobs) ? data.jobs : [])
        setLookupsLoaded(true)
      } catch {
        if (!cancelled) setLookupsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showForm, lookupsLoaded])

  function update(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // ── Photo queue mgmt ──────────────────────────────────────────────
  async function handlePhotoPick(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    const list = Array.from(files)
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) {
      setError(`You can attach up to ${MAX_PHOTOS} photos per claim.`)
      return
    }
    const trimmed = list.slice(0, room)

    const newQueue: QueuedPhoto[] = []
    for (const file of trimmed) {
      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        newQueue.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileSize: file.size,
          dataUrl: '',
          status: 'error',
          error: 'Unsupported file type — use JPG, PNG, HEIC, or WebP.',
        })
        continue
      }
      if (file.size > MAX_PHOTO_BYTES) {
        newQueue.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileSize: file.size,
          dataUrl: '',
          status: 'error',
          error: `File over ${(MAX_PHOTO_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
        })
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        newQueue.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileSize: file.size,
          dataUrl,
          status: 'queued',
        })
      } catch {
        newQueue.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileSize: file.size,
          dataUrl: '',
          status: 'error',
          error: 'Could not read file.',
        })
      }
    }
    setPhotos((prev) => [...prev, ...newQueue])
  }

  function removePhoto(key: string) {
    setPhotos((prev) => prev.filter((p) => p.key !== key))
  }

  async function uploadPhotos(claimId: string): Promise<void> {
    const queued = photos.filter((p) => p.status === 'queued')
    if (queued.length === 0) return

    // Mark all uploading at once for snappier UI feedback
    setPhotos((prev) =>
      prev.map((p) =>
        p.status === 'queued' ? { ...p, status: 'uploading' } : p,
      ),
    )

    try {
      const res = await fetch(
        `/api/builders/warranty/${encodeURIComponent(claimId)}/photos`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: queued.map((p) => p.dataUrl) }),
        },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Photo upload failed')
      }
      setPhotos((prev) =>
        prev.map((p) =>
          p.status === 'uploading' ? { ...p, status: 'success' } : p,
        ),
      )
    } catch (err: any) {
      setPhotos((prev) =>
        prev.map((p) =>
          p.status === 'uploading'
            ? { ...p, status: 'error', error: err?.message || 'Upload failed' }
            : p,
        ),
      )
      // Don't throw — claim is already submitted, photos are best-effort
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.subject.trim() || !form.description.trim() || !form.type) {
      setError('Subject, description, and type are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/builders/warranty', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          subject: form.subject.trim(),
          description: form.description.trim(),
          productName: form.productName.trim() || undefined,
          productSku: form.productSku.trim() || undefined,
          installDate: form.installDate || undefined,
          issueDate: form.issueDate || undefined,
          contactName: form.contactName.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          siteAddress: form.siteAddress.trim() || undefined,
          siteCity: form.siteCity.trim() || undefined,
          siteState: form.siteState.trim() || undefined,
          siteZip: form.siteZip.trim() || undefined,
          policyId: form.policyId || undefined,
          orderId: form.orderId || undefined,
          jobId: form.jobId || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to submit claim')
      }
      const data = await res.json()

      // Upload any queued photos against the new claim id. Best-effort —
      // if photos fail, we still want the user to see "claim submitted",
      // because the claim itself succeeded and ops can chase the photos
      // via email reply.
      if (data?.claimId && photos.some((p) => p.status === 'queued')) {
        await uploadPhotos(data.claimId)
      }

      const queuedCount = photos.filter((p) => p.status === 'queued' || p.status === 'success').length
      const photoSuffix = queuedCount > 0 ? ` (${queuedCount} photo${queuedCount === 1 ? '' : 's'} attached)` : ''
      setSuccess(`Claim ${data.claimNumber} submitted${photoSuffix}. We'll be in touch.`)
      setForm({ ...EMPTY_FORM, contactEmail: builder.email })
      setPhotos([])
      setShowForm(false)
      router.refresh()
      setTimeout(() => setSuccess(null), 8_000)
    } catch (err: any) {
      setError(err?.message || 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="portal-eyebrow mb-2">Service & Returns</div>
          <h1 className="portal-page-title">Warranty &amp; Claims</h1>
          <p
            className="text-[15px] mt-2"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            File a claim for damaged goods, missing parts, or warranty
            repairs.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
            style={{
              background:
                'var(--grad)',
              color: 'white',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Claim
          </button>
        )}
      </div>

      {/* Success banner */}
      {success && (
        <div
          className="px-4 py-3 rounded-md text-sm flex items-center gap-2"
          style={{
            background: 'rgba(56,128,77,0.10)',
            border: '1px solid rgba(56,128,77,0.3)',
            color: '#1A4B21',
          }}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="ml-auto p-0.5 rounded hover:bg-white/50"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <PortalCard
          title="File a Claim"
          subtitle="Provide as much detail as you can — it speeds resolution."
          action={
            claims.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setError(null)
                }}
                className="p-1 rounded hover:bg-[var(--portal-bg-elevated)]"
                aria-label="Cancel"
              >
                <X
                  className="w-4 h-4"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                />
              </button>
            ) : undefined
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Type" required>
                <select
                  value={form.type}
                  onChange={(e) => update('type', e.target.value)}
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              {policies.length > 0 && (
                <Field label="Linked Policy (optional)">
                  <select
                    value={form.policyId}
                    onChange={(e) => update('policyId', e.target.value)}
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  >
                    <option value="">— None —</option>
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <Field label="Subject" required>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => update('subject', e.target.value)}
                placeholder="Short summary, e.g. 'Cracked door panel — Lot 42'"
                className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
            </Field>

            <Field label="Description" required>
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={4}
                placeholder="What happened? When was the issue discovered? Photos can be sent later — for now, just write what you'd tell the project manager."
                className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30 resize-y"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Product Name">
                <input
                  type="text"
                  value={form.productName}
                  onChange={(e) => update('productName', e.target.value)}
                  placeholder="e.g. ADT 3068 RH Interior Door"
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
              <Field label="Product SKU">
                <input
                  type="text"
                  value={form.productSku}
                  onChange={(e) => update('productSku', e.target.value)}
                  placeholder="e.g. BC004010"
                  className="h-10 w-full px-3 font-mono text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
              <Field label="Install Date">
                <input
                  type="date"
                  value={form.installDate}
                  onChange={(e) => update('installDate', e.target.value)}
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
              <Field label="Issue Discovered">
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => update('issueDate', e.target.value)}
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
            </div>

            {/* Optional links: order # + job/lot/address */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Order # (optional)">
                <OrderCombobox
                  value={form.orderId}
                  options={orders}
                  loading={!lookupsLoaded}
                  onChange={(id) => update('orderId', id)}
                />
              </Field>
              <Field label="Job # / address (optional)">
                <JobCombobox
                  value={form.jobId}
                  options={jobs}
                  loading={!lookupsLoaded}
                  onChange={(id) => update('jobId', id)}
                />
              </Field>
            </div>

            {/* Photo upload */}
            <Field label="Photos (optional)">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full px-4 py-6 rounded-md text-sm border border-dashed flex flex-col items-center justify-center gap-1 transition-colors hover:bg-[var(--portal-bg-elevated,#FAF5E8)]"
                  style={{
                    borderColor: 'var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-muted, #6B6056)',
                    background: 'var(--portal-bg-card, #FFFFFF)',
                  }}
                  disabled={photos.length >= MAX_PHOTOS}
                >
                  <Camera className="w-5 h-5" aria-hidden="true" />
                  <span className="font-medium">
                    {photos.length === 0 ? 'Add photos' : 'Add more'}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--portal-text-subtle)' }}>
                    JPG, PNG, HEIC, or WebP · up to{' '}
                    {(MAX_PHOTO_BYTES / 1024 / 1024).toFixed(0)}&nbsp;MB each ·{' '}
                    {MAX_PHOTOS - photos.length} slot
                    {MAX_PHOTOS - photos.length === 1 ? '' : 's'} left
                  </span>
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handlePhotoPick(e.target.files)
                    e.target.value = ''
                  }}
                />
                {photos.length > 0 && (
                  <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {photos.map((p) => (
                      <li
                        key={p.key}
                        className="relative rounded-md overflow-hidden group"
                        style={{
                          border: '1px solid var(--portal-border-light, #F0E8DA)',
                          background: 'var(--portal-bg-card, #FFFFFF)',
                        }}
                      >
                        {p.dataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.dataUrl}
                            alt={p.fileName}
                            className="w-full h-24 object-cover"
                          />
                        ) : (
                          <div
                            className="w-full h-24 flex items-center justify-center"
                            style={{ background: 'var(--portal-bg-elevated, #FAF5E8)' }}
                          >
                            <ImageIcon
                              className="w-6 h-6 opacity-40"
                              aria-hidden="true"
                              style={{ color: 'var(--portal-text-muted)' }}
                            />
                          </div>
                        )}
                        {/* status overlay */}
                        {p.status === 'uploading' && (
                          <div
                            className="absolute inset-0 flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.35)' }}
                          >
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          </div>
                        )}
                        {p.status === 'success' && (
                          <div
                            className="absolute top-1 left-1 rounded-full p-1"
                            style={{ background: 'rgba(56,128,77,0.9)' }}
                          >
                            <CheckCircle2 className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {p.status === 'error' && (
                          <div
                            className="absolute inset-0 flex items-end p-2"
                            style={{ background: 'rgba(110,42,36,0.55)' }}
                          >
                            <span className="text-[10px] text-white font-medium leading-tight">
                              {p.error || 'Upload failed'}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removePhoto(p.key)}
                          className="absolute top-1 right-1 rounded-full p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          style={{ background: 'rgba(255,255,255,0.95)' }}
                          aria-label="Remove photo"
                          disabled={p.status === 'uploading'}
                        >
                          <Trash2 className="w-3 h-3" style={{ color: '#7E2417' }} />
                        </button>
                        <div
                          className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] truncate"
                          style={{
                            background: 'rgba(255,255,255,0.85)',
                            color: 'var(--portal-text-muted, #6B6056)',
                          }}
                          title={p.fileName}
                        >
                          {p.fileName}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Field>

            <details className="space-y-3">
              <summary
                className="cursor-pointer text-xs font-medium"
                style={{ color: 'var(--c1)' }}
              >
                Site address & contact (optional)
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                <Field label="Site Address">
                  <input
                    type="text"
                    value={form.siteAddress}
                    onChange={(e) => update('siteAddress', e.target.value)}
                    placeholder="123 Main St"
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="City">
                    <input
                      type="text"
                      value={form.siteCity}
                      onChange={(e) => update('siteCity', e.target.value)}
                      className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                      style={{
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                      }}
                    />
                  </Field>
                  <Field label="State / Zip">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={form.siteState}
                        onChange={(e) => update('siteState', e.target.value)}
                        maxLength={2}
                        placeholder="TX"
                        className="h-10 w-12 px-2 text-center text-sm rounded-md uppercase focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                        style={{
                          background: 'var(--portal-bg-card, #FFFFFF)',
                          border: '1px solid var(--portal-border, #E8DFD0)',
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      />
                      <input
                        type="text"
                        value={form.siteZip}
                        onChange={(e) => update('siteZip', e.target.value)}
                        maxLength={10}
                        placeholder="75024"
                        className="h-10 flex-1 px-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                        style={{
                          background: 'var(--portal-bg-card, #FFFFFF)',
                          border: '1px solid var(--portal-border, #E8DFD0)',
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      />
                    </div>
                  </Field>
                </div>
                <Field label="Contact Name">
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => update('contactName', e.target.value)}
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
                <Field label="Contact Phone">
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => update('contactPhone', e.target.value)}
                    placeholder="(214) 555-0100"
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
                <Field label="Contact Email" className="md:col-span-2">
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => update('contactEmail', e.target.value)}
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
              </div>
            </details>

            {error && (
              <div
                className="px-3 py-2 rounded-md text-sm flex items-start gap-2"
                style={{
                  background: 'rgba(110,42,36,0.08)',
                  color: '#7E2417',
                }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              {claims.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 h-9 rounded-md text-sm font-medium transition-colors"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-5 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-60"
                style={{
                  background:
                    'var(--grad)',
                  color: 'white',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {submitting ? 'Submitting…' : 'Submit Claim'}
              </button>
            </div>
          </form>
        </PortalCard>
      )}

      {/* Claims list */}
      <PortalCard
        title="Your Claims"
        subtitle={
          claims.length > 0
            ? `${claims.length} claim${claims.length === 1 ? '' : 's'} on file`
            : 'No claims filed yet'
        }
        noBodyPadding
      >
        {claims.length === 0 ? (
          <div
            className="px-6 py-16 text-center text-sm"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Shield
              className="w-10 h-10 mx-auto mb-3 opacity-30"
              aria-hidden="true"
            />
            <p
              className="text-base font-medium"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              No claims yet
            </p>
            <p className="text-sm mt-1 max-w-sm mx-auto">
              Hopefully you don&apos;t need this. But when you do, file fast and
              we&apos;ll get on it.
            </p>
          </div>
        ) : (
          <ul>
            {claims.map((c) => {
              const expanded = expandedId === c.id
              const status = STATUS_BADGE[c.status] || STATUS_BADGE.SUBMITTED
              const priority =
                PRIORITY_BADGE[c.priority] || PRIORITY_BADGE.MEDIUM
              return (
                <li
                  key={c.id}
                  className="border-t"
                  style={{ borderColor: 'var(--portal-border-light, #F0E8DA)' }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                    className="w-full text-left px-4 md:px-6 py-3 flex items-center gap-3 transition-colors hover:bg-[var(--portal-bg-elevated)]"
                  >
                    <div
                      className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center"
                      style={{
                        background: 'rgba(110,42,36,0.08)',
                        color: '#7E2417',
                      }}
                    >
                      <FileWarning className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                          className="font-mono text-xs font-medium"
                          style={{
                            color: 'var(--portal-text-strong, #3E2A1E)',
                          }}
                        >
                          {c.claimNumber}
                        </span>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: status.bg, color: status.fg }}
                        >
                          {status.label}
                        </span>
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                          style={{
                            background: priority.bg,
                            color: priority.fg,
                          }}
                        >
                          {priority.label}
                        </span>
                      </div>
                      <div
                        className="text-xs mt-0.5 truncate"
                        style={{
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      >
                        {c.subject}
                      </div>
                      <div
                        className="text-[11px] mt-0.5"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      >
                        Filed {fmtDate(c.createdAt)}
                        {c.resolvedAt && (
                          <> · Resolved {fmtDate(c.resolvedAt)}</>
                        )}
                      </div>
                    </div>
                    {expanded ? (
                      <ChevronUp
                        className="w-4 h-4 shrink-0"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      />
                    ) : (
                      <ChevronDown
                        className="w-4 h-4 shrink-0"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      />
                    )}
                  </button>
                  {expanded && (
                    <div
                      className="px-4 md:px-6 py-4 space-y-3"
                      style={{
                        background: 'var(--portal-bg-elevated, #FAF5E8)',
                      }}
                    >
                      {c.productName && (
                        <Detail
                          label="Product"
                          value={c.productName}
                        />
                      )}
                      <Detail
                        label="Description"
                        value={c.description}
                        multiline
                      />
                      {c.resolutionNotes && (
                        <Detail
                          label="Resolution"
                          value={c.resolutionNotes}
                          multiline
                          accent
                        />
                      )}
                      {c.creditAmount != null && c.creditAmount > 0 && (
                        <Detail
                          label="Credit Issued"
                          value={`$${c.creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          accent
                        />
                      )}
                      {Array.isArray(c.photoUrls) && c.photoUrls.length > 0 && (
                        <div>
                          <div
                            className="text-[10px] uppercase tracking-wider font-semibold mb-1"
                            style={{ color: 'var(--portal-text-subtle)' }}
                          >
                            Photos ({c.photoUrls.length})
                          </div>
                          <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            {c.photoUrls.map((url, idx) => (
                              <li
                                key={`${c.id}-photo-${idx}`}
                                className="rounded-md overflow-hidden"
                                style={{
                                  border: '1px solid var(--portal-border-light, #F0E8DA)',
                                  background: 'var(--portal-bg-card, #FFFFFF)',
                                }}
                              >
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block"
                                  title={`Photo ${idx + 1}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt={`Claim ${c.claimNumber} photo ${idx + 1}`}
                                    className="w-full h-20 object-cover hover:opacity-90 transition-opacity"
                                  />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PortalCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Lightweight combobox — typeahead text + filtered dropdown.
// We avoid pulling in cmdk / radix here because the form is the only
// caller and the lookup arrays are bounded (≤ 50 each).
// ─────────────────────────────────────────────────────────────────────
function OrderCombobox({
  value,
  options,
  loading,
  onChange,
}: {
  value: string
  options: OrderLookup[]
  loading: boolean
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => options.find((o) => o.id === value) || null,
    [options, value],
  )

  // Show selection in the input when collapsed
  useEffect(() => {
    if (!open && selected) {
      setQuery(
        selected.poNumber
          ? `${selected.orderNumber} (PO ${selected.poNumber})`
          : selected.orderNumber,
      )
    } else if (!open && !selected) {
      setQuery('')
    }
  }, [open, selected])

  // Click-outside collapse
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || (selected && query.startsWith(selected.orderNumber))) {
      return options.slice(0, 25)
    }
    return options
      .filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          (o.poNumber || '').toLowerCase().includes(q),
      )
      .slice(0, 25)
  }, [query, options, selected])

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (e.target.value === '' && value) onChange('')
          }}
          onFocus={() => setOpen(true)}
          placeholder={loading ? 'Loading…' : 'Search order # or PO…'}
          disabled={loading}
          className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              setQuery('')
              setOpen(false)
            }}
            aria-label="Clear order"
            className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-muted, #6B6056)',
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <ul
          className="absolute z-20 mt-1 w-full rounded-md max-h-56 overflow-y-auto py-1 shadow-lg"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
          }}
        >
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--portal-bg-elevated,#FAF5E8)] transition-colors"
              >
                <div
                  className="font-mono"
                  style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                >
                  {o.orderNumber}
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  {o.poNumber ? `PO ${o.poNumber} · ` : ''}
                  {o.status} ·{' '}
                  {new Date(o.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && filtered.length === 0 && (
        <div
          className="absolute z-20 mt-1 w-full rounded-md py-2 px-3 text-xs"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-muted, #6B6056)',
          }}
        >
          No matching orders.
        </div>
      )}
    </div>
  )
}

function JobCombobox({
  value,
  options,
  loading,
  onChange,
}: {
  value: string
  options: JobLookup[]
  loading: boolean
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => options.find((o) => o.id === value) || null,
    [options, value],
  )

  useEffect(() => {
    if (!open && selected) {
      setQuery(
        [selected.jobNumber, selected.lotBlock, selected.community]
          .filter(Boolean)
          .join(' · '),
      )
    } else if (!open && !selected) {
      setQuery('')
    }
  }, [open, selected])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 25)
    return options
      .filter((j) =>
        [j.jobNumber, j.lotBlock, j.community, j.address, j.orderNumber]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q)),
      )
      .slice(0, 25)
  }, [query, options])

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (e.target.value === '' && value) onChange('')
          }}
          onFocus={() => setOpen(true)}
          placeholder={loading ? 'Loading…' : 'Search job, lot, or address…'}
          disabled={loading}
          className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              setQuery('')
              setOpen(false)
            }}
            aria-label="Clear job"
            className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-muted, #6B6056)',
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <ul
          className="absolute z-20 mt-1 w-full rounded-md max-h-56 overflow-y-auto py-1 shadow-lg"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
          }}
        >
          {filtered.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(j.id)
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--portal-bg-elevated,#FAF5E8)] transition-colors"
              >
                <div
                  className="font-mono"
                  style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                >
                  {j.jobNumber}
                  {j.lotBlock ? ` · ${j.lotBlock}` : ''}
                </div>
                <div
                  className="text-[10px] truncate"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  {[j.community, j.address].filter(Boolean).join(' · ') ||
                    'No address on file'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && filtered.length === 0 && (
        <div
          className="absolute z-20 mt-1 w-full rounded-md py-2 px-3 text-xs"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-muted, #6B6056)',
          }}
        >
          No matching jobs.
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label
        className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
        style={{ color: 'var(--portal-text-subtle)' }}
      >
        {label} {required && <span style={{ color: '#7E2417' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function Detail({
  label,
  value,
  multiline,
  accent,
}: {
  label: string
  value: string
  multiline?: boolean
  accent?: boolean
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider font-semibold mb-1"
        style={{ color: 'var(--portal-text-subtle)' }}
      >
        {label}
      </div>
      <div
        className={`text-sm ${multiline ? 'whitespace-pre-line leading-relaxed' : ''}`}
        style={{
          color: accent
            ? 'var(--portal-success, #1A4B21)'
            : 'var(--portal-text, #2C2C2C)',
        }}
      >
        {value}
      </div>
    </div>
  )
}
