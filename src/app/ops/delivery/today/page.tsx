'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Truck } from 'lucide-react'
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
                {driver.deliveries.map((d, i) => (
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
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        {d.orderTotal != null && (
                          <div className="font-numeric text-sm">
                            ${Math.round(d.orderTotal).toLocaleString()}
                          </div>
                        )}
                        {d.window && (
                          <div className="text-[11px] text-fg-muted">
                            {new Date(d.window).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </div>
                        )}
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
                ))}
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
