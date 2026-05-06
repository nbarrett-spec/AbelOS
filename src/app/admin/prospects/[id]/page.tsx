// /admin/prospects/[id] — full detail view for a single Prospect.
//
// Sections:
//   - Header: company, city, ICP tier, status
//   - Enrichment: domain, founder, email, pattern, confidence, source URLs,
//                 last run, "Re-enrich now", manual override form
//   - Pitch Context: editable form (targetPlans, currentVendor, dealStage,
//                    estBuildVolume, positioningNotes)
//   - Pitch Runs: list of past PitchRun rows with previews + statuses
//   - Audit history: last 20 events on this Prospect
//
// Pages are READ + light edit only — re-enrich button posts to Agent A's
// /api/admin/prospects/[id]/enrich endpoint. Approvals live in /admin/review-queue.

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  RefreshCw,
  Sparkles,
  ExternalLink,
  Save,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Globe,
  User,
  Phone,
  Activity,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface Prospect {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string
  domain: string | null
  founderName: string | null
  emailPattern: string | null
  enrichmentRunAt: string | null
  enrichmentConfidence: string | null
  enrichmentSourceUrls: string[] | null
  bouncedAt: string | null
  icpTier: string | null
  estimatedAnnualVolume: number | null
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface PitchContext {
  id: string
  prospectId: string
  targetPlans: any
  currentVendor: string | null
  estBuildVolume: number | null
  dealStage: string | null
  positioningNotes: string | null
  lastTouchedAt: string | null
  lastTouchedBy: string | null
}

interface PitchRun {
  id: string
  style: string
  layout: string
  elements: string[]
  status: string
  previewUrl: string | null
  emailDraft: string | null
  errorMessage: string | null
  costEstimate: number | null
  generatedBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  sentAt: string | null
  createdAt: string
}

interface AuditEntry {
  id: string
  action: string
  entity: string
  entityId: string | null
  staffId: string | null
  details: any
  severity: string | null
  createdAt: string
}

interface DetailResponse {
  prospect: Prospect
  pitchContext: PitchContext | null
  pitchRuns: PitchRun[]
  auditHistory: AuditEntry[]
}

const DEAL_STAGES = [
  'COLD',
  'INTRO_SENT',
  'IN_DISCUSSION',
  'PROPOSAL',
  'WON',
  'LOST',
] as const

const CONFIDENCE_TONES: Record<string, string> = {
  CONFIRMED: 'bg-data-positive-bg text-data-positive-fg',
  LIKELY: 'bg-data-warning-bg text-data-warning-fg',
  UNVERIFIED: 'bg-data-negative-bg text-data-negative-fg',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    if (diffMin < 1440 * 7) return `${Math.floor(diffMin / 1440)}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso
  }
}

export default function ProspectDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const featureEnabled =
    process.env.NEXT_PUBLIC_FEATURE_PROSPECT_ENRICH_ENABLED !== 'false'

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [enriching, setEnriching] = useState(false)
  const [savingContact, setSavingContact] = useState(false)
  const [savingContext, setSavingContext] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  // contact override form
  const [overrideEmail, setOverrideEmail] = useState('')
  const [overridePhone, setOverridePhone] = useState('')
  const [overrideFounder, setOverrideFounder] = useState('')

  // pitch context form
  const [ctxVendor, setCtxVendor] = useState('')
  const [ctxVolume, setCtxVolume] = useState('')
  const [ctxStage, setCtxStage] = useState<string>('COLD')
  const [ctxNotes, setCtxNotes] = useState('')
  const [ctxPlansJson, setCtxPlansJson] = useState('')
  const [plansJsonError, setPlansJsonError] = useState('')

  const showToast = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/prospects/${id}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Prospect not found')
        throw new Error(`HTTP ${res.status}`)
      }
      const j: DetailResponse = await res.json()
      setData(j)
      // Hydrate forms.
      setOverrideEmail(j.prospect.email || '')
      setOverridePhone(j.prospect.phone || '')
      setOverrideFounder(j.prospect.founderName || '')
      const ctx = j.pitchContext
      setCtxVendor(ctx?.currentVendor || '')
      setCtxVolume(ctx?.estBuildVolume != null ? String(ctx.estBuildVolume) : '')
      setCtxStage(ctx?.dealStage || 'COLD')
      setCtxNotes(ctx?.positioningNotes || '')
      setCtxPlansJson(
        ctx?.targetPlans ? JSON.stringify(ctx.targetPlans, null, 2) : ''
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to load prospect')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id && featureEnabled) load()
  }, [id, featureEnabled, load])

  async function handleReenrich() {
    setEnriching(true)
    try {
      const res = await fetch(`/api/admin/prospects/${id}/enrich`, {
        method: 'POST',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast('Re-enrichment queued', 'success')
      setTimeout(() => load(), 1500)
    } catch (err: any) {
      showToast(err?.message || 'Re-enrich failed', 'error')
    } finally {
      setEnriching(false)
    }
  }

  async function handleSaveContact() {
    setSavingContact(true)
    try {
      const res = await fetch(`/api/admin/prospects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactOverride: {
            email: overrideEmail.trim() || null,
            phone: overridePhone.trim() || null,
            founderName: overrideFounder.trim() || null,
          },
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast('Contact updated', 'success')
      load()
    } catch (err: any) {
      showToast(err?.message || 'Save failed', 'error')
    } finally {
      setSavingContact(false)
    }
  }

  async function handleSaveContext() {
    // Validate JSON before sending.
    setPlansJsonError('')
    let parsedPlans: unknown = undefined
    if (ctxPlansJson.trim()) {
      try {
        parsedPlans = JSON.parse(ctxPlansJson)
      } catch (e: any) {
        setPlansJsonError('Invalid JSON: ' + (e?.message || 'parse error'))
        return
      }
    }

    setSavingContext(true)
    try {
      const res = await fetch(`/api/admin/prospects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitchContext: {
            targetPlans: parsedPlans,
            currentVendor: ctxVendor.trim() || null,
            estBuildVolume: ctxVolume.trim() ? Number(ctxVolume) : null,
            dealStage: ctxStage,
            positioningNotes: ctxNotes.trim() || null,
          },
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast('Pitch context saved', 'success')
      load()
    } catch (err: any) {
      showToast(err?.message || 'Save failed', 'error')
    } finally {
      setSavingContext(false)
    }
  }

  if (!featureEnabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-fg">Prospect detail</h1>
        <div className="panel p-6 border border-glass-border bg-surface-muted text-fg-muted text-sm">
          Builder enrichment is currently disabled.
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return <div className="text-fg-muted py-12 text-center">Loading…</div>
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/prospects"
          className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to prospects
        </Link>
        <div className="panel p-6 border border-data-negative bg-data-negative-bg text-data-negative-fg text-sm">
          {error || 'Prospect not found'}
        </div>
      </div>
    )
  }

  const { prospect, pitchContext, pitchRuns, auditHistory } = data
  const confidenceCls =
    CONFIDENCE_TONES[prospect.enrichmentConfidence || ''] ||
    'bg-surface-muted text-fg-muted'

  return (
    <div className="space-y-6">
      {/* Crumb / back */}
      <Link
        href="/admin/prospects"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition"
      >
        <ArrowLeft className="w-4 h-4" />
        All prospects
      </Link>

      {/* Header */}
      <div className="panel border border-glass-border bg-surface-muted/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-fg-muted">
              Prospect
            </div>
            <h1 className="text-3xl font-bold text-fg">{prospect.companyName}</h1>
            <div className="text-fg-muted text-sm">
              {[
                prospect.city ? `${prospect.city}${prospect.state ? ', ' + prospect.state : ''}` : null,
                prospect.domain,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {prospect.icpTier && (
              <span className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wide bg-signal/15 text-fg border border-c1/40">
                {prospect.icpTier}
              </span>
            )}
            <span className={`inline-flex items-center px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wide ${confidenceCls}`}>
              {prospect.enrichmentConfidence || 'Not enriched'}
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wide bg-canvas border border-glass-border text-fg-muted">
              {prospect.status}
            </span>
            {prospect.bouncedAt && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wide bg-data-negative-bg text-data-negative-fg">
                <AlertTriangle className="w-3 h-3" />
                Email bounced
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: enrichment + pitch context */}
        <div className="lg:col-span-2 space-y-6">
          {/* Enrichment */}
          <section className="panel border border-glass-border p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-fg-muted">
                  Enrichment
                </div>
                <h2 className="text-lg font-semibold text-fg flex items-center gap-2 mt-1">
                  <Sparkles className="w-4 h-4 text-c1" />
                  Research findings
                </h2>
                <p className="text-xs text-fg-muted mt-1">
                  Last run: {fmtRelative(prospect.enrichmentRunAt)}
                </p>
              </div>
              <button
                onClick={handleReenrich}
                disabled={enriching}
                className="px-3 py-2 text-sm font-medium bg-signal/15 border border-c1/40 rounded hover:bg-signal/25 text-fg flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${enriching ? 'animate-spin' : ''}`} />
                {enriching ? 'Queuing…' : 'Re-enrich now'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <KV
                icon={<Globe className="w-3.5 h-3.5" />}
                label="Domain"
                value={prospect.domain}
                mono
              />
              <KV
                icon={<User className="w-3.5 h-3.5" />}
                label="Founder"
                value={prospect.founderName}
              />
              <KV
                icon={<Mail className="w-3.5 h-3.5" />}
                label="Email"
                value={prospect.email}
                mono
              />
              <KV label="Pattern" value={prospect.emailPattern} mono />
              <KV
                icon={<Phone className="w-3.5 h-3.5" />}
                label="Phone"
                value={prospect.phone}
                mono
              />
              <KV
                label="Volume est."
                value={
                  prospect.estimatedAnnualVolume != null
                    ? `${prospect.estimatedAnnualVolume.toLocaleString()} homes/yr`
                    : null
                }
              />
            </div>

            {prospect.enrichmentSourceUrls && prospect.enrichmentSourceUrls.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-fg-muted mb-2">
                  Source URLs
                </div>
                <ul className="space-y-1.5">
                  {prospect.enrichmentSourceUrls.map((u, i) => (
                    <li key={`${u}-${i}`} className="text-xs flex items-center gap-1.5">
                      <ExternalLink className="w-3 h-3 text-fg-subtle flex-shrink-0" />
                      <a
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-c1 hover:underline truncate"
                      >
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Manual override */}
            <div className="border-t border-glass-border pt-5 space-y-3">
              <div className="text-[11px] uppercase tracking-wide text-fg-muted">
                Manual override
              </div>
              <p className="text-xs text-fg-muted">
                Edits here replace the enrichment values. Changing email clears the bounce flag.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Email">
                  <input
                    type="email"
                    value={overrideEmail}
                    onChange={(e) => setOverrideEmail(e.target.value)}
                    className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="text"
                    value={overridePhone}
                    onChange={(e) => setOverridePhone(e.target.value)}
                    className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
                  />
                </Field>
                <Field label="Founder name">
                  <input
                    type="text"
                    value={overrideFounder}
                    onChange={(e) => setOverrideFounder(e.target.value)}
                    className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveContact}
                  disabled={savingContact}
                  className="px-3 py-2 text-sm font-medium bg-c1 text-canvas rounded hover:opacity-90 flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingContact ? 'Saving…' : 'Save contact'}
                </button>
              </div>
            </div>
          </section>

          {/* Pitch Context */}
          <section className="panel border border-glass-border p-6 space-y-5">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-fg-muted">
                Pitch context
              </div>
              <h2 className="text-lg font-semibold text-fg mt-1">
                Sales positioning inputs
              </h2>
              <p className="text-xs text-fg-muted mt-1">
                Fed verbatim into the pitch generator. Last touched:{' '}
                {pitchContext?.lastTouchedAt
                  ? fmtRelative(pitchContext.lastTouchedAt)
                  : 'never'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Current vendor (replacing)">
                <input
                  type="text"
                  value={ctxVendor}
                  onChange={(e) => setCtxVendor(e.target.value)}
                  placeholder="e.g. 84 Lumber"
                  className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
                />
              </Field>
              <Field label="Est. build volume (homes/yr)">
                <input
                  type="number"
                  value={ctxVolume}
                  onChange={(e) => setCtxVolume(e.target.value)}
                  className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
                />
              </Field>
              <Field label="Deal stage">
                <select
                  value={ctxStage}
                  onChange={(e) => setCtxStage(e.target.value)}
                  className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
                >
                  {DEAL_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Positioning notes (free-form)">
              <textarea
                value={ctxNotes}
                onChange={(e) => setCtxNotes(e.target.value)}
                rows={4}
                placeholder="What's the angle? What does the builder care about? Any landmines?"
                className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
              />
            </Field>

            <Field label="Target plans (JSON array — [{planName, sqFt, materialBudget, priorityRank}])">
              <textarea
                value={ctxPlansJson}
                onChange={(e) => {
                  setCtxPlansJson(e.target.value)
                  setPlansJsonError('')
                }}
                rows={6}
                placeholder='[{"planName":"The Maple","sqFt":2400,"materialBudget":18500,"priorityRank":1}]'
                className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-c1"
              />
              {plansJsonError && (
                <div className="text-xs text-data-negative-fg mt-1">
                  {plansJsonError}
                </div>
              )}
            </Field>

            <div className="flex justify-end">
              <button
                onClick={handleSaveContext}
                disabled={savingContext}
                className="px-3 py-2 text-sm font-medium bg-c1 text-canvas rounded hover:opacity-90 flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {savingContext ? 'Saving…' : 'Save context'}
              </button>
            </div>
          </section>
        </div>

        {/* Right column: pitch runs + audit */}
        <div className="space-y-6">
          {/* Pitch runs */}
          <section className="panel border border-glass-border p-6">
            <div className="text-[11px] uppercase tracking-wide text-fg-muted">
              Pitch runs
            </div>
            <h2 className="text-lg font-semibold text-fg mt-1 mb-4">
              {pitchRuns.length} generation{pitchRuns.length === 1 ? '' : 's'}
            </h2>
            {pitchRuns.length === 0 ? (
              <div className="text-sm text-fg-subtle py-6 text-center border border-dashed border-glass-border rounded">
                No pitches generated yet.
              </div>
            ) : (
              <ul className="space-y-3">
                {pitchRuns.map((run) => (
                  <PitchRunCard key={run.id} run={run} />
                ))}
              </ul>
            )}
          </section>

          {/* Audit history */}
          <section className="panel border border-glass-border p-6">
            <div className="text-[11px] uppercase tracking-wide text-fg-muted">
              Audit history
            </div>
            <h2 className="text-lg font-semibold text-fg mt-1 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Recent events
            </h2>
            {auditHistory.length === 0 ? (
              <div className="text-sm text-fg-subtle py-6 text-center border border-dashed border-glass-border rounded">
                No audit events yet.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {auditHistory.map((a) => {
                  const staffName =
                    (a.details && typeof a.details === 'object' && a.details.staffName) ||
                    a.staffId ||
                    'system'
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-2.5 text-xs border-b border-glass-border/60 pb-2.5 last:border-0 last:pb-0"
                    >
                      <span
                        className={`inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${
                          a.severity === 'CRITICAL'
                            ? 'bg-data-negative-bg text-data-negative-fg'
                            : a.severity === 'WARN'
                            ? 'bg-data-warning-bg text-data-warning-fg'
                            : 'bg-surface-muted text-fg-muted'
                        }`}
                      >
                        {a.action}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-fg truncate">{staffName}</div>
                        <div className="text-fg-subtle text-[10px]">
                          {fmtDate(a.createdAt)}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 ${
              toast.tone === 'success'
                ? 'bg-data-positive text-white'
                : 'bg-data-negative text-white'
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function KV({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted flex items-center gap-1 mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-fg ${mono ? 'font-mono text-xs' : 'text-sm'}`}>
        {value || <span className="text-fg-subtle">—</span>}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted mb-1.5">
        {label}
      </div>
      {children}
    </label>
  )
}

const STATUS_TONES: Record<string, string> = {
  QUEUED: 'bg-surface-muted text-fg-muted',
  GENERATING: 'bg-data-info-bg text-data-info-fg',
  PREVIEW: 'bg-signal/15 text-fg border border-c1/40',
  APPROVED: 'bg-data-positive-bg text-data-positive-fg',
  SENT: 'bg-data-positive-bg text-data-positive-fg',
  FAILED: 'bg-data-negative-bg text-data-negative-fg',
}

function PitchRunCard({ run }: { run: PitchRun }) {
  const cls = STATUS_TONES[run.status] || 'bg-surface-muted text-fg-muted'
  return (
    <li className="border border-glass-border rounded p-3 hover:bg-white/5 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-fg uppercase tracking-wide">
              {run.style}
            </span>
            <span className="text-fg-subtle">·</span>
            <span className="text-fg-muted">{run.layout}</span>
          </div>
          <div className="text-[10px] text-fg-subtle">
            {fmtRelative(run.createdAt)}
            {run.elements?.length > 0 && ` · ${run.elements.length} elements`}
          </div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
          {run.status}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        {run.previewUrl && (
          <a
            href={run.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-c1 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            Preview
          </a>
        )}
        {run.approvedAt && (
          <span className="text-[10px] text-fg-subtle inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-data-positive-fg" />
            Approved {fmtRelative(run.approvedAt)}
          </span>
        )}
        {run.errorMessage && (
          <span
            className="text-[10px] text-data-negative-fg truncate"
            title={run.errorMessage}
          >
            {run.errorMessage}
          </span>
        )}
      </div>
    </li>
  )
}
