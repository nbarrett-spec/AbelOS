'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import AssignScheduleDialog from './AssignScheduleDialog'

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
        <span className={`px-3 py-1 text-xs font-medium rounded ${statusColor(invoice.status)}`}>
          {invoice.status.replace(/_/g, ' ')}
        </span>
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
