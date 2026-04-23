'use client'

import { useEffect, useMemo, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────
// Builder-facing CO preview — simpler than the ops sheet. Builder picks
// items from their own order, sees a plain-English impact, acknowledges
// if the change will miss the delivery date. No SKUs, no vendor data.
//
// Brand voice: quiet, factual, no oversell. "Delivery shifts from X to Y."
// Not "This awesome change order will totally impact your delivery!"
// ──────────────────────────────────────────────────────────────────────

type CoLineType = 'ADD' | 'REMOVE' | 'SUBSTITUTE'

interface OrderItem {
  id: string
  productId: string | null
  description: string
  quantity: number
}

interface DraftLine {
  clientId: string
  productId: string
  productName: string
  qty: number
  type: CoLineType
}

interface BuilderImpact {
  jobId: string
  jobNumber: string | null
  scheduledDate: string | null
  newCompletionDate: string | null
  daysShifted: number
  overallImpact: 'NONE' | 'DELAYED_BUT_OK' | 'AT_RISK' | 'WILL_MISS'
  headline: string
  message: string
  requiresAcknowledgment: boolean
  lines: Array<{
    productId: string
    productName: string | null
    qty: number
    type: CoLineType
    daysToShelf: number | null
    arrivalDate: string | null
    status: string
    reason: string | null
  }>
}

const OVERALL_STYLES: Record<BuilderImpact['overallImpact'], string> = {
  NONE: 'background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46',
  DELAYED_BUT_OK: 'background:#fffbeb;border:1px solid #fde68a;color:#92400e',
  AT_RISK: 'background:#fff7ed;border:1px solid #fed7aa;color:#9a3412',
  WILL_MISS: 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b',
}

export default function BuilderCoPreviewModal({
  jobId,
  orderId,
  open,
  onClose,
}: {
  jobId: string
  orderId: string | null
  open: boolean
  onClose: () => void
}) {
  const [items, setItems] = useState<OrderItem[]>([])
  const [lines, setLines] = useState<DraftLine[]>([])
  const [impact, setImpact] = useState<BuilderImpact | null>(null)
  const [loading, setLoading] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the builder's order items so they can pick from what they already
  // have — doesn't leak our catalog beyond what they ordered.
  useEffect(() => {
    if (!open || !orderId) return
    let ignore = false
    fetch(`/api/orders/${orderId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        if (ignore) return
        const o = data.order || data
        setItems(
          (o.items || []).map((it: any) => ({
            id: it.id,
            productId: it.productId || null,
            description: it.description || it.product?.name || '',
            quantity: it.quantity,
          }))
        )
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [open, orderId])

  // Reset when closed so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setLines([])
      setImpact(null)
      setAcknowledged(false)
      setConfirmed(false)
      setError(null)
    }
  }, [open])

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        clientId: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        productId: '',
        productName: '',
        qty: 1,
        type: 'ADD',
      },
    ])
    setAcknowledged(false)
  }

  const updateLine = (cid: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.clientId === cid ? { ...l, ...patch } : l)))
    setAcknowledged(false)
  }

  const removeLine = (cid: string) => {
    setLines((prev) => prev.filter((l) => l.clientId !== cid))
    setAcknowledged(false)
  }

  const validLines = useMemo(
    () => lines.filter((l) => l.productId && Number.isFinite(l.qty) && l.qty > 0),
    [lines]
  )

  // Live preview as the builder edits.
  useEffect(() => {
    if (!open) return
    if (validLines.length === 0) {
      setImpact(null)
      return
    }
    const h = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/builder-portal/jobs/${jobId}/co-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coLines: validLines.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              type: l.type,
            })),
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || `Preview failed (${res.status})`)
        }
        const data = await res.json()
        setImpact(data)
      } catch (e: any) {
        setError(e?.message || 'Preview failed')
        setImpact(null)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(h)
  }, [jobId, open, validLines])

  const handleConfirm = async () => {
    if (!impact || validLines.length === 0) return
    if (impact.requiresAcknowledgment && !acknowledged) return
    setConfirming(true)
    try {
      await fetch(`/api/builder-portal/jobs/${jobId}/co-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coLines: validLines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            type: l.type,
          })),
          confirm: true,
          acknowledged: impact.requiresAcknowledgment ? acknowledged : undefined,
        }),
      })
      setConfirmed(true)
    } catch (e) {
      // non-fatal
    } finally {
      setConfirming(false)
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f2a3e', margin: 0 }}>
            Request a change
          </h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            See how a change affects your delivery before you commit.
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Line editor */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                Changes
              </span>
              <button
                onClick={addLine}
                style={{
                  fontSize: 12,
                  background: '#0f2a3e',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 12px',
                  cursor: 'pointer',
                }}
              >
                + Add line
              </button>
            </div>
            {lines.length === 0 && (
              <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 16 }}>
                Add lines to see the impact on your delivery.
              </p>
            )}
            {lines.map((l) => (
              <div
                key={l.clientId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '100px 1fr 80px 60px',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <select
                  value={l.type}
                  onChange={(e) => updateLine(l.clientId, { type: e.target.value as CoLineType })}
                  style={{ fontSize: 13, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4 }}
                >
                  <option value="ADD">Add</option>
                  <option value="REMOVE">Remove</option>
                </select>
                <select
                  value={l.productId}
                  onChange={(e) => {
                    const item = items.find((it) => it.productId === e.target.value)
                    updateLine(l.clientId, {
                      productId: e.target.value,
                      productName: item?.description || '',
                    })
                  }}
                  style={{ fontSize: 13, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4 }}
                >
                  <option value="">Select an item...</option>
                  {items
                    .filter((it) => it.productId)
                    .map((it) => (
                      <option key={it.id} value={it.productId as string}>
                        {it.description}
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => updateLine(l.clientId, { qty: Number(e.target.value) })}
                  style={{ fontSize: 13, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, textAlign: 'right' }}
                />
                <button
                  onClick={() => removeLine(l.clientId)}
                  style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {/* Impact card */}
          {error && (
            <div
              style={{
                padding: 12,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                fontSize: 13,
                color: '#991b1b',
              }}
            >
              {error}
            </div>
          )}

          {impact && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                ...cssToStyle(OVERALL_STYLES[impact.overallImpact]),
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                {impact.overallImpact.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, margin: '4px 0 4px' }}>
                {impact.headline}
              </div>
              <div style={{ fontSize: 13 }}>{impact.message}</div>
              {impact.daysShifted > 0 && (
                <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>
                  Shifts delivery by {impact.daysShifted} day{impact.daysShifted === 1 ? '' : 's'}.
                </div>
              )}
            </div>
          )}

          {impact?.requiresAcknowledgment && !confirmed && (
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginTop: 12,
                padding: 12,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                fontSize: 13,
                color: '#7f1d1d',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                I understand this change will miss the current delivery date. I&apos;m OK moving it.
              </span>
            </label>
          )}

          {loading && (
            <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', marginTop: 8 }}>
              Recalculating...
            </div>
          )}

          {confirmed && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 8,
                fontSize: 13,
                color: '#065f46',
              }}
            >
              Logged. Your rep will reach out to finalize the change.
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #e5e7eb',
            background: '#f9fafb',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              padding: '6px 14px',
              background: 'white',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              !impact ||
              confirming ||
              confirmed ||
              validLines.length === 0 ||
              (impact.requiresAcknowledgment && !acknowledged)
            }
            style={{
              fontSize: 13,
              padding: '6px 14px',
              background:
                !impact ||
                confirmed ||
                (impact?.requiresAcknowledgment && !acknowledged)
                  ? '#9ca3af'
                  : '#0f2a3e',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor:
                !impact ||
                confirmed ||
                (impact?.requiresAcknowledgment && !acknowledged)
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {confirming ? 'Confirming...' : confirmed ? 'Confirmed' : 'Confirm change'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Tiny CSS-string-to-style helper — keeps the tone/style map declarative.
function cssToStyle(css: string): React.CSSProperties {
  const out: Record<string, string> = {}
  for (const chunk of css.split(';')) {
    const [k, v] = chunk.split(':').map((s) => s?.trim())
    if (k && v) out[k] = v
  }
  return out as React.CSSProperties
}
