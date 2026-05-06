// /admin/review-queue — Single review queue UI for enrichment + pitch + bounce items.
//
// Tabs: All Pending | Enrichment | Pitch | Bounce
//
// Each item card shows:
//   - entityType badge
//   - summary line + reason
//   - createdAt
//   - "Open" button (deep-link to source entity)
//   - "Approve" / "Reject" with optional note input
//
// Approval mutates the linked entity per CLAUDE.md hard rule (only ADMIN can act).
// READ-only visibility for SALES_REP — they can see what's queued but the
// approve/reject API enforces ADMIN.

'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  Mail,
  Clock,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface ReviewItem {
  id: string
  entityType: string
  entityId: string
  reason: string
  summary: string | null
  suggestedAction: any
  status: string
  reviewedBy: string | null
  reviewedAt: string | null
  notes: string | null
  createdAt: string
  expiresAt: string | null
  prospectCompanyName?: string | null
  prospectIcpTier?: string | null
  prospectConfidence?: string | null
  pitchStyle?: string | null
  pitchLayout?: string | null
  pitchStatus?: string | null
}

interface ReviewQueueResponse {
  items: ReviewItem[]
  total: number
  counts: Record<string, number>
}

type TabKey = 'ALL' | 'PROSPECT_ENRICHMENT' | 'PITCH_RUN' | 'BOUNCE_RECHECK'

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'ALL', label: 'All pending', icon: <Clock className="w-3.5 h-3.5" /> },
  { key: 'PROSPECT_ENRICHMENT', label: 'Enrichment', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: 'PITCH_RUN', label: 'Pitch', icon: <Mail className="w-3.5 h-3.5" /> },
  { key: 'BOUNCE_RECHECK', label: 'Bounce', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
]

const ENTITY_LABELS: Record<string, string> = {
  PROSPECT_ENRICHMENT: 'Enrichment',
  PITCH_RUN: 'Pitch',
  EMAIL_SEND: 'Email send',
  BOUNCE_RECHECK: 'Bounce recheck',
}

const ENTITY_TONES: Record<string, string> = {
  PROSPECT_ENRICHMENT: 'bg-signal/15 text-fg border border-c1/40',
  PITCH_RUN: 'bg-data-info-bg text-data-info-fg',
  EMAIL_SEND: 'bg-data-warning-bg text-data-warning-fg',
  BOUNCE_RECHECK: 'bg-data-negative-bg text-data-negative-fg',
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

function deepLinkFor(item: ReviewItem): string {
  switch (item.entityType) {
    case 'PROSPECT_ENRICHMENT':
    case 'BOUNCE_RECHECK':
      return `/admin/prospects/${item.entityId}`
    case 'PITCH_RUN':
      // Detail of the prospect; the run shows in the right column.
      // If we don't have prospect context we fall back to the prospects list.
      return `/admin/prospects/${item.entityId}`
    default:
      return '/admin/review-queue'
  }
}

export default function ReviewQueuePage() {
  const [activeTab, setActiveTab] = useState<TabKey>('ALL')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actingId, setActingId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (activeTab !== 'ALL') params.set('type', activeTab)
      params.set('status', 'PENDING')
      params.set('limit', '100')

      const res = await fetch(`/api/admin/review-queue?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ReviewQueueResponse = await res.json()
      setItems(data.items || [])
      setCounts(data.counts || {})
      setTotal(data.total || 0)
    } catch (err: any) {
      setError(err?.message || 'Failed to load review queue')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    load()
  }, [load])

  async function handleAction(id: string, action: 'approve' | 'reject') {
    setActingId(id)
    try {
      const res = await fetch(`/api/admin/review-queue/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          notes: noteDraft[id] || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast(`Item ${action === 'approve' ? 'approved' : 'rejected'}`, 'success')
      // Optimistic remove from list.
      setItems((prev) => prev.filter((i) => i.id !== id))
      setCounts((prev) => {
        const t = { ...prev }
        const item = items.find((x) => x.id === id)
        if (item && t[item.entityType] && t[item.entityType] > 0) {
          t[item.entityType] = t[item.entityType] - 1
        }
        return t
      })
      setNoteDraft((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (err: any) {
      showToast(err?.message || `${action} failed`, 'error')
    } finally {
      setActingId(null)
    }
  }

  const totalPending = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-fg">Review queue</h1>
        <p className="text-fg-muted mt-2 text-sm">
          {totalPending} pending · enrichment, pitch, and bounce items awaiting human review
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-glass-border">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          const count = tab.key === 'ALL' ? totalPending : counts[tab.key] || 0
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                isActive
                  ? 'border-c1 text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              {tab.icon}
              {tab.label}
              <span
                className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  isActive ? 'bg-signal/15 text-fg' : 'bg-surface-muted text-fg-muted'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
        <button
          onClick={() => load()}
          disabled={loading}
          className="ml-auto px-3 py-1.5 text-xs font-medium bg-canvas border border-glass-border rounded hover:bg-white/5 text-fg flex items-center gap-1.5 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="panel p-4 border border-data-negative bg-data-negative-bg text-data-negative-fg text-sm">
          {error}
        </div>
      )}

      {/* Items */}
      {loading && items.length === 0 ? (
        <div className="text-fg-muted py-16 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="panel p-12 border border-dashed border-glass-border text-center text-fg-subtle">
          <Sparkles className="w-6 h-6 mx-auto mb-2 text-fg-subtle" />
          <div className="text-sm">No pending items in this view.</div>
          <div className="text-xs mt-1">
            Items land here automatically when enrichment confidence drops or a pitch is ready.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              note={noteDraft[item.id] || ''}
              onNoteChange={(v) => setNoteDraft((prev) => ({ ...prev, [item.id]: v }))}
              onApprove={() => handleAction(item.id, 'approve')}
              onReject={() => handleAction(item.id, 'reject')}
              acting={actingId === item.id}
            />
          ))}
        </div>
      )}

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

function ReviewCard({
  item,
  note,
  onNoteChange,
  onApprove,
  onReject,
  acting,
}: {
  item: ReviewItem
  note: string
  onNoteChange: (v: string) => void
  onApprove: () => void
  onReject: () => void
  acting: boolean
}) {
  const entityLabel = ENTITY_LABELS[item.entityType] || item.entityType
  const entityTone = ENTITY_TONES[item.entityType] || 'bg-surface-muted text-fg-muted'
  const target = deepLinkFor(item)

  // Compose a recognizable headline.
  const headline = item.prospectCompanyName
    ? item.prospectCompanyName
    : item.summary || item.entityId

  const subtitle = (() => {
    if (item.entityType === 'PITCH_RUN' && item.pitchStyle && item.pitchLayout) {
      return `${item.pitchStyle} · ${item.pitchLayout}${
        item.pitchStatus ? ' · ' + item.pitchStatus : ''
      }`
    }
    if (item.prospectConfidence) {
      return `Confidence: ${item.prospectConfidence}${
        item.prospectIcpTier ? ' · ' + item.prospectIcpTier : ''
      }`
    }
    return null
  })()

  return (
    <div className="panel border border-glass-border p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${entityTone}`}>
              {entityLabel}
            </span>
            <span className="text-[11px] text-fg-subtle">
              {fmtRelative(item.createdAt)}
            </span>
            {item.expiresAt && (
              <span className="text-[11px] text-data-warning-fg">
                expires {fmtRelative(item.expiresAt)}
              </span>
            )}
          </div>
          <div className="text-base font-semibold text-fg truncate">
            {headline}
          </div>
          {subtitle && (
            <div className="text-xs text-fg-muted">{subtitle}</div>
          )}
          {item.summary && item.summary !== headline && (
            <div className="text-sm text-fg-muted">{item.summary}</div>
          )}
          <div className="text-xs text-fg-subtle">
            <span className="font-semibold text-fg-muted">Reason:</span> {item.reason}
          </div>
        </div>
        <Link
          href={target}
          className="px-3 py-1.5 text-xs font-medium bg-canvas border border-glass-border rounded hover:bg-white/5 text-fg flex items-center gap-1.5 transition flex-shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </Link>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label className="text-[10px] uppercase tracking-wide text-fg-muted block mb-1">
            Reviewer note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Add a short note for the audit log…"
            className="w-full bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-c1"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={onReject}
            disabled={acting}
            className="px-3 py-2 text-sm font-medium bg-canvas border border-data-negative/40 rounded hover:bg-data-negative-bg text-data-negative-fg flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            Reject
          </button>
          <button
            onClick={onApprove}
            disabled={acting}
            className="px-3 py-2 text-sm font-medium bg-data-positive text-white rounded hover:opacity-90 flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
