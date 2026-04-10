'use client'

import { useState } from 'react'
import { Modal } from './Modal'

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
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Invoice Total</span>
              <span className="font-semibold">${invoice.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600">Balance Due</span>
              <span className="font-bold text-red-600">${invoice.balanceDue.toFixed(2)}</span>
            </div>
            {invoice.builderName && (
              <p className="text-xs text-gray-500 mt-2">{invoice.builderName}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Payment Amount</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm"
                  placeholder="0.00"
                />
              </div>
              <button
                onClick={handlePayFull}
                className="px-3 py-2 text-xs bg-gray-100 border rounded-lg hover:bg-gray-200 text-gray-700 font-medium whitespace-nowrap"
              >
                Pay in Full
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Reference # (optional)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Check number, transaction ID..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Payment notes..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[#27AE60] text-white rounded-lg text-sm font-medium hover:bg-[#229954] disabled:opacity-50"
            >
              {saving ? 'Recording...' : 'Record Payment'}
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
