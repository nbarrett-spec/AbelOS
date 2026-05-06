'use client'

/**
 * Builder Portal — Reorder confirmation modal (A-BIZ-14).
 *
 * Shared between two callers:
 *   1. Order detail "Reorder" button   — mode="order"   + sourceOrderId
 *   2. Templates list  "New order"     — mode="template" + templateId
 *
 * Behaviour: fetches the source line items, lets the builder edit qty
 * (or remove a line by zeroing the qty), then POSTs to the matching
 * `/api/portal/orders/from-{order|template}` endpoint. On success, routes
 * to `/portal/orders/[newOrderId]`.
 *
 * The shape returned by the GET endpoints is intentionally similar so we
 * can keep one modal. For mode="order" we hit
 * `/api/builder/orders/[id]/reorder` (already exists, returns items with
 * pricing diff + warnings); for mode="template" we hit
 * `/api/portal/order-templates/[id]`.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Minus, Plus, X, AlertTriangle } from 'lucide-react'

interface LineItem {
  productId: string
  productName: string
  sku: string
  quantity: number       // current edited qty
  defaultQty: number     // original qty for "reset"
  unitPrice: number
  inStock: boolean
  active: boolean
  /** Optional pricing-changed flag from the order-history endpoint. */
  priceChanged?: boolean
  originalUnitPrice?: number
}

interface ReorderModalProps {
  open: boolean
  onClose: () => void
  /** Source for the line items. */
  mode: 'order' | 'template'
  /** Source identifier — orderId or templateId. */
  sourceId: string
  /** Display title (e.g. order number or template name). */
  sourceLabel: string
}

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function ReorderModal({
  open,
  onClose,
  mode,
  sourceId,
  sourceLabel,
}: ReorderModalProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState<LineItem[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load items when the modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setWarnings([])
      try {
        if (mode === 'order') {
          const res = await fetch(
            `/api/builder/orders/${encodeURIComponent(sourceId)}/reorder`,
            { method: 'POST', credentials: 'include' }
          )
          if (!res.ok) {
            const data = await res.json().catch(() => null)
            throw new Error(data?.error || 'Failed to load reorder')
          }
          const data = await res.json()
          if (cancelled) return
          const next: LineItem[] = (data.items || []).map((it: any) => ({
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            quantity: Number(it.quantity) || 1,
            defaultQty: Number(it.quantity) || 1,
            unitPrice: Number(it.currentUnitPrice ?? it.originalUnitPrice ?? 0),
            inStock: !!it.inStock,
            active: !it.discontinued,
            priceChanged: !!it.priceChanged,
            originalUnitPrice: Number(it.originalUnitPrice ?? 0),
          }))
          setItems(next)
          setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
        } else {
          const res = await fetch(
            `/api/portal/order-templates/${encodeURIComponent(sourceId)}`,
            { credentials: 'include' }
          )
          if (!res.ok) {
            const data = await res.json().catch(() => null)
            throw new Error(data?.error || 'Failed to load template')
          }
          const data = await res.json()
          if (cancelled) return
          const next: LineItem[] = (data.items || []).map((it: any) => ({
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            quantity: Number(it.quantity) || 1,
            defaultQty: Number(it.quantity) || 1,
            unitPrice: Number(it.currentPrice ?? 0),
            inStock: !!it.inStock,
            active: !!it.active,
          }))
          setItems(next)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load items')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [open, mode, sourceId])

  const total = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + (it.quantity > 0 ? it.quantity * it.unitPrice : 0),
        0
      ),
    [items]
  )
  const validCount = items.filter((it) => it.quantity > 0).length

  function setQty(productId: string, qty: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.productId === productId
          ? { ...it, quantity: Math.max(0, Math.floor(qty || 0)) }
          : it
      )
    )
  }

  function bumpQty(productId: string, delta: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.productId === productId
          ? { ...it, quantity: Math.max(0, it.quantity + delta) }
          : it
      )
    )
  }

  function removeLine(productId: string) {
    setQty(productId, 0)
  }

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)

    // Build qtyOverrides — only include lines whose qty differs from
    // default OR is zero (so the server drops them).
    const qtyOverrides: Record<string, number> = {}
    for (const it of items) {
      if (it.quantity !== it.defaultQty) {
        qtyOverrides[it.productId] = it.quantity
      }
    }

    const url =
      mode === 'order'
        ? '/api/portal/orders/from-order'
        : '/api/portal/orders/from-template'

    const payload =
      mode === 'order'
        ? { sourceOrderId: sourceId, qtyOverrides }
        : { templateId: sourceId, qtyOverrides }

    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to create order')
      }
      const data = await res.json()
      onClose()
      router.push(`/portal/orders/${data.orderId}`)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to create order')
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Fragment>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(20, 14, 10, 0.55)', backdropFilter: 'blur(2px)' }}
        onClick={() => {
          if (!submitting) onClose()
        }}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reorder-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div
          className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-[14px] overflow-hidden"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-start justify-between gap-4 px-6 py-4"
            style={{ borderBottom: '1px solid var(--portal-border-light, #F0E8DA)' }}
          >
            <div className="min-w-0">
              <div
                className="text-[11px] uppercase mb-1"
                style={{
                  color: 'var(--portal-text-subtle)',
                  fontFamily: 'var(--font-portal-mono)',
                  letterSpacing: '0.12em',
                }}
              >
                {mode === 'order' ? 'Reorder' : 'New Order from Template'}
              </div>
              <h2
                id="reorder-modal-title"
                className="text-lg truncate"
                style={{
                  color: 'var(--portal-text-strong)',
                  fontFamily: 'var(--font-portal-display)',
                  fontWeight: 500,
                }}
              >
                {sourceLabel}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-[var(--portal-bg-elevated)] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" style={{ color: 'var(--portal-text-muted)' }} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <div
                className="flex items-center justify-center py-12 text-sm"
                style={{ color: 'var(--portal-text-muted)' }}
              >
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading items…
              </div>
            ) : error ? (
              <div
                className="px-4 py-3 rounded-md text-sm"
                style={{
                  background: 'rgba(110,42,36,0.08)',
                  border: '1px solid rgba(110,42,36,0.2)',
                  color: '#7E2417',
                }}
              >
                {error}
              </div>
            ) : items.length === 0 ? (
              <div
                className="text-center py-10 text-sm"
                style={{ color: 'var(--portal-text-muted)' }}
              >
                No items to reorder.
              </div>
            ) : (
              <div className="space-y-2">
                {warnings.length > 0 && (
                  <div
                    className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
                    style={{
                      background: 'rgba(201, 130, 43, 0.08)',
                      border: '1px solid rgba(201, 130, 43, 0.25)',
                      color: '#7A4F1A',
                    }}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <ul className="space-y-0.5">
                      {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[11px] uppercase"
                      style={{
                        color: 'var(--portal-text-subtle)',
                        fontFamily: 'var(--font-portal-mono)',
                        letterSpacing: '0.1em',
                      }}
                    >
                      <th className="py-2 font-semibold">Item</th>
                      <th className="py-2 font-semibold text-center w-32">Qty</th>
                      <th className="py-2 font-semibold text-right w-24">Unit</th>
                      <th className="py-2 font-semibold text-right w-24">Line</th>
                      <th className="py-2 w-10" aria-label="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const dropped = it.quantity === 0
                      const lineTotal = it.quantity * it.unitPrice
                      return (
                        <tr
                          key={it.productId}
                          className="border-t"
                          style={{
                            borderColor: 'var(--portal-border-light, #F0E8DA)',
                            opacity: dropped ? 0.45 : 1,
                          }}
                        >
                          <td className="py-2 align-top">
                            <div
                              className="font-medium"
                              style={{ color: 'var(--portal-text-strong)' }}
                            >
                              {it.productName}
                            </div>
                            <div
                              className="text-[11px] font-mono"
                              style={{ color: 'var(--portal-text-muted)' }}
                            >
                              {it.sku}
                            </div>
                            {!it.active && (
                              <div className="text-[11px] text-red-700 mt-0.5">
                                No longer available
                              </div>
                            )}
                            {it.active && !it.inStock && (
                              <div className="text-[11px] text-amber-700 mt-0.5">
                                Out of stock — will backorder
                              </div>
                            )}
                            {it.priceChanged && it.originalUnitPrice ? (
                              <div
                                className="text-[11px] mt-0.5"
                                style={{ color: 'var(--portal-text-subtle)' }}
                              >
                                Was ${fmtUsd(it.originalUnitPrice)}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 align-top">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => bumpQty(it.productId, -1)}
                                disabled={submitting}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md border hover:bg-[var(--portal-bg-elevated)] disabled:opacity-50"
                                style={{
                                  borderColor: 'var(--portal-border, #E8DFD0)',
                                }}
                                aria-label="Decrease quantity"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={it.quantity}
                                onChange={(e) =>
                                  setQty(it.productId, Number(e.target.value))
                                }
                                disabled={submitting || !it.active}
                                className="w-14 h-7 text-center text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                                style={{
                                  border: '1px solid var(--portal-border, #E8DFD0)',
                                  background: 'var(--portal-bg-card, #FFFFFF)',
                                  color: 'var(--portal-text-strong)',
                                  fontFamily: 'var(--font-portal-mono)',
                                }}
                                aria-label={`Quantity for ${it.productName}`}
                              />
                              <button
                                type="button"
                                onClick={() => bumpQty(it.productId, 1)}
                                disabled={submitting || !it.active}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md border hover:bg-[var(--portal-bg-elevated)] disabled:opacity-50"
                                style={{
                                  borderColor: 'var(--portal-border, #E8DFD0)',
                                }}
                                aria-label="Increase quantity"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td
                            className="py-2 text-right font-mono text-xs align-top"
                            style={{ color: 'var(--portal-text-muted)' }}
                          >
                            ${fmtUsd(it.unitPrice)}
                          </td>
                          <td
                            className="py-2 text-right font-mono align-top"
                            style={{ color: 'var(--portal-text-strong)' }}
                          >
                            ${fmtUsd(lineTotal)}
                          </td>
                          <td className="py-2 align-top">
                            <button
                              type="button"
                              onClick={() => removeLine(it.productId)}
                              disabled={submitting || it.quantity === 0}
                              className="p-1 rounded hover:bg-[var(--portal-bg-elevated)] disabled:opacity-30"
                              aria-label="Remove line"
                            >
                              <X
                                className="w-3.5 h-3.5"
                                style={{ color: 'var(--portal-text-muted)' }}
                              />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="px-6 py-4 flex items-center justify-between gap-4"
            style={{
              borderTop: '1px solid var(--portal-border-light, #F0E8DA)',
              background: 'var(--portal-bg-elevated, #FAF6EE)',
            }}
          >
            <div className="text-sm">
              <div
                className="text-[11px] uppercase"
                style={{
                  color: 'var(--portal-text-subtle)',
                  fontFamily: 'var(--font-portal-mono)',
                  letterSpacing: '0.1em',
                }}
              >
                {validCount} {validCount === 1 ? 'line' : 'lines'} · Estimated
              </div>
              <div
                className="text-lg font-mono"
                style={{ color: 'var(--portal-text-strong)', fontWeight: 600 }}
              >
                ${fmtUsd(total)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 h-9 rounded-full text-sm font-medium"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || loading || validCount === 0}
                className="inline-flex items-center gap-1.5 px-5 h-9 rounded-full text-sm font-medium disabled:opacity-60"
                style={{
                  background: 'var(--grad)',
                  color: 'white',
                  boxShadow: '0 6px 20px rgba(79,70,229,0.25)',
                }}
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? 'Submitting…' : 'Place Order'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  )
}
