'use client'

/**
 * RecordVendorPaymentModal — companion to RecordPaymentModal but for AP.
 *
 * FIX-3 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). Lets a user
 * record an outgoing payment to a vendor, optionally linked to a PO.
 *
 * Usage:
 *   <RecordVendorPaymentModal
 *     isOpen={open}
 *     onClose={() => setOpen(false)}
 *     onSuccess={() => refetch()}
 *     vendor={presetVendor}            // optional — locks the vendor field
 *     purchaseOrder={presetPO}         // optional — locks the PO field
 *   />
 *
 * If neither preset is supplied, the modal lets the user pick a vendor
 * (and optionally a PO for that vendor) inline.
 */
import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { AlertTriangle, Search } from 'lucide-react'

const PAYMENT_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER'] as const

interface VendorOption {
  id: string
  name: string
  code?: string
}

interface POOption {
  id: string
  poNumber: string
  vendorId: string
  total?: number
  status?: string
}

interface RecordVendorPaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  vendor?: VendorOption | null
  purchaseOrder?: POOption | null
}

export function RecordVendorPaymentModal({
  isOpen,
  onClose,
  onSuccess,
  vendor: presetVendor,
  purchaseOrder: presetPO,
}: RecordVendorPaymentModalProps) {
  const todayStr = () => new Date().toISOString().split('T')[0]

  // Form state
  const [vendor, setVendor] = useState<VendorOption | null>(presetVendor || null)
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([])
  const [vendorOptionsLoading, setVendorOptionsLoading] = useState(false)

  const [po, setPO] = useState<POOption | null>(presetPO || null)
  const [poOptions, setPOOptions] = useState<POOption[]>([])

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CHECK')
  const [checkNumber, setCheckNumber] = useState('')
  const [reference, setReference] = useState('')
  const [memo, setMemo] = useState('')
  const [paidDate, setPaidDate] = useState<string>(todayStr())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open/close
  useEffect(() => {
    if (!isOpen) {
      setAmount('')
      setMethod('CHECK')
      setCheckNumber('')
      setReference('')
      setMemo('')
      setPaidDate(todayStr())
      setError(null)
      if (!presetVendor) {
        setVendor(null)
        setVendorSearch('')
      }
      if (!presetPO) setPO(null)
    } else {
      setVendor(presetVendor || null)
      setPO(presetPO || null)
    }
  }, [isOpen, presetVendor, presetPO])

  // Vendor search — debounced lookup against /api/ops/vendors
  useEffect(() => {
    if (presetVendor) return // locked, no need to search
    if (!isOpen) return
    const q = vendorSearch.trim()
    if (q.length < 2) {
      setVendorOptions([])
      return
    }
    const t = setTimeout(async () => {
      setVendorOptionsLoading(true)
      try {
        const res = await fetch(
          `/api/ops/vendors?search=${encodeURIComponent(q)}&status=active&limit=15`,
        )
        if (res.ok) {
          const data = await res.json()
          const list: VendorOption[] = Array.isArray(data) ? data : data.vendors || data.data || []
          setVendorOptions(list)
        }
      } catch {
        setVendorOptions([])
      } finally {
        setVendorOptionsLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [vendorSearch, isOpen, presetVendor])

  // Load vendor's open POs once a vendor is selected
  useEffect(() => {
    if (presetPO) return
    if (!vendor) {
      setPOOptions([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          `/api/ops/purchasing?vendorId=${vendor.id}&limit=50`,
        )
        if (res.ok) {
          const data = await res.json()
          const list: POOption[] = Array.isArray(data)
            ? data
            : data.purchaseOrders || data.data || []
          if (!cancelled) setPOOptions(list)
        }
      } catch {
        if (!cancelled) setPOOptions([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [vendor, presetPO])

  const referenceLabel = ({
    CHECK: 'Check Number',
    ACH: 'ACH Trace #',
    WIRE: 'Wire Confirmation #',
    CREDIT_CARD: 'Transaction ID',
    CASH: 'Receipt # (optional)',
    OTHER: 'Reference # (optional)',
  } as Record<string, string>)[method] || 'Reference #'

  const handleSubmit = async () => {
    setError(null)
    if (!vendor) return setError('Pick a vendor first')
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) return setError('Amount must be positive')
    if (method === 'CHECK' && !checkNumber.trim()) {
      return setError('Check Number is required for check payments')
    }

    setSaving(true)
    try {
      const paidAtIso = paidDate
        ? new Date(`${paidDate}T00:00:00`).toISOString()
        : undefined
      const res = await fetch('/api/ops/purchasing/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: vendor.id,
          purchaseOrderId: po?.id,
          amount: num,
          method,
          checkNumber: checkNumber.trim() || undefined,
          reference: reference.trim() || undefined,
          memo: memo.trim() || undefined,
          paidAt: paidAtIso,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onSuccess()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Record Vendor Payment" size="md">
      <div className="space-y-4">
        {error && (
          <div className="panel panel-live p-3 flex items-start gap-2 text-sm text-data-negative">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Vendor */}
        <div>
          <label className="label">Vendor *</label>
          {vendor ? (
            <div className="flex items-center justify-between panel p-2.5">
              <div className="text-sm font-medium text-fg truncate">
                {vendor.name}
                {vendor.code && (
                  <span className="ml-2 text-xs text-fg-subtle font-mono">{vendor.code}</span>
                )}
              </div>
              {!presetVendor && (
                <button
                  type="button"
                  onClick={() => {
                    setVendor(null)
                    setVendorSearch('')
                    setPO(null)
                  }}
                  className="text-xs text-fg-subtle hover:text-fg"
                >
                  change
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
                <input
                  type="text"
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  placeholder="Search vendor by name or code…"
                  className="input pl-9"
                  autoFocus
                />
              </div>
              {vendorSearch.trim().length >= 2 && (
                <div className="panel max-h-40 overflow-y-auto">
                  {vendorOptionsLoading ? (
                    <div className="px-3 py-2 text-sm text-fg-muted">Searching…</div>
                  ) : vendorOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-fg-muted">No matches</div>
                  ) : (
                    vendorOptions.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setVendor(v)
                          setVendorSearch('')
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-sm text-fg"
                      >
                        {v.name}
                        {v.code && (
                          <span className="ml-2 text-xs text-fg-subtle font-mono">{v.code}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* PO (optional) */}
        {vendor && (
          <div>
            <label className="label">Purchase Order (optional)</label>
            {po ? (
              <div className="flex items-center justify-between panel p-2.5">
                <div className="text-sm text-fg">
                  <span className="font-mono font-semibold">{po.poNumber}</span>
                  {typeof po.total === 'number' && (
                    <span className="ml-2 text-xs text-fg-subtle">
                      ${po.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                {!presetPO && (
                  <button
                    type="button"
                    onClick={() => setPO(null)}
                    className="text-xs text-fg-subtle hover:text-fg"
                  >
                    clear
                  </button>
                )}
              </div>
            ) : (
              <select
                value=""
                onChange={(e) => {
                  const found = poOptions.find((p) => p.id === e.target.value) || null
                  setPO(found)
                }}
                className="input"
                disabled={!presetVendor && poOptions.length === 0}
              >
                <option value="">
                  {poOptions.length === 0
                    ? 'No POs found for this vendor — leave blank'
                    : 'Pick a PO (or leave blank)'}
                </option>
                {poOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.poNumber}
                    {typeof p.total === 'number'
                      ? ` — $${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                      : ''}
                    {p.status ? ` · ${p.status}` : ''}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-fg-subtle mt-1">
              Leave blank for utilities, rent, or any vendor charge without a PO.
            </p>
          </div>
        )}

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount *</label>
            <div className="relative">
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
          </div>
          <div>
            <label className="label">Date Paid</label>
            <input
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              className="input"
              max={todayStr()}
            />
          </div>
        </div>

        {/* Method */}
        <div>
          <label className="label">Payment Method *</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
            className="input"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Check Number (when CHECK) */}
        {method === 'CHECK' && (
          <div>
            <label className="label">
              Check Number <span className="text-data-negative ml-1">*</span>
            </label>
            <input
              type="text"
              value={checkNumber}
              onChange={(e) => setCheckNumber(e.target.value)}
              className="input"
              placeholder="e.g. 1042"
              required
            />
          </div>
        )}

        {/* Reference */}
        <div>
          <label className="label">{referenceLabel}</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="input"
            placeholder={referenceLabel.replace(/\(optional\)/, '').trim() + '…'}
          />
        </div>

        {/* Memo */}
        <div>
          <label className="label">Memo (optional)</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            className="input"
            placeholder="Internal notes about this payment…"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving || !vendor || !amount}
            className="btn btn-primary btn-sm flex-1 disabled:opacity-40"
          >
            {saving ? 'Recording…' : 'Record Payment'}
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
