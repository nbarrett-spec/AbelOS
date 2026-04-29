'use client'

import { useMemo, useState, useEffect } from 'react'
import { Modal } from './Modal'
import { AlertTriangle } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// BatchPaymentModal — record one builder check across multiple invoices
// ──────────────────────────────────────────────────────────────────────────
// Builder-side already supports batch selection at /dashboard/payments. Ops
// (Dawn) had to record each invoice one-at-a-time — this modal closes that
// gap. Auto-distribute oldest-due-first; fill until amount runs out; partial
// allowed on the last invoice that gets touched.

export interface BatchInvoice {
  id: string
  invoiceNumber: string
  total: number
  balanceDue: number
  dueDate: string | null
  builderName?: string
}

interface DistributionRow {
  invoiceId: string
  invoiceNumber: string
  amount: number
  balanceDue: number
}

interface BatchPaymentModalProps {
  isOpen: boolean
  invoices: BatchInvoice[]
  onClose: () => void
  onSuccess: () => void
}

const PAYMENT_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER'] as const

export function BatchPaymentModal({
  isOpen,
  invoices,
  onClose,
  onSuccess,
}: BatchPaymentModalProps) {
  const todayStr = () => new Date().toISOString().split('T')[0]

  const [method, setMethod] = useState<string>('CHECK')
  const [reference, setReference] = useState('')
  const [receivedDate, setReceivedDate] = useState<string>(todayStr())
  const [totalAmount, setTotalAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open so old state doesn't leak between sessions.
  useEffect(() => {
    if (isOpen) {
      setMethod('CHECK')
      setReference('')
      setReceivedDate(todayStr())
      setTotalAmount('')
      setNotes('')
      setSaving(false)
      setError(null)
    }
  }, [isOpen])

  // Sort by dueDate ASC (oldest first); nulls last so undated invoices fall
  // to the end of the queue rather than jumping the line.
  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY
      return ad - bd
    })
  }, [invoices])

  const totalBalance = useMemo(
    () => invoices.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0),
    [invoices]
  )

  const parsedAmount = parseFloat(totalAmount)
  const validAmount = !isNaN(parsedAmount) && parsedAmount > 0

  // Auto-distribute oldest-first. Round to cents to avoid float drift; the
  // final touched invoice absorbs any rounding slack so the distribution
  // sums exactly to the user-entered total.
  const distribution: DistributionRow[] = useMemo(() => {
    if (!validAmount) return []
    let remaining = Math.round(parsedAmount * 100) // cents
    const rows: DistributionRow[] = []
    for (const inv of sortedInvoices) {
      if (remaining <= 0) break
      const balanceCents = Math.round(inv.balanceDue * 100)
      if (balanceCents <= 0) continue
      const applyCents = Math.min(remaining, balanceCents)
      rows.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: applyCents / 100,
        balanceDue: inv.balanceDue,
      })
      remaining -= applyCents
    }
    return rows
  }, [sortedInvoices, parsedAmount, validAmount])

  const distributedTotal = distribution.reduce((s, d) => s + d.amount, 0)
  const overpayment = validAmount ? parsedAmount - distributedTotal : 0
  const referenceRequired = method === 'CHECK'
  const referenceMissing = referenceRequired && !reference.trim()

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  const handleFillTotal = () => {
    setTotalAmount(totalBalance.toFixed(2))
  }

  const handleSubmit = async () => {
    if (!validAmount) {
      setError('Enter a valid total amount.')
      return
    }
    if (parsedAmount > totalBalance + 0.005) {
      setError(
        `Total exceeds the combined balance due (${formatCurrency(totalBalance)}). Reduce the amount or deselect invoices.`
      )
      return
    }
    if (distribution.length === 0) {
      setError('No invoices have a balance to apply against.')
      return
    }
    if (referenceMissing) {
      setError('Check Number is required for check payments.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const receivedAtIso = receivedDate
        ? new Date(`${receivedDate}T00:00:00`).toISOString()
        : undefined
      const res = await fetch('/api/ops/invoices/batch-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: distribution.map((d) => d.invoiceId),
          method,
          reference: reference || undefined,
          receivedAt: receivedAtIso,
          notes: notes || undefined,
          totalAmount: parsedAmount,
          distribution: distribution.map((d) => ({
            invoiceId: d.invoiceId,
            amount: d.amount,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to record batch payment')
      }
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record batch payment')
    } finally {
      setSaving(false)
    }
  }

  const referenceLabel =
    ({
      CHECK: 'Check Number',
      ACH: 'ACH Confirmation #',
      WIRE: 'Wire Reference #',
      CREDIT_CARD: 'Transaction ID',
      CASH: 'Receipt # (optional)',
      OTHER: 'Reference # (optional)',
    } as Record<string, string>)[method] || 'Reference #'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Record Batch Payment — ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
      description="Apply one payment across multiple invoices. Distributed oldest-due-first."
      size="xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="panel panel-live p-3 flex items-start gap-2 text-sm text-data-negative">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Summary */}
        <div className="panel px-4 py-3 bg-surface-muted/50">
          <div className="flex justify-between text-sm">
            <span className="text-fg-muted">Selected invoices</span>
            <span className="font-semibold tabular-nums text-fg">{invoices.length}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-fg-muted">Combined balance due</span>
            <span className="font-bold tabular-nums text-data-negative">
              {formatCurrency(totalBalance)}
            </span>
          </div>
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Total Amount Received</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="input pl-7"
                  placeholder="0.00"
                />
              </div>
              <button
                type="button"
                onClick={handleFillTotal}
                className="btn btn-secondary btn-sm whitespace-nowrap"
              >
                Pay All
              </button>
            </div>
          </div>

          <div>
            <label className="label">Date Received</label>
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="input"
              max={todayStr()}
            />
          </div>

          <div>
            <label className="label">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="input"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">
              {referenceLabel}
              {referenceRequired && <span className="text-data-negative ml-1">*</span>}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input"
              placeholder={referenceRequired ? 'Required for checks' : 'Reference / confirmation #'}
              required={referenceRequired}
            />
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input"
            placeholder="Internal notes — e.g. envelope postmark, batch deposit slip..."
          />
        </div>

        {/* Distribution preview */}
        <div className="panel px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-fg">Distribution preview</h3>
            <span className="text-xs text-fg-subtle">Oldest due date first</span>
          </div>
          {!validAmount ? (
            <p className="text-sm text-fg-muted">Enter a total amount to preview the distribution.</p>
          ) : distribution.length === 0 ? (
            <p className="text-sm text-fg-muted">No invoices with a positive balance to receive payment.</p>
          ) : (
            <>
              <p className="text-xs text-fg-muted mb-3">
                Distributing <span className="font-semibold text-fg">{formatCurrency(distributedTotal)}</span> across{' '}
                <span className="font-semibold text-fg">{distribution.length}</span>{' '}
                invoice{distribution.length === 1 ? '' : 's'}
                {distribution.length < invoices.length && (
                  <span className="text-fg-subtle">
                    {' '}
                    ({invoices.length - distribution.length} not touched)
                  </span>
                )}
              </p>
              <div className="overflow-hidden border border-border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-fg-muted uppercase">Invoice</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-fg-muted uppercase">Balance</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-fg-muted uppercase">Applying</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-fg-muted uppercase">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {distribution.map((row) => {
                      const remaining = Math.max(0, row.balanceDue - row.amount)
                      const fullPay = Math.abs(remaining) < 0.005
                      return (
                        <tr key={row.invoiceId}>
                          <td className="px-3 py-2 font-medium text-fg">{row.invoiceNumber}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                            {formatCurrency(row.balanceDue)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-fg">
                            {formatCurrency(row.amount)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              fullPay ? 'text-data-positive' : 'text-fg-muted'
                            }`}
                          >
                            {fullPay ? 'PAID' : formatCurrency(remaining)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {overpayment > 0.005 && (
                <p className="text-xs text-data-negative mt-2">
                  Amount exceeds combined balance by {formatCurrency(overpayment)}. Reduce the amount or deselect invoices.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={
              saving ||
              !validAmount ||
              distribution.length === 0 ||
              referenceMissing ||
              overpayment > 0.005
            }
            className="btn btn-primary btn-sm flex-1 disabled:opacity-40"
          >
            {saving ? 'Recording...' : `Record Batch Payment (${formatCurrency(distributedTotal || 0)})`}
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
