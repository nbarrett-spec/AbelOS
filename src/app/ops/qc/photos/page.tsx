'use client'

/**
 * QC Photo Queue — B-FEAT-5 (2026-05-05)
 *
 * Two stages of structured photo requirements:
 *   POST_MFG  (per door / per job)  — DOOR_FULL, DOOR_BORE
 *   DELIVERY  (per load)             — TRIM_FULL, TRIM_FRONT, DOORS_FULL,
 *                                       DOORS_SIDE, HARDWARE
 *
 * The page surfaces a checklist per scope (job for POST_MFG, delivery for
 * DELIVERY). For each photoType we show whether a QcPhoto row exists; if
 * not, the user uploads via a hidden <input type="file"> wired to the
 * existing /api/ops/documents/vault POST flow, then POSTs to
 * /api/ops/qc/photos to create the link row.
 *
 * A stage is "complete" only when every required photoType has at least
 * one QcPhoto row.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Camera,
  CheckCircle2,
  Circle,
  Loader2,
  Upload,
  AlertTriangle,
  Factory,
  Truck,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

type Stage = 'POST_MFG' | 'DELIVERY'

interface Requirement {
  id: string
  stage: string
  photoType: string
  required: boolean
  description: string | null
}

interface Photo {
  id: string
  jobId: string | null
  doorIdentityId: string | null
  deliveryId: string | null
  stage: string
  photoType: string
  documentVaultId: string | null
  uploadedBy: string | null
  uploadedAt: string
}

interface JobRow {
  id: string
  jobNumber: string | null
  builderName: string | null
  jobAddress: string | null
  community: string | null
  status: string | null
}

interface DeliveryRow {
  id: string
  scheduledDate: string | null
  status: string | null
  jobNumber: string | null
  jobAddress: string | null
  builderName: string | null
}

interface ScopeStatus {
  scopeId: string
  loading: boolean
  uploaded: string[]
  missing: string[]
  complete: boolean
  photos: Photo[]
}

const STAGE_LABEL: Record<Stage, string> = {
  POST_MFG: 'Post-Manufacturing',
  DELIVERY: 'Delivery',
}

const PHOTO_TYPE_LABEL: Record<string, string> = {
  DOOR_FULL: 'Door — Full',
  DOOR_BORE: 'Door — Bore',
  TRIM_FULL: 'Trim — Full',
  TRIM_FRONT: 'Trim — Front',
  DOORS_FULL: 'Doors — Full',
  DOORS_SIDE: 'Doors — Side',
  HARDWARE: 'Hardware',
}

export default function QcPhotosPage() {
  const [activeStage, setActiveStage] = useState<Stage>('POST_MFG')
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [loadingScopes, setLoadingScopes] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusByScope, setStatusByScope] = useState<Record<string, ScopeStatus>>({})

  // ── Initial load: requirements + jobs + deliveries ────────────────
  const loadInitial = useCallback(async () => {
    setLoadingScopes(true)
    setError(null)
    try {
      // Pull jobs in active manufacturing/delivery statuses. We use a
      // generous window so the queue surfaces enough work; a real-world
      // Abel queue is typically a few dozen rows at a time.
      const [jobsRes, deliveriesRes] = await Promise.all([
        fetch('/api/ops/jobs?status=IN_PRODUCTION,STAGED,LOADED&limit=50').catch(() => null),
        fetch('/api/ops/deliveries?limit=50').catch(() => null),
      ])

      let nextJobs: JobRow[] = []
      let nextDeliveries: DeliveryRow[] = []

      if (jobsRes && jobsRes.ok) {
        const data = await jobsRes.json().catch(() => ({}))
        const list = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : []
        nextJobs = list.slice(0, 50).map((j: any) => ({
          id: j.id,
          jobNumber: j.jobNumber || null,
          builderName: j.builderName || null,
          jobAddress: j.jobAddress || null,
          community: j.community || null,
          status: j.status || null,
        }))
      }

      if (deliveriesRes && deliveriesRes.ok) {
        const data = await deliveriesRes.json().catch(() => ({}))
        const list = Array.isArray(data?.deliveries) ? data.deliveries : Array.isArray(data) ? data : []
        nextDeliveries = list.slice(0, 50).map((d: any) => ({
          id: d.id,
          scheduledDate: d.scheduledDate || d.deliveryDate || null,
          status: d.status || null,
          jobNumber: d.jobNumber || d.job?.jobNumber || null,
          jobAddress: d.jobAddress || d.job?.jobAddress || d.address || null,
          builderName: d.builderName || d.job?.builderName || null,
        }))
      }

      // We don't filter the full requirement catalog by stage here — the
      // GET /qc/photos endpoint returns it for us when we ask per-scope.
      // For the initial render we just need the catalog so we can paint
      // greyed-out placeholders before the per-scope statuses load.
      const reqRes = await fetch(
        `/api/ops/qc/photos?stage=POST_MFG&jobId=__bootstrap__`,
      ).catch(() => null)
      if (reqRes && reqRes.ok) {
        const data = await reqRes.json().catch(() => ({}))
        // The endpoint returns requirements for the requested stage; pull
        // the full catalog by also calling DELIVERY once.
        const postReqs: Requirement[] = data.requirements || []
        const delRes = await fetch(
          `/api/ops/qc/photos?stage=DELIVERY&deliveryId=__bootstrap__`,
        ).catch(() => null)
        const delReqs: Requirement[] = delRes && delRes.ok
          ? (await delRes.json().catch(() => ({}))).requirements || []
          : []
        setRequirements([...postReqs, ...delReqs])
      }

      setJobs(nextJobs)
      setDeliveries(nextDeliveries)
    } catch (e: any) {
      setError(e?.message || 'Failed to load QC photo queue')
    } finally {
      setLoadingScopes(false)
    }
  }, [])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  // ── Per-scope status fetch ────────────────────────────────────────
  const fetchScopeStatus = useCallback(
    async (stage: Stage, scopeId: string) => {
      setStatusByScope((prev) => ({
        ...prev,
        [scopeId]: { ...(prev[scopeId] || { scopeId, photos: [], uploaded: [], missing: [], complete: false }), loading: true },
      }))
      try {
        const idParam = stage === 'POST_MFG' ? 'jobId' : 'deliveryId'
        const res = await fetch(
          `/api/ops/qc/photos?stage=${stage}&${idParam}=${encodeURIComponent(scopeId)}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const stageStatus = data.stageStatus?.[stage] || { complete: false, missing: [], uploaded: [] }
        setStatusByScope((prev) => ({
          ...prev,
          [scopeId]: {
            scopeId,
            loading: false,
            uploaded: stageStatus.uploaded || [],
            missing: stageStatus.missing || [],
            complete: stageStatus.complete || false,
            photos: data.photos || [],
          },
        }))
      } catch (e: any) {
        setStatusByScope((prev) => ({
          ...prev,
          [scopeId]: {
            scopeId,
            loading: false,
            uploaded: [],
            missing: [],
            complete: false,
            photos: [],
          },
        }))
      }
    },
    [],
  )

  // Eagerly fetch status for every visible scope when the active tab changes
  useEffect(() => {
    const list = activeStage === 'POST_MFG' ? jobs : deliveries
    list.forEach((s) => {
      if (!statusByScope[s.id]) fetchScopeStatus(activeStage, s.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, jobs, deliveries])

  // Stage-specific required types pulled out of the catalog
  const requiredTypesForStage = useMemo(() => {
    return requirements
      .filter((r) => r.stage === activeStage && r.required)
      .map((r) => r.photoType)
  }, [requirements, activeStage])

  return (
    <div className="container mx-auto px-4 py-6">
      <PageHeader
        eyebrow="Quality Control"
        title="QC Photo Queue"
        description="Structured photo requirements for post-manufacturing (per door) and delivery (per load). A stage is complete only when every required photo is uploaded."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'QC', href: '/ops/manufacturing/qc' },
          { label: 'Photos' },
        ]}
      />

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-1">
          {(['POST_MFG', 'DELIVERY'] as Stage[]).map((s) => {
            const active = s === activeStage
            const Icon = s === 'POST_MFG' ? Factory : Truck
            return (
              <button
                key={s}
                type="button"
                onClick={() => setActiveStage(s)}
                className={[
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                  active
                    ? 'border-brand text-brand'
                    : 'border-transparent text-fg-muted hover:text-fg hover:border-border',
                ].join(' ')}
              >
                <Icon className="w-4 h-4" />
                {STAGE_LABEL[s]}
                <span className="ml-1 text-xs text-fg-subtle">
                  ({s === 'POST_MFG' ? jobs.length : deliveries.length})
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-md bg-data-negative-bg text-sm text-data-negative">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loadingScopes ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
        </div>
      ) : activeStage === 'POST_MFG' ? (
        <ScopeList
          stage="POST_MFG"
          scopes={jobs.map((j) => ({
            id: j.id,
            primary: j.jobNumber || j.id,
            secondary: [j.builderName, j.jobAddress, j.community].filter(Boolean).join(' · '),
            badge: j.status,
          }))}
          requiredTypes={requiredTypesForStage}
          statusByScope={statusByScope}
          onUploaded={(scopeId) => fetchScopeStatus('POST_MFG', scopeId)}
        />
      ) : (
        <ScopeList
          stage="DELIVERY"
          scopes={deliveries.map((d) => ({
            id: d.id,
            primary: d.jobNumber ? `Delivery — ${d.jobNumber}` : `Delivery ${d.id.slice(0, 8)}`,
            secondary: [
              d.builderName,
              d.jobAddress,
              d.scheduledDate ? new Date(d.scheduledDate).toLocaleDateString() : null,
            ]
              .filter(Boolean)
              .join(' · '),
            badge: d.status,
          }))}
          requiredTypes={requiredTypesForStage}
          statusByScope={statusByScope}
          onUploaded={(scopeId) => fetchScopeStatus('DELIVERY', scopeId)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// ScopeList — renders one row per job / delivery in the active tab
// ──────────────────────────────────────────────────────────────────
interface ScopeRow {
  id: string
  primary: string
  secondary: string
  badge: string | null
}

function ScopeList({
  stage,
  scopes,
  requiredTypes,
  statusByScope,
  onUploaded,
}: {
  stage: Stage
  scopes: ScopeRow[]
  requiredTypes: string[]
  statusByScope: Record<string, ScopeStatus>
  onUploaded: (scopeId: string) => void
}) {
  if (scopes.length === 0) {
    return (
      <div className="text-sm text-fg-subtle italic py-8 text-center">
        Nothing in the queue right now.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {scopes.map((scope) => (
        <ScopeCard
          key={scope.id}
          scope={scope}
          stage={stage}
          requiredTypes={requiredTypes}
          status={statusByScope[scope.id]}
          onUploaded={() => onUploaded(scope.id)}
        />
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// ScopeCard — one job / delivery with its photoType checklist
// ──────────────────────────────────────────────────────────────────
function ScopeCard({
  scope,
  stage,
  requiredTypes,
  status,
  onUploaded,
}: {
  scope: ScopeRow
  stage: Stage
  requiredTypes: string[]
  status: ScopeStatus | undefined
  onUploaded: () => void
}) {
  const uploaded = status?.uploaded || []
  const complete = status?.complete || false
  const loading = status?.loading || false

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg truncate">{scope.primary}</h3>
            {scope.badge && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-surface-muted text-fg-muted">
                {scope.badge}
              </span>
            )}
          </div>
          {scope.secondary && (
            <p className="text-xs text-fg-muted truncate mt-0.5">{scope.secondary}</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {loading ? (
            <Loader2 className="w-4 h-4 text-fg-muted animate-spin" />
          ) : complete ? (
            <span className="flex items-center gap-1 text-xs font-medium text-data-positive">
              <CheckCircle2 className="w-4 h-4" /> Complete
            </span>
          ) : (
            <span className="text-xs text-fg-muted">
              {uploaded.length}/{requiredTypes.length} uploaded
            </span>
          )}
        </div>
      </div>

      {/* Per-photoType checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {requiredTypes.map((pt) => {
          const isUploaded = uploaded.includes(pt)
          return (
            <PhotoTypeRow
              key={pt}
              stage={stage}
              scope={scope}
              photoType={pt}
              uploaded={isUploaded}
              onUploaded={onUploaded}
            />
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// PhotoTypeRow — one photoType with upload button. Two-step flow:
//   1. Upload file to /api/ops/documents/vault (multipart) — returns
//      a DocumentVault id.
//   2. POST /api/ops/qc/photos with the vault id to create the link.
// ──────────────────────────────────────────────────────────────────
function PhotoTypeRow({
  stage,
  scope,
  photoType,
  uploaded,
  onUploaded,
}: {
  stage: Stage
  scope: ScopeRow
  photoType: string
  uploaded: boolean
  onUploaded: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      // Step 1: upload to DocumentVault
      const fd = new FormData()
      fd.append('files', file)
      fd.append('category', 'PHOTO')
      // Tag the vault row to whichever scope FK is appropriate so it shows
      // up under that entity's docs too.
      if (stage === 'POST_MFG') {
        fd.append('jobId', scope.id)
      } else {
        // DocumentVault has no deliveryId column; use the generic
        // entityType/entityId fallback that the vault POST supports.
        fd.append('entityType', 'delivery')
        fd.append('entityId', scope.id)
      }

      const upRes = await fetch('/api/ops/documents/vault', { method: 'POST', body: fd })
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => ({}))
        throw new Error(body.error || `Upload failed (HTTP ${upRes.status})`)
      }
      const upData = await upRes.json()
      const vaultId = upData.uploaded?.[0]?.id
      if (!vaultId) {
        throw new Error(upData.errors?.[0] || 'Vault returned no document id')
      }

      // Step 2: link to QcPhoto
      const linkBody: Record<string, string> = {
        stage,
        photoType,
        documentVaultId: vaultId,
      }
      if (stage === 'POST_MFG') linkBody.jobId = scope.id
      else linkBody.deliveryId = scope.id

      const linkRes = await fetch('/api/ops/qc/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(linkBody),
      })
      if (!linkRes.ok) {
        const body = await linkRes.json().catch(() => ({}))
        throw new Error(body.error || `Link failed (HTTP ${linkRes.status})`)
      }

      onUploaded()
    } catch (e: any) {
      setErr(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={[
        'flex items-center gap-2 px-3 py-2 rounded-md border',
        uploaded
          ? 'bg-data-positive-bg/30 border-data-positive/30'
          : 'bg-surface-muted border-border',
      ].join(' ')}
    >
      {uploaded ? (
        <CheckCircle2 className="w-4 h-4 text-data-positive shrink-0" />
      ) : (
        <Circle className="w-4 h-4 text-fg-subtle shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-fg truncate">
          {PHOTO_TYPE_LABEL[photoType] || photoType}
        </div>
        {err && <div className="text-[11px] text-data-negative truncate">{err}</div>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePick}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-surface text-fg hover:bg-surface-elevated border border-border disabled:opacity-50"
        title={uploaded ? 'Add another photo' : 'Upload photo'}
      >
        {busy ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : uploaded ? (
          <Camera className="w-3 h-3" />
        ) : (
          <Upload className="w-3 h-3" />
        )}
        {uploaded ? 'Add' : 'Upload'}
      </button>
    </div>
  )
}
