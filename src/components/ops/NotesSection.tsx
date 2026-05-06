'use client'

/**
 * <NotesSection> — reusable timestamped activity log of free-text notes
 * pinned to any entity (Order, Job, Builder, Invoice, PurchaseOrder, …).
 *
 * Per B-UX-7 (2026-05-05). Backed by the new /api/ops/notes route, which
 * persists rows to the generic `Note` Prisma model.
 *
 *   <NotesSection entityType="invoice" entityId={invoice.id} />
 *   <NotesSection entityType="job"     entityId={jobId} title="Job Notes" />
 *
 * Distinct from any single-string `notes` column on the entity itself —
 * those remain a one-shot summary field. This component is the running log
 * of who-said-what-and-when.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, MessageSquarePlus, StickyNote } from 'lucide-react'

// ── Type model ────────────────────────────────────────────────────────
export type NoteEntityType =
  | 'order'
  | 'job'
  | 'builder'
  | 'invoice'
  | 'purchaseOrder'
  | 'quote'
  | 'delivery'

interface NoteRow {
  id: string
  entityType: string
  entityId: string
  body: string
  authorStaffId: string | null
  authorName: string | null
  createdAt: string
}

export interface NotesSectionProps {
  entityType: NoteEntityType
  entityId: string
  title?: string
  className?: string
}

// ── Helpers ───────────────────────────────────────────────────────────
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── Component ─────────────────────────────────────────────────────────
export default function NotesSection({
  entityType,
  entityId,
  title = 'Notes',
  className,
}: NotesSectionProps) {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reload = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ entityType, entityId }).toString()
      const res = await fetch(`/api/ops/notes?${qs}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setNotes(Array.isArray(data.notes) ? data.notes : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => {
    reload()
  }, [reload])

  const submit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault()
      const body = draft.trim()
      if (!body || submitting) return
      setSubmitting(true)
      setError(null)
      try {
        const res = await fetch('/api/ops/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, entityId, body }),
        })
        if (!res.ok) {
          const r = await res.json().catch(() => ({}))
          throw new Error(r.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        // Optimistic-ish: prepend the server's authoritative row.
        if (data?.note) {
          setNotes((prev) => [data.note, ...prev])
        } else {
          await reload()
        }
        setDraft('')
      } catch (err: any) {
        setError(err?.message || 'Failed to add note')
      } finally {
        setSubmitting(false)
      }
    },
    [draft, submitting, entityType, entityId, reload],
  )

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <StickyNote className="w-4 h-4 text-fg-muted" />
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {!loading && (
          <span className="text-xs text-fg-subtle">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
        )}
      </div>

      {/* Compose */}
      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          maxLength={10_000}
          disabled={submitting}
          className="w-full text-sm rounded-md border border-border bg-surface px-3 py-2 placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand resize-y"
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter submits — common pattern in the rest of the app.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-fg-subtle">
            Cmd/Ctrl + Enter to post
          </span>
          <button
            type="submit"
            disabled={!draft.trim() || submitting}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MessageSquarePlus className="w-3.5 h-3.5" />
            )}
            {submitting ? 'Posting…' : 'Add note'}
          </button>
        </div>
      </form>

      {/* Error banner — shown for both load + post failures */}
      {error && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-md bg-data-negative-bg text-xs text-data-negative">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      <div className="mt-4">
        {loading ? (
          <div className="text-xs text-fg-muted px-3 py-4">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-fg-subtle px-3 py-4 text-center italic">
            No notes yet. Be the first.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((n) => (
              <li key={n.id} className="py-3">
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-xs font-medium text-fg">
                    {n.authorName || 'System'}
                  </span>
                  <span
                    className="text-[11px] text-fg-subtle tabular-nums"
                    title={new Date(n.createdAt).toISOString()}
                  >
                    {formatTimestamp(n.createdAt)}
                  </span>
                </div>
                <div className="text-sm text-fg whitespace-pre-wrap break-words">
                  {n.body}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
