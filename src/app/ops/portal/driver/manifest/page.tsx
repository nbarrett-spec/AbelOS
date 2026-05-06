'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { Truck, Printer } from 'lucide-react'
import SignaturePad, { type SignaturePadHandle } from '@/components/SignaturePad'
import DocumentAttachments from '@/components/ops/DocumentAttachments'
import { Badge } from '@/components/ui'
import EmptyState from '@/components/ui/EmptyState'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { enqueueCompletion, flushQueue, queueCount } from '../ServiceWorker'

// ──────────────────────────────────────────────────────────────────────────
// Driver Manifest — in-cab route view (audit item A-UX-2)
//
// Was a stub redirect to the print-only /ops/delivery/manifest page. Drivers
// were getting a clipboard print but no usable digital manifest. This page
// is the digital companion: route list ordered by routeOrder, per-stop
// action buttons (Arrived / Delivered / Refused / Skipped), in-place
// signature capture, proof-of-delivery photo upload via DocumentAttachments
// (entityType=job), and a Print button that opens the print-friendly
// /ops/delivery/manifest in a new tab for paper backup.
//
// Mobile-first. Uses the same look-and-feel tokens as the rest of the
// driver portal — dark canvas, oversized tap targets, sticky header. Pulls
// data from /api/ops/delivery/today (extended in this commit to expose
// itemSummary + orderId/jobId per stop).
// ──────────────────────────────────────────────────────────────────────────

interface Stop {
  id: string
  deliveryNumber: string
  address: string | null
  routeOrder: number
  status: string
  builderName: string | null
  builderPhone?: string | null
  orderId: string | null
  orderNumber: string | null
  orderTotal: number | null
  jobId: string | null
  jobNumber: string
  crewId: string | null
  window: string | null
  notes: string
  itemSummary: string
  itemCount: number
  totalQty: number
  signedBy: string | null
  completedAt: string | null
  departedAt: string | null
  arrivedAt: string | null
}

interface TodayResponse {
  date: string
  asOf: string
  drivers: Array<{
    driverId: string | null
    driverName: string
    crewId: string | null
    crewName: string | null
    deliveries: Stop[]
  }>
  summary: {
    total: number
    scheduled: number
    inTransit: number
    complete: number
  }
}

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  SCHEDULED: 'neutral',
  LOADING: 'info',
  IN_TRANSIT: 'warning',
  ARRIVED: 'info',
  UNLOADING: 'info',
  COMPLETE: 'success',
  PARTIAL_DELIVERY: 'warning',
  REFUSED: 'danger',
  RESCHEDULED: 'neutral',
}

function mapsUrl(address: string | null): string {
  if (!address) return '#'
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

function formatWindow(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export default function DriverManifestPage() {
  const { staff, loading: authLoading } = useStaffAuth()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [activeStopId, setActiveStopId] = useState<string | null>(null)
  const [submittingAction, setSubmittingAction] = useState<{ id: string; action: string } | null>(
    null
  )
  const [actionError, setActionError] = useState<string | null>(null)

  // ── Data load ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/delivery/today')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as TodayResponse
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load manifest')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ── Online / offline + pending queue ────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncOnline = () => setOnline(navigator.onLine)
    const syncQueue = () => setPending(queueCount())
    syncOnline()
    syncQueue()
    const onOnline = async () => {
      syncOnline()
      await flushQueue()
      syncQueue()
      load()
    }
    const onOffline = () => syncOnline()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const t = setInterval(syncQueue, 10_000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(t)
    }
  }, [load])

  // Pick "my" bucket — match by staffId = driverId if possible; else
  // fall back to the first driver bucket (single-driver case).
  const myBucket = useMemo(() => {
    if (!data) return null
    if (!staff) return data.drivers[0] || null
    const mine = data.drivers.find((b) => b.driverId === staff.id)
    return mine || data.drivers[0] || null
  }, [data, staff])

  const stops = myBucket?.deliveries || []
  const completed = stops.filter(
    (s) => s.status === 'COMPLETE' || s.status === 'PARTIAL_DELIVERY' || s.status === 'REFUSED'
  ).length

  // ── Actions ──────────────────────────────────────────────────────────
  const driverName = staff
    ? `${staff.firstName} ${staff.lastName}`.trim()
    : myBucket?.driverName || null

  /**
   * Mark a stop ARRIVED, REFUSED, or RESCHEDULED via the lightweight
   * /status endpoint. COMPLETE/PARTIAL go through inline signature capture
   * which calls /complete directly so we get the photo + signature blob.
   */
  const transition = useCallback(
    async (stopId: string, action: 'ARRIVED' | 'REFUSED' | 'RESCHEDULED') => {
      setSubmittingAction({ id: stopId, action })
      setActionError(null)
      try {
        const res = await fetch(`/api/ops/delivery/${stopId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, updatedBy: driverName || undefined }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        await load()
      } catch (e: any) {
        setActionError(e?.message || 'Action failed')
      } finally {
        setSubmittingAction(null)
      }
    },
    [driverName, load]
  )

  if (authLoading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', fontSize: 14 }}>
        Loading manifest…
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 64 }}>
      {/* Sticky header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--canvas, #0e1113)',
          borderBottom: '1px solid var(--border, #2a2722)',
          padding: '14px 16px',
        }}
      >
        <Link
          href="/ops/portal/driver"
          style={{
            fontSize: 13,
            color: 'var(--fg-muted, #a39a8a)',
            textDecoration: 'none',
          }}
        >
          ← Route
        </Link>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 4,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-muted, #a39a8a)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Today ·{' '}
              {new Date().toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
              Manifest
            </div>
            {myBucket?.driverName && (
              <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', marginTop: 2 }}>
                {myBucket.driverName}
                {myBucket.crewName ? ` · ${myBucket.crewName}` : ''}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {completed}
              <span
                style={{
                  color: 'var(--fg-subtle, #7a7369)',
                  fontWeight: 400,
                }}
              >
                /{stops.length}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted, #a39a8a)' }}>stops done</div>
          </div>
        </div>

        {/* Status chips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 10,
            flexWrap: 'wrap',
          }}
        >
          {!online && (
            <span
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#3b1d1d',
                color: '#fca5a5',
                fontWeight: 600,
              }}
            >
              OFFLINE
            </span>
          )}
          {pending > 0 && (
            <span
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#2b2414',
                color: '#f5c168',
                fontWeight: 600,
              }}
            >
              QUEUED {pending}
            </span>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              ...linkBtnStyle,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginLeft: 'auto',
            }}
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={linkBtnStyle}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Body */}
      <main
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Action error banner */}
        {actionError && (
          <div
            style={{
              padding: 12,
              background: '#3b1d1d',
              color: '#fca5a5',
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            {actionError}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  ...skeletonCardStyle,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </>
        )}

        {/* Error state */}
        {error && !loading && (
          <div
            style={{
              padding: 20,
              background: 'var(--surface, #161a1d)',
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 12,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 14, color: '#fca5a5', marginBottom: 8 }}>
              Couldn't load today's manifest
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--fg-muted, #a39a8a)',
                marginBottom: 16,
              }}
            >
              {error}
            </div>
            <button onClick={load} style={linkBtnStyle}>
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && stops.length === 0 && (
          <div
            style={{
              background: 'var(--surface, #161a1d)',
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 12,
            }}
          >
            <EmptyState
              icon={<Truck className="w-8 h-8 text-fg-subtle" />}
              title="No deliveries on today's manifest"
              description="Nothing scheduled for you today. Check back after dispatch."
            />
          </div>
        )}

        {/* Stop cards */}
        {stops.map((stop, idx) => (
          <ManifestStopCard
            key={stop.id}
            stop={stop}
            index={idx}
            isActive={stop.id === activeStopId}
            onToggleActive={() =>
              setActiveStopId((current) => (current === stop.id ? null : stop.id))
            }
            onTransition={transition}
            onCompleted={load}
            submittingAction={submittingAction}
            driverName={driverName}
          />
        ))}
      </main>

      {/* Skeleton + print CSS — keeps the page printable as a backup
         even though we link to /ops/delivery/manifest as the canonical
         clipboard print. Hides chrome and stretches cards on print. */}
      <style jsx global>{`
        @keyframes manifest-shimmer {
          0% { opacity: 0.6; }
          50% { opacity: 0.85; }
          100% { opacity: 0.6; }
        }
        @media print {
          header[role='banner'],
          aside,
          nav,
          .print-hidden {
            display: none !important;
          }
          body { background: #fff !important; color: #000 !important; }
        }
      `}</style>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Per-stop card with expandable proof-of-delivery panel
// ──────────────────────────────────────────────────────────────────────────

function ManifestStopCard({
  stop,
  index,
  isActive,
  onToggleActive,
  onTransition,
  onCompleted,
  submittingAction,
  driverName,
}: {
  stop: Stop
  index: number
  isActive: boolean
  onToggleActive: () => void
  onTransition: (id: string, action: 'ARRIVED' | 'REFUSED' | 'RESCHEDULED') => Promise<void>
  onCompleted: () => void
  submittingAction: { id: string; action: string } | null
  driverName: string | null
}) {
  const isDone =
    stop.status === 'COMPLETE' ||
    stop.status === 'PARTIAL_DELIVERY' ||
    stop.status === 'REFUSED'
  const canMarkArrived = stop.status === 'IN_TRANSIT'
  const canMarkRefused = stop.status === 'ARRIVED' || stop.status === 'UNLOADING'
  const canDeliver = stop.status === 'ARRIVED' || stop.status === 'UNLOADING'
  const canSkip = stop.status === 'SCHEDULED' || stop.status === 'LOADING'

  return (
    <article
      style={{
        background: 'var(--surface, #161a1d)',
        border: `1px solid ${isActive ? 'var(--accent-fg, #c6a24e)' : 'var(--border, #2a2722)'}`,
        borderRadius: 14,
        overflow: 'hidden',
        opacity: isDone ? 0.7 : 1,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px 10px',
          borderBottom: '1px solid var(--border, #2a2722)',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 18,
            background: 'var(--surface-muted, #1f2326)',
            color: 'var(--fg, #e7e1d6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {stop.builderName || '—'}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-muted, #a39a8a)',
              marginTop: 2,
            }}
          >
            {stop.deliveryNumber} · {stop.orderNumber || 'no PO'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <Badge variant={STATUS_TONE[stop.status] || 'neutral'} size="sm">
            {stop.status.replace('_', ' ')}
          </Badge>
          {stop.window && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--fg-muted, #a39a8a)',
                marginTop: 4,
              }}
            >
              {formatWindow(stop.window)}
            </div>
          )}
        </div>
      </div>

      {/* Address — tap-to-navigate */}
      {stop.address && (
        <a
          href={mapsUrl(stop.address)}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            padding: '10px 14px',
            background: 'var(--canvas, #0e1113)',
            fontSize: 13,
            color: 'var(--fg, #e7e1d6)',
            textDecoration: 'none',
            borderBottom: '1px solid var(--border, #2a2722)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--fg-muted, #a39a8a)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 2,
            }}
          >
            Tap to navigate
          </div>
          <div style={{ fontWeight: 500 }}>{stop.address}</div>
        </a>
      )}

      {/* Item summary */}
      {stop.itemSummary && (
        <div
          style={{
            padding: '8px 14px',
            fontSize: 12,
            color: 'var(--fg-muted, #a39a8a)',
            borderBottom: '1px solid var(--border, #2a2722)',
          }}
        >
          <span
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginRight: 6,
            }}
          >
            Load:
          </span>
          {stop.itemSummary}
        </div>
      )}

      {/* Notes */}
      {stop.notes && (
        <div
          style={{
            padding: '8px 14px',
            fontSize: 12,
            color: 'var(--fg-muted, #a39a8a)',
            fontStyle: 'italic',
            borderBottom: '1px solid var(--border, #2a2722)',
          }}
        >
          {stop.notes}
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 0,
        }}
      >
        {stop.builderPhone && (
          <a
            href={`tel:${stop.builderPhone.replace(/[^\d+]/g, '')}`}
            style={{
              ...stopBtnStyle,
              background: 'var(--surface-muted, #1f2326)',
              borderRight: '1px solid var(--border, #2a2722)',
            }}
          >
            Call
          </a>
        )}
        <a
          href={mapsUrl(stop.address)}
          target="_blank"
          rel="noreferrer"
          style={{
            ...stopBtnStyle,
            background: 'var(--surface-muted, #1f2326)',
            gridColumn: stop.builderPhone ? undefined : '1 / -1',
          }}
        >
          Navigate
        </a>
      </div>

      {/* Status action row — Arrived / Refused / Skipped + Deliver */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            // Show Skip only when applicable, otherwise pack 3 columns
            canSkip ? '1fr 1fr 1fr' : '1fr 1fr',
          gap: 0,
          borderTop: '1px solid var(--border, #2a2722)',
        }}
      >
        <button
          type="button"
          disabled={!canMarkArrived || submittingAction?.id === stop.id}
          onClick={() => onTransition(stop.id, 'ARRIVED')}
          style={{
            ...stopActionBtnStyle,
            background: canMarkArrived
              ? 'var(--surface-muted, #1f2326)'
              : 'transparent',
            color: canMarkArrived
              ? 'var(--fg, #e7e1d6)'
              : 'var(--fg-subtle, #7a7369)',
            cursor: canMarkArrived ? 'pointer' : 'not-allowed',
            borderRight: '1px solid var(--border, #2a2722)',
          }}
        >
          {submittingAction?.id === stop.id && submittingAction.action === 'ARRIVED'
            ? '…'
            : 'Arrived'}
        </button>
        <button
          type="button"
          disabled={!canMarkRefused || submittingAction?.id === stop.id}
          onClick={() => {
            if (
              window.confirm(
                'Mark this stop refused? The office will follow up with the customer.'
              )
            ) {
              onTransition(stop.id, 'REFUSED')
            }
          }}
          style={{
            ...stopActionBtnStyle,
            background: canMarkRefused
              ? 'var(--surface-muted, #1f2326)'
              : 'transparent',
            color: canMarkRefused
              ? '#fca5a5'
              : 'var(--fg-subtle, #7a7369)',
            cursor: canMarkRefused ? 'pointer' : 'not-allowed',
            borderRight: canSkip ? '1px solid var(--border, #2a2722)' : undefined,
          }}
        >
          {submittingAction?.id === stop.id && submittingAction.action === 'REFUSED'
            ? '…'
            : 'Refused'}
        </button>
        {canSkip && (
          <button
            type="button"
            disabled={submittingAction?.id === stop.id}
            onClick={() => {
              if (
                window.confirm(
                  'Skip this stop and mark it for reschedule? Dispatch will be notified.'
                )
              ) {
                onTransition(stop.id, 'RESCHEDULED')
              }
            }}
            style={{
              ...stopActionBtnStyle,
              background: 'var(--surface-muted, #1f2326)',
              color: '#f5c168',
            }}
          >
            {submittingAction?.id === stop.id && submittingAction.action === 'RESCHEDULED'
              ? '…'
              : 'Skip'}
          </button>
        )}
      </div>

      {/* Deliver toggle / completed footer */}
      {!isDone && canDeliver && (
        <button
          type="button"
          onClick={onToggleActive}
          style={{
            ...stopBtnStyle,
            display: 'block',
            width: '100%',
            color: '#0e1113',
            background: 'var(--accent-fg, #c6a24e)',
            textAlign: 'center',
            borderTop: '1px solid var(--border, #2a2722)',
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          {isActive ? 'Hide proof-of-delivery' : 'Mark Delivered →'}
        </button>
      )}
      {!isDone && !canDeliver && (
        <div
          style={{
            padding: '10px 14px',
            fontSize: 11,
            color: 'var(--fg-subtle, #7a7369)',
            background: 'var(--canvas, #0e1113)',
            borderTop: '1px solid var(--border, #2a2722)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}
        >
          Mark Arrived once you're on site to deliver.
        </div>
      )}
      {isDone && (
        <div
          style={{
            padding: '12px 14px',
            fontSize: 12,
            color:
              stop.status === 'REFUSED'
                ? '#fca5a5'
                : 'var(--data-positive, #7dd3a0)',
            background: 'var(--canvas, #0e1113)',
            borderTop: '1px solid var(--border, #2a2722)',
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          {stop.status === 'REFUSED'
            ? 'Refused on site'
            : stop.signedBy
              ? `Signed by ${stop.signedBy}`
              : 'Delivered'}
        </div>
      )}

      {/* Inline POD panel */}
      {isActive && !isDone && (
        <ProofOfDeliveryPanel
          stop={stop}
          driverName={driverName}
          onCompleted={() => {
            onToggleActive()
            onCompleted()
          }}
        />
      )}
    </article>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// ProofOfDeliveryPanel — inline signature + photo + complete
// ──────────────────────────────────────────────────────────────────────────

function ProofOfDeliveryPanel({
  stop,
  driverName,
  onCompleted,
}: {
  stop: Stop
  driverName: string | null
  onCompleted: () => void
}) {
  const sigRef = useRef<SignaturePadHandle>(null)
  const [recipientName, setRecipientName] = useState('')
  const [notes, setNotes] = useState('')
  const [partial, setPartial] = useState(false)
  const [sigHasStrokes, setSigHasStrokes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queuedOffline, setQueuedOffline] = useState(false)

  async function submit() {
    setError(null)
    if (!recipientName.trim()) {
      setError('Recipient name is required.')
      return
    }
    const signatureDataUrl = sigRef.current?.toDataURL() ?? null
    if (!signatureDataUrl && !partial) {
      setError('Capture a signature, or mark this as a partial delivery.')
      return
    }
    const payload = {
      recipientName: recipientName.trim(),
      signatureDataUrl,
      // POD photos are uploaded into DocumentVault via DocumentAttachments
      // before submit; we leave the inline `photos` array empty so we don't
      // double-store. The proof links remain in DocumentVault keyed to the job.
      photos: [],
      partialComplete: partial,
      notes: notes.trim() || null,
      deliveredBy: driverName || undefined,
      exceptionCategory: 'NONE',
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ops/delivery/${stop.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onCompleted()
    } catch (e: any) {
      // Offline / 5xx — queue locally, optimistic UI feedback
      enqueueCompletion({
        id: stop.id,
        payload,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      })
      setQueuedOffline(true)
      setTimeout(() => onCompleted(), 1000)
      setError(e?.message ? `${e.message} (queued for retry)` : 'Queued for retry')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        padding: '14px 14px 18px',
        background: 'var(--canvas, #0e1113)',
        borderTop: '1px solid var(--border, #2a2722)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Recipient name */}
      <div>
        <div style={labelStyle}>Received by</div>
        <input
          type="text"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder="Who is signing"
          style={inputStyle}
          autoComplete="off"
        />
      </div>

      {/* Signature */}
      <div>
        <div style={labelStyle}>Signature</div>
        <div
          style={{
            marginTop: 6,
            border: '1px solid var(--border, #2a2722)',
            borderRadius: 12,
            background: 'var(--surface, #161a1d)',
          }}
        >
          <SignaturePad ref={sigRef} height={180} onChange={setSigHasStrokes} />
        </div>
        <div style={hintStyle}>
          {sigHasStrokes
            ? 'Captured — tap Clear to redo.'
            : 'Hand the phone over and have them sign.'}
        </div>
      </div>

      {/* Proof-of-delivery photos via the existing DocumentVault */}
      {stop.jobId ? (
        <div>
          <div style={labelStyle}>Proof-of-delivery photos</div>
          <DocumentAttachments
            entityType="job"
            entityId={stop.jobId}
            defaultCategory="DELIVERY_PROOF"
            allowedCategories={['DELIVERY_PROOF', 'PHOTO', 'GENERAL']}
            title=""
            maxFiles={6}
          />
        </div>
      ) : (
        <div style={{ ...hintStyle, color: '#f5c168' }}>
          No linked job — photos can't be uploaded for this stop. Note any issues
          in driver notes below.
        </div>
      )}

      {/* Partial / notes */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: 'var(--surface-muted, #1f2326)',
          border: '1px solid var(--border, #2a2722)',
          borderRadius: 10,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={partial}
          onChange={(e) => setPartial(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Partial delivery</div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-muted, #a39a8a)',
            }}
          >
            Only some items dropped — job won't fully close.
          </div>
        </div>
      </label>

      <div>
        <div style={labelStyle}>Driver notes (optional)</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Drop location, gate code, anything dispatch should know"
          style={{ ...inputStyle, minHeight: 70 }}
        />
      </div>

      {/* Errors / queued */}
      {error && (
        <div
          style={{
            padding: 10,
            background: '#3b1d1d',
            color: '#fca5a5',
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      {queuedOffline && (
        <div
          style={{
            padding: 10,
            background: '#2b2414',
            color: '#f5c168',
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          You're offline — delivery queued and will sync when you reconnect.
        </div>
      )}

      {/* Submit */}
      <button
        onClick={submit}
        disabled={submitting}
        style={{
          minHeight: 52,
          padding: '12px 16px',
          borderRadius: 10,
          fontSize: 15,
          fontWeight: 700,
          border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer',
          background: submitting
            ? 'var(--surface-muted, #1f2326)'
            : 'var(--accent-fg, #c6a24e)',
          color: submitting ? 'var(--fg-muted, #a39a8a)' : '#0e1113',
        }}
      >
        {submitting
          ? 'Submitting…'
          : partial
            ? 'Submit partial delivery'
            : 'Confirm delivery'}
      </button>

      <div style={{ ...hintStyle, textAlign: 'center' }}>
        Need the full capture flow?{' '}
        <Link
          href={`/ops/portal/driver/${stop.id}`}
          style={{ color: 'var(--accent-fg, #c6a24e)' }}
        >
          Open the detail screen
        </Link>
        .
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Styles — kept inline + driver-portal token-aware so we render the same
// dark canvas as the rest of the portal even before tokens hydrate.
// ──────────────────────────────────────────────────────────────────────────

const stopBtnStyle: React.CSSProperties = {
  padding: '14px 12px',
  fontSize: 14,
  fontWeight: 600,
  textAlign: 'center',
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
  minHeight: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--fg, #e7e1d6)',
}

const stopActionBtnStyle: React.CSSProperties = {
  padding: '12px 8px',
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'center',
  border: 'none',
  minHeight: 48,
}

const linkBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 8,
  background: 'var(--surface-muted, #1f2326)',
  color: 'var(--fg, #e7e1d6)',
  border: '1px solid var(--border, #2a2722)',
  textDecoration: 'none',
  cursor: 'pointer',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--fg-muted, #a39a8a)',
  fontWeight: 600,
  marginBottom: 2,
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle, #7a7369)',
  marginTop: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: 16, // 16px stops iOS auto-zoom
  background: 'var(--surface, #161a1d)',
  color: 'var(--fg, #e7e1d6)',
  border: '1px solid var(--border, #2a2722)',
  borderRadius: 10,
  marginTop: 6,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const skeletonCardStyle: React.CSSProperties = {
  background: 'var(--surface, #161a1d)',
  border: '1px solid var(--border, #2a2722)',
  borderRadius: 14,
  height: 220,
  animation: 'manifest-shimmer 1.2s ease-in-out infinite',
}
