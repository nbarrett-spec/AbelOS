'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Truck, Phone, Mail, AlertTriangle, UserCircle } from 'lucide-react'
import { PageHeader, Card, KPICard, Badge, Button, Modal } from '@/components/ui'
import EmptyState from '@/components/ui/EmptyState'

interface TodayDelivery {
  id: string
  deliveryNumber: string
  address: string | null
  routeOrder: number
  status: string
  builderName: string | null
  builderPhone?: string | null
  // D-16: optional contact fields the API may add later. Render-defensive
  // today (currently undefined) so we are forward-compatible without an API
  // change. siteContactName/Email is the on-site receiver if distinct from
  // the builder (e.g. superintendent); pmName/pmPhone is the assigned PM.
  builderEmail?: string | null
  siteContactName?: string | null
  siteContactPhone?: string | null
  siteContactEmail?: string | null
  pmName?: string | null
  pmPhone?: string | null
  orderNumber: string | null
  orderTotal: number | null
  jobNumber: string
  window: string | null
  notes: string
  signedBy: string | null
  completedAt: string | null
  departedAt: string | null
  arrivedAt: string | null
}

// D-14: assume a 2h delivery window unless we get explicit window-end data.
const WINDOW_DURATION_MS = 2 * 60 * 60 * 1000
// "Approaching" threshold — within this many ms before window start, flip yellow.
const APPROACHING_MS = 60 * 60 * 1000

type WindowState =
  | { kind: 'none' }
  | { kind: 'far'; label: string; startLabel: string; endLabel: string }
  | { kind: 'approaching'; label: string; startLabel: string; endLabel: string }
  | { kind: 'in-window'; label: string; startLabel: string; endLabel: string }
  | { kind: 'overdue'; label: string; startLabel: string; endLabel: string }
  | { kind: 'done'; startLabel: string; endLabel: string }

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtRelative(ms: number) {
  const abs = Math.abs(ms)
  const totalMin = Math.round(abs / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function computeWindowState(
  windowIso: string | null | undefined,
  status: string,
  now: Date,
): WindowState {
  if (!windowIso) return { kind: 'none' }
  const start = new Date(windowIso)
  if (Number.isNaN(start.getTime())) return { kind: 'none' }
  const end = new Date(start.getTime() + WINDOW_DURATION_MS)
  const startLabel = fmtTime(start)
  const endLabel = fmtTime(end)

  // Completed/refused stops: just show the window, don't shout.
  if (status === 'COMPLETE' || status === 'PARTIAL_DELIVERY' || status === 'REFUSED') {
    return { kind: 'done', startLabel, endLabel }
  }

  const t = now.getTime()
  if (t < start.getTime()) {
    const delta = start.getTime() - t
    const label = `in ${fmtRelative(delta)}`
    if (delta <= APPROACHING_MS) return { kind: 'approaching', label, startLabel, endLabel }
    return { kind: 'far', label, startLabel, endLabel }
  }
  if (t < end.getTime()) {
    return { kind: 'in-window', label: 'ON SITE NOW', startLabel, endLabel }
  }
  return {
    kind: 'overdue',
    label: `OVERDUE BY ${fmtRelative(t - end.getTime())}`,
    startLabel,
    endLabel,
  }
}

// Strip phone for tel: links — keeps + and digits.
function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

interface TodayResponse {
  date: string
  drivers: Array<{
    driverId: string | null
    driverName: string
    crewName: string | null
    deliveries: TodayDelivery[]
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

export default function TodayDeliveryBoard() {
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [completingId, setCompletingId] = useState<string | null>(null)
  // D-14: tick once a minute so the "in Xh Ym" / "OVERDUE" labels update
  // between API polls.
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/delivery/today')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Poll every 10s — real-time-ish supervisor view
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Delivery"
          title="Today's Route Board"
          description="Live dispatch — every driver, every stop, every signature."
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Delivery', href: '/ops/delivery' },
            { label: 'Today' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" loading={loading} onClick={load}>
                Refresh
              </Button>
              <Link href="/ops/delivery/manifest" className="text-xs text-accent-fg hover:underline">
                Print manifest →
              </Link>
            </div>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Today's Stops" value={data?.summary.total ?? '—'} accent="brand" />
          <KPICard title="Scheduled" value={data?.summary.scheduled ?? '—'} accent="neutral" />
          <KPICard title="In Transit" value={data?.summary.inTransit ?? '—'} accent="accent" />
          <KPICard
            title="Complete"
            value={data?.summary.complete ?? '—'}
            accent="positive"
          />
        </div>

        {data?.drivers.length === 0 && (
          <Card padding="lg">
            <EmptyState
              icon={<Truck className="w-8 h-8 text-fg-subtle" />}
              title="No deliveries scheduled"
              description="No drivers have stops on the board today."
            />
          </Card>
        )}

        <div className="space-y-4">
          {data?.drivers.map((driver) => (
            <Card key={driver.driverId ?? driver.driverName} padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-muted/40">
                <div>
                  <div className="text-sm font-semibold text-fg">{driver.driverName}</div>
                  {driver.crewName && (
                    <div className="text-[11px] text-fg-subtle">{driver.crewName}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="neutral" size="sm">
                    {driver.deliveries.length} stop{driver.deliveries.length === 1 ? '' : 's'}
                  </Badge>
                  <button
                    className="text-xs text-fg-muted hover:text-fg"
                    onClick={() => alert('Share location feature stub — will wire GPS later.')}
                  >
                    Share location
                  </button>
                </div>
              </div>

              <div className="divide-y divide-border">
                {driver.deliveries.map((d, i) => {
                  const windowState = computeWindowState(d.window, d.status, now)
                  // D-16: pick the best site contact we have. Prefer an
                  // explicit site contact, fall back to builder.
                  const contactName = d.siteContactName || d.builderName || null
                  const contactPhone = d.siteContactPhone || d.builderPhone || null
                  const contactEmail = d.siteContactEmail || d.builderEmail || null
                  const hasContact = !!(contactName || contactPhone || contactEmail)
                  return (
                    <div key={d.id} className="px-4 py-3 hover:bg-surface-muted/30">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-muted flex items-center justify-center text-xs font-semibold">
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-fg-muted">
                                {d.deliveryNumber}
                              </span>
                              <Badge variant={STATUS_TONE[d.status] || 'neutral'} size="xs">
                                {d.status.replace('_', ' ')}
                              </Badge>
                            </div>
                            <div className="text-sm text-fg">
                              {d.builderName || '—'}{' '}
                              <span className="text-fg-muted">· {d.orderNumber}</span>
                            </div>
                            <div className="text-xs text-fg-muted">{d.address || '—'}</div>
                            {d.notes && (
                              <div className="text-[11px] text-fg-subtle mt-1 italic">
                                {d.notes}
                              </div>
                            )}
                            <ContactBlock
                              contactName={contactName}
                              contactPhone={contactPhone}
                              contactEmail={contactEmail}
                              hasContact={hasContact}
                              pmName={d.pmName}
                              pmPhone={d.pmPhone}
                            />
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 flex flex-col items-end gap-2 min-w-[180px]">
                          {d.orderTotal != null && (
                            <div className="font-numeric text-sm">
                              ${Math.round(d.orderTotal).toLocaleString()}
                            </div>
                          )}
                          <WindowBlock state={windowState} />
                          {d.signedBy ? (
                            <div className="text-[11px] text-data-positive">
                              Signed: {d.signedBy}
                            </div>
                          ) : d.status !== 'COMPLETE' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCompletingId(d.id)}
                            >
                              Complete
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {completingId && (
        <CompleteDeliveryModal
          deliveryId={completingId}
          onClose={() => setCompletingId(null)}
          onComplete={() => {
            setCompletingId(null)
            load()
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// D-14: Window column — color-coded vs current time
// ──────────────────────────────────────────────────────────────────────────
function WindowBlock({ state }: { state: WindowState }) {
  if (state.kind === 'none') {
    return (
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
        No window
      </div>
    )
  }

  // Color tokens
  const tone =
    state.kind === 'in-window'
      ? { ring: 'border-data-positive/40 bg-data-positive-bg text-data-positive-fg', dot: 'bg-data-positive' }
      : state.kind === 'approaching'
      ? { ring: 'border-data-warning/40 bg-data-warning-bg text-data-warning-fg', dot: 'bg-data-warning' }
      : state.kind === 'overdue'
      ? { ring: 'border-data-negative/40 bg-data-negative-bg text-data-negative-fg', dot: 'bg-data-negative' }
      : state.kind === 'done'
      ? { ring: 'border-border bg-surface-muted text-fg-muted', dot: 'bg-fg-subtle' }
      : { ring: 'border-border bg-surface-muted/40 text-fg-muted', dot: 'bg-fg-subtle' }

  return (
    <div className={`flex flex-col items-end gap-0.5 px-2 py-1 rounded border ${tone.ring}`}>
      {state.kind !== 'done' && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider leading-none">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${tone.dot}`} />
          {state.label}
        </div>
      )}
      <div className="text-[10px] tabular-nums text-fg-muted leading-none">
        {state.startLabel}–{state.endLabel}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// D-16: Site contact + PM fallback. tel:/mailto: links with 44px tap targets.
// ──────────────────────────────────────────────────────────────────────────
function ContactBlock({
  contactName,
  contactPhone,
  contactEmail,
  hasContact,
  pmName,
  pmPhone,
}: {
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  hasContact: boolean
  pmName?: string | null
  pmPhone?: string | null
}) {
  if (!hasContact && !pmPhone) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-data-warning-fg bg-data-warning-bg border border-data-warning/40 rounded px-2 py-1">
        <AlertTriangle className="w-3 h-3" />
        No site contact
      </div>
    )
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {contactName && (
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
          <UserCircle className="w-3 h-3" />
          {contactName}
        </span>
      )}
      {contactPhone && (
        <a
          href={telHref(contactPhone)}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-medium text-accent-fg bg-signal-subtle hover:bg-signal-subtle/70 border border-transparent rounded"
          aria-label={`Call ${contactName || 'site contact'} at ${contactPhone}`}
        >
          <Phone className="w-3.5 h-3.5" />
          {contactPhone}
        </a>
      )}
      {contactEmail && (
        <a
          href={`mailto:${contactEmail}`}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-medium text-fg-muted bg-surface-muted hover:bg-surface-muted/70 border border-border rounded"
          aria-label={`Email ${contactName || 'site contact'} at ${contactEmail}`}
        >
          <Mail className="w-3.5 h-3.5" />
          Email
        </a>
      )}
      {pmPhone && (
        <a
          href={telHref(pmPhone)}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-medium text-fg-muted bg-surface hover:bg-surface-muted border border-border rounded"
          aria-label={`Call PM ${pmName || ''}`.trim()}
          title={pmName ? `Call PM: ${pmName}` : 'Call PM'}
        >
          <Phone className="w-3.5 h-3.5" />
          Call PM{pmName ? ` (${pmName})` : ''}
        </a>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Complete Delivery Modal with signature canvas
// ──────────────────────────────────────────────────────────────────────────
function CompleteDeliveryModal({
  deliveryId,
  onClose,
  onComplete,
}: {
  deliveryId: string
  onClose: () => void
  onComplete: () => void
}) {
  const [signedBy, setSignedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasStrokes = useRef(false)

  function getCtx() {
    const c = canvasRef.current
    if (!c) return null
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#e7e1d6'
    return ctx
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true
    hasStrokes.current = true
    const ctx = getCtx()
    if (!ctx) return
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = getCtx()
    if (!ctx) return
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function end() {
    drawing.current = false
  }

  function clearSig() {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    hasStrokes.current = false
  }

  async function submit() {
    if (!signedBy.trim()) {
      alert('Signer name required')
      return
    }
    setSubmitting(true)
    try {
      const signature = hasStrokes.current ? canvasRef.current?.toDataURL('image/png') : null
      const res = await fetch(`/api/ops/delivery/${deliveryId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedBy, signature, notes }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onComplete()
    } catch (e: any) {
      alert(`Failed: ${e?.message || 'error'}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Complete Delivery" size="lg">
      <div className="space-y-4">
        <div>
          <label className="text-xs text-fg-muted uppercase tracking-wider">Signed by</label>
          <input
            type="text"
            className="input w-full text-sm mt-1"
            value={signedBy}
            onChange={(e) => setSignedBy(e.target.value)}
            placeholder="Who accepted delivery on site"
          />
        </div>
        <div>
          <label className="text-xs text-fg-muted uppercase tracking-wider">Signature</label>
          <div className="mt-1 relative border border-border rounded-md bg-surface">
            <canvas
              ref={canvasRef}
              width={560}
              height={180}
              className="w-full touch-none"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
            />
            <button
              onClick={clearSig}
              className="absolute top-1 right-1 text-[10px] text-fg-muted hover:text-fg px-1.5 py-0.5 border border-border rounded"
            >
              Clear
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-fg-muted uppercase tracking-wider">Notes</label>
          <textarea
            className="input w-full text-sm mt-1 min-h-[60px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Drop location, damage, refusal notes…"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} loading={submitting}>
            Mark complete
          </Button>
        </div>
      </div>
    </Modal>
  )
}
