'use client'

import { useState } from 'react'
import { Modal } from './Modal'
import { AlertTriangle } from 'lucide-react'

interface RecordPaymentModalProps {
  isOpen: boolean
  invoice: { id: string; invoiceNumber: string; total: number; balanceDue: number; builderName?: string } | null
  onClose: () => void
  onSuccess: () => void
}

const PAYMENT_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER']

export function RecordPaymentModal({ isOpen, invoice, onClose, onSuccess }: RecordPaymentModalProps) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CHECK')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!invoice) return
    const paymentAmount = parseFloat(amount)
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      setError('Please enter a valid payment amount')
      return
    }
    if (paymentAmount > invoice.balanceDue) {
      setError(`Payment amount cannot exceed balance due ($${invoice.balanceDue.toFixed(2)})`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: paymentAmount,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to record payment')
      }
      handleClose()
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setAmount('')
    setMethod('CHECK')
    setReference('')
    setNotes('')
    setError(null)
    onClose()
  }

  const handlePayFull = () => {
    if (invoice) setAmount(invoice.balanceDue.toFixed(2))
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Record Payment — ${invoice?.invoiceNumber || ''}`} size="md">
      {invoice && (
        <div className="space-y-4">
          {error && (
            <div className="panel panel-live p-3 flex items-start gap-2 text-sm text-data-negative">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="panel px-4 py-3 bg-surface-muted/50">
            <div className="flex justify-between text-sm">
              <span className="text-fg-muted">Invoice Total</span>
              <span className="font-semibold tabular-nums text-fg">${invoice.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-fg-muted">Balance Due</span>
              <span className="font-bold tabular-nums text-data-negative">${invoice.balanceDue.toFixed(2)}</span>
            </div>
            {invoice.builderName && (
              <p className="text-xs text-fg-subtle mt-2">{invoice.builderName}</p>
            )}
          </div>

          <div>
            <label className="label">Payment Amount</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input pl-7"
                  placeholder="0.00"
                />
              </div>
              <button onClick={handlePayFull} className="btn btn-secondary btn-sm whitespace-nowrap">
                Pay in Full
              </button>
            </div>
          </div>

          <div>
            <label className="label">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Reference # (optional)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input"
              placeholder="Check number, transaction ID..."
            />
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="input"
              placeholder="Payment notes..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="btn btn-primary btn-sm flex-1 disabled:opacity-40"
            >
              {saving ? 'Recording...' : 'Record Payment'}
            </button>
            <button onClick={handleClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
