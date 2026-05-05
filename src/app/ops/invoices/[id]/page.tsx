'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import AssignScheduleDialog from './AssignScheduleDialog'
import { RecordPaymentModal } from '@/app/ops/components/RecordPaymentModal'
import DocumentAttachments from '@/components/ops/DocumentAttachments'
import { useStaffAuth } from '@/hooks/useStaffAuth'

// Feature flag — default ON unless explicitly 'off'. Evaluated at bundle time.
const LABOR_SCHEDULE_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_LABOR_SCHEDULE !== 'off'

interface InvoiceItem {
  id: string
  invoiceId: string
  productId: string | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  lineType: string
  installationId?: string | null
  installationNumber?: string | null
  installationScheduledDate?: string | null
  installationStatus?: string | null
  installationCrewId?: string | null
  installationCrewName?: string | null
  scheduleEntryId?: string | null
  scheduleEntryScheduledDate?: string | null
  scheduleEntryStatus?: string | null
  scheduleEntryCrewId?: string | null
  scheduleEntryCrewName?: string | null
}

interface Invoice {
  id: string
  invoiceNumber: string
  builderId: string
  builderName?: string
  jobId: string | null
  subtotal: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  status: string
  paymentTerm: string
  issuedAt: string | null
  dueDate: string | null
  paidAt: string | null
  notes: string | null
  items: InvoiceItem[]
  payments: any[]
}

interface Crew {
  id: string
  name: string
  active?: boolean
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function statusColor(status: string) {
  switch (status) {
    case 'DRAFT': return 'bg-gray-100 text-gray-700'
    case 'ISSUED':
    case 'SENT': return 'bg-blue-100 text-blue-700'
    case 'OVERDUE': return 'bg-red-100 text-red-700'
    case 'PARTIALLY_PAID': return 'bg-orange-100 text-orange-700'
    case 'PAID': return 'bg-green-100 text-green-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function InvoiceDetailPage() {
  const params = useParams() as { id: string }
  const invoiceId = params.id

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [crews, setCrews] = useState<Crew[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogItem, setDialogItem] = useState<InvoiceItem | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [showWriteOffModal, setShowWriteOffModal] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [writeOffAmount, setWriteOffAmount] = useState('')
  const [writeOffReason, setWriteOffReason] = useState('')
  const [actionBusy, setActionBusy] = useState<null | 'send' | 'void' | 'write-off'>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Staff auth — used to gate the admin-only Write-Off button on the client.
  // The API still enforces it server-side; this just hides the control.
  const { staff } = useStaffAuth({ redirectOnFail: false })
  const isAdmin =
    Array.isArray(staff?.roles)
      ? staff!.roles.includes('ADMIN')
      : staff?.role === 'ADMIN'

  const fetchInvoice = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/ops/invoices/${invoiceId}`)
      if (!res.ok) throw new Error('Failed to fetch invoice')
      const data = await res.json()
      setInvoice(data)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const fetchCrews = async () => {
    try {
      const res = await fetch('/api/ops/crews?active=true')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setCrews(data)
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    if (!invoiceId) return
    fetchInvoice()
    fetchCrews()
  }, [invoiceId])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const onAssignSuccess = (_payload: any) => {
    setToast('Labor scheduled.')
    // Re-fetch to pick up the new linkage with crew/date on the row.
    fetchInvoice()
  }

  // ── Action handlers ─────────────────────────────────────────────────────
  // Send: fire the existing remind endpoint (handles email + audit), then
  // PATCH status ISSUED → SENT through the state-machine guard.
  const handleSend = async () => {
    if (!invoice) return
    setActionBusy('send')
    setActionError(null)
    try {
      const remindRes = await fetch(`/api/ops/invoices/${invoice.id}/remind`, {
        method: 'POST',
      })
      // 503 = kill switch; 400 = no email on builder. Both are acceptable —
      // we still flip status so ops can mark it sent and keep working.
      if (!remindRes.ok && remindRes.status !== 503 && remindRes.status !== 400) {
        const data = await remindRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send invoice')
      }

      const patchRes = await fetch(`/api/ops/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SENT' }),
      })
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to mark invoice as sent')
      }

      setShowSendModal(false)
      setToast('Invoice sent.')
      fetchInvoice()
    } catch (e: any) {
      setActionError(e?.message || 'Failed to send invoice')
    } finally {
      setActionBusy(null)
    }
  }

  const handleVoid = async () => {
    if (!invoice) return
    if (!voidReason.trim()) {
      setActionError('A reason is required.')
      return
    }
    setActionBusy('void')
    setActionError(null)
    try {
      const res = await fetch(`/api/ops/invoices/${invoice.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.message || 'Failed to void invoice')
      }
      setShowVoidModal(false)
      setVoidReason('')
      setToast('Invoice voided.')
      fetchInvoice()
    } catch (e: any) {
      setActionError(e?.message || 'Failed to void invoice')
    } finally {
      setActionBusy(null)
    }
  }

  const handleWriteOff = async () => {
    if (!invoice) return
    const amt = parseFloat(writeOffAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setActionError('Enter a positive amount.')
      return
    }
    if (!writeOffReason.trim()) {
      setActionError('A reason is required.')
      return
    }
    setActionBusy('write-off')
    setActionError(null)
    try {
      const res = await fetch(`/api/ops/invoices/${invoice.id}/write-off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, reason: writeOffReason.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.message || 'Failed to write off invoice')
      }
      setShowWriteOffModal(false)
      setWriteOffAmount('')
      setWriteOffReason('')
      setToast('Invoice written off.')
      fetchInvoice()
    } catch (e: any) {
      setActionError(e?.message || 'Failed to write off invoice')
    } finally {
      setActionBusy(null)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><p className="text-gray-500">Loading invoice...</p></div>
  }
  if (error || !invoice) {
    return (
      <div className="space-y-4">
        <Link href="/ops/invoices" className="text-sm text-[#0f2a3e] hover:underline">&larr; Back to invoices</Link>
        <p className="text-red-600">{error || 'Invoice not found.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/ops/invoices" className="text-sm text-[#0f2a3e] hover:underline">&larr; Back to invoices</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {invoice.builderName || 'Builder'}
            {invoice.jobId && (
              <> &middot; <Link href={`/ops/jobs/${invoice.jobId}`} className="text-[#0f2a3e] hover:underline">Job</Link></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <span className={`px-3 py-1 text-xs font-medium rounded ${statusColor(invoice.status)}`}>
            {invoice.status.replace(/_/g, ' ')}
          </span>

          {/* FIX-13 — Download PDF */}
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 bg-white rounded hover:bg-gray-50 font-medium"
          >
            Download PDF
          </a>

          {/* FIX-14 — Send Invoice (first send, ISSUED → SENT) */}
          {invoice.status === 'ISSUED' && (
            <button
              type="button"
              onClick={() => { setActionError(null); setShowSendModal(true) }}
              className="px-3 py-1.5 text-sm bg-[#0f2a3e] text-white rounded hover:bg-[#0a1a28] font-medium"
            >
              Send Invoice
            </button>
          )}

          {invoice.status !== 'PAID' && Number(invoice.balanceDue || 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="px-3 py-1.5 text-sm bg-[#0f2a3e] text-white rounded hover:bg-[#0a1a28] font-medium"
            >
              Record Payment
            </button>
          )}

          {/* FIX-15 — Void */}
          {!['PAID', 'VOID', 'WRITE_OFF'].includes(invoice.status) && (
            <button
              type="button"
              onClick={() => { setActionError(null); setVoidReason(''); setShowVoidModal(true) }}
              className="px-3 py-1.5 text-sm border border-red-300 text-red-700 bg-white rounded hover:bg-red-50 font-medium"
            >
              Void
            </button>
          )}

          {/* FIX-15 — Write-Off (ADMIN only) */}
          {isAdmin && !['PAID', 'VOID', 'WRITE_OFF'].includes(invoice.status) && (
            <button
              type="button"
              onClick={() => {
                setActionError(null)
                setWriteOffAmount(Number(invoice.balanceDue || 0).toFixed(2))
                setWriteOffReason('')
                setShowWriteOffModal(true)
              }}
              className="px-3 py-1.5 text-sm border border-red-300 text-red-700 bg-white rounded hover:bg-red-50 font-medium"
            >
              Write Off
            </button>
          )}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Subtotal</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(invoice.subtotal)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Total</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(invoice.total)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Paid</p>
          <p className="text-xl font-bold text-[#27AE60]">{formatCurrency(invoice.amountPaid)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Balance Due</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(invoice.balanceDue)}</p>
          {invoice.dueDate && <p className="text-xs text-gray-500 mt-1">Due {formatDate(invoice.dueDate)}</p>}
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Line Items</h3>
          {LABOR_SCHEDULE_ENABLED && (
            <p className="text-xs text-gray-500">
              Labor lines are clickable &mdash; click to assign crew + date.
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Schedule</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoice.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-400 text-sm">
                    No line items.
                  </td>
                </tr>
              )}
              {invoice.items.map(item => {
                const isLabor = item.lineType === 'LABOR'
                const hasAssignment = Boolean(item.installationId || item.scheduleEntryId)
                const crewName = item.installationCrewName || item.scheduleEntryCrewName
                const whenIso = item.installationScheduledDate || item.scheduleEntryScheduledDate
                const clickable = isLabor && LABOR_SCHEDULE_ENABLED

                return (
                  <tr
                    key={item.id}
                    onClick={clickable ? () => setDialogItem(item) : undefined}
                    className={
                      clickable
                        ? 'hover:bg-blue-50 cursor-pointer transition-colors'
                        : ''
                    }
                    title={clickable
                      ? (hasAssignment ? 'Click to reassign' : 'Click to schedule')
                      : undefined}
                  >
                    <td className="px-5 py-3 text-gray-900">
                      <div className="flex items-center gap-2">
                        <span>{item.description}</span>
                        {isLabor && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-blue-100 text-blue-700 rounded">
                            labor
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">{item.quantity}</td>
                    <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(item.unitPrice)}</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{formatCurrency(item.lineTotal)}</td>
                    <td className="px-5 py-3 text-gray-700">
                      {!clickable && <span className="text-gray-300">—</span>}
                      {clickable && hasAssignment && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-700">
                            <span className="font-medium">{crewName || 'Crew'}</span>
                            {whenIso && <> &middot; {formatDate(whenIso)}</>}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDialogItem(item) }}
                            className="px-2 py-0.5 text-[11px] border border-gray-300 rounded hover:bg-gray-50"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                      {clickable && !hasAssignment && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDialogItem(item) }}
                          className="px-3 py-1 text-xs bg-[#0f2a3e] text-white rounded hover:bg-[#0a1a28] font-medium"
                        >
                          Schedule
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payments */}
      {invoice.payments.length > 0 && (
        <div className="bg-white rounded-xl border">
          <div className="px-5 py-3 border-b">
            <h3 className="font-semibold text-gray-900">Payments</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                  <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                  <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoice.payments.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-5 py-2 text-gray-700">{formatDate(p.receivedAt)}</td>
                    <td className="px-5 py-2 text-gray-700">{p.method}</td>
                    <td className="px-5 py-2 text-gray-500">{p.reference || '—'}</td>
                    <td className="px-5 py-2 text-right font-medium">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Document attachments — FIX-1 from AEGIS-OPS-FINANCE-HANDOFF */}
      <div className="bg-white rounded-lg shadow-sm border p-5 mb-6">
        <DocumentAttachments
          entityType="invoice"
          entityId={invoice.id}
          defaultCategory="INVOICE"
          allowedCategories={['INVOICE', 'CONTRACT', 'CORRESPONDENCE', 'REPORT', 'GENERAL']}
        />
      </div>

      {/* Assign dialog */}
      {LABOR_SCHEDULE_ENABLED && (
        <AssignScheduleDialog
          open={!!dialogItem}
          onClose={() => setDialogItem(null)}
          onSuccess={onAssignSuccess}
          invoiceId={invoice.id}
          item={dialogItem}
          crews={crews}
        />
      )}

      {/* Record Payment modal */}
      <RecordPaymentModal
        isOpen={showPaymentModal}
        invoice={{
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          total: Number(invoice.total),
          balanceDue: Number(invoice.balanceDue),
          builderName: invoice.builderName,
        }}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={() => {
          setShowPaymentModal(false)
          setToast('Payment recorded.')
          fetchInvoice()
        }}
      />

      {/* Send Invoice confirmation */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Send Invoice</h3>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-gray-700">
              <p>
                Email invoice <strong>{invoice.invoiceNumber}</strong> to{' '}
                <strong>{invoice.builderName || 'the builder'}</strong> and
                mark it as <strong>SENT</strong>?
              </p>
              <p className="text-xs text-gray-500">
                If builder emails are disabled or no contact email is on file,
                the status will still be updated so you can keep working.
              </p>
              {actionError && (
                <p className="text-sm text-red-600">{actionError}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2 rounded-b-xl">
              <button
                type="button"
                disabled={actionBusy === 'send'}
                onClick={() => setShowSendModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy === 'send'}
                onClick={handleSend}
                className="px-3 py-1.5 text-sm bg-[#0f2a3e] text-white rounded hover:bg-[#0a1a28] disabled:opacity-50 font-medium"
              >
                {actionBusy === 'send' ? 'Sending...' : 'Send Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void confirmation */}
      {showVoidModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Void Invoice</h3>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-gray-700">
              <p>
                You are about to void invoice <strong>{invoice.invoiceNumber}</strong>.
                This is logged in the audit trail.
              </p>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  Reason <span className="text-red-600">*</span>
                </span>
                <textarea
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]"
                  placeholder="Why is this invoice being voided?"
                />
              </label>
              {actionError && (
                <p className="text-sm text-red-600">{actionError}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2 rounded-b-xl">
              <button
                type="button"
                disabled={actionBusy === 'void'}
                onClick={() => setShowVoidModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy === 'void' || !voidReason.trim()}
                onClick={handleVoid}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {actionBusy === 'void' ? 'Voiding...' : 'Void Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Write-Off confirmation (admin-only) */}
      {showWriteOffModal && isAdmin && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Write Off Invoice</h3>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-gray-700">
              <p>
                Write off invoice <strong>{invoice.invoiceNumber}</strong>.
                Outstanding balance: <strong>{formatCurrency(Number(invoice.balanceDue || 0))}</strong>.
              </p>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  Amount <span className="text-red-600">*</span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={writeOffAmount}
                  onChange={(e) => setWriteOffAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  Reason <span className="text-red-600">*</span>
                </span>
                <textarea
                  value={writeOffReason}
                  onChange={(e) => setWriteOffReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]"
                  placeholder="Why is this balance being written off?"
                />
              </label>
              <p className="text-xs text-gray-500">
                This is an ADMIN-only action and is permanent. The audit trail
                will record the amount, reason, and your staff ID.
              </p>
              {actionError && (
                <p className="text-sm text-red-600">{actionError}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2 rounded-b-xl">
              <button
                type="button"
                disabled={actionBusy === 'write-off'}
                onClick={() => setShowWriteOffModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  actionBusy === 'write-off' ||
                  !writeOffReason.trim() ||
                  !(parseFloat(writeOffAmount) > 0)
                }
                onClick={handleWriteOff}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {actionBusy === 'write-off' ? 'Writing off...' : 'Write Off'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
