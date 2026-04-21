'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { AccountStatement } from '@/components/AccountStatement'

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: string | null
  issuedAt: string
  paidAt: string | null
  orderNumber: string | null
  orderId: string | null
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysOverdue(dueDate: string | null) {
  if (!dueDate) return 0
  const d = new Date(dueDate)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

export default function PaymentsPage() {
  const { builder, loading: authLoading } = useAuth()
  const router = useRouter()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [paymentMethod, setPaymentMethod] = useState<'ACH' | 'CHECK' | 'CREDIT_CARD' | 'WIRE'>('ACH')
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (builder) {
      fetchInvoices()
    }
  }, [builder])

  async function fetchInvoices() {
    try {
      setLoading(true)
      const res = await fetch('/api/invoices')
      if (res.ok) {
        const data = await res.json()
        const unpaid = (data.invoices || [])
          .filter((inv: Invoice) => !['PAID', 'VOID', 'WRITE_OFF'].includes(inv.status))
          .sort((a: Invoice, b: Invoice) => {
            // Overdue first, then by due date
            const aOverdue = daysOverdue(a.dueDate)
            const bOverdue = daysOverdue(b.dueDate)
            if (aOverdue > 0 && bOverdue === 0) return -1
            if (aOverdue === 0 && bOverdue > 0) return 1
            if (a.dueDate && b.dueDate) {
              return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
            }
            return 0
          })
        setInvoices(unpaid)
      }
    } catch (err) {
      console.error('Failed to fetch invoices:', err)
    } finally {
      setLoading(false)
    }
  }

  const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.balanceDue > 0 ? inv.balanceDue : inv.total - inv.amountPaid), 0)
  const overdueInvoices = invoices.filter(inv => daysOverdue(inv.dueDate) > 0)
  const nextDueInvoice = invoices
    .filter(inv => inv.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0]

  const selectedInvoices = Array.from(selectedIds)
    .map(id => invoices.find(inv => inv.id === id))
    .filter(Boolean) as Invoice[]

  const selectedTotal = selectedInvoices.reduce(
    (sum, inv) => sum + (inv.balanceDue > 0 ? inv.balanceDue : inv.total - inv.amountPaid),
    0
  )

  const handleSelectAll = () => {
    if (selectedIds.size === invoices.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(invoices.map(inv => inv.id)))
    }
  }

  const toggleInvoice = (invoiceId: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(invoiceId)) {
      newSet.delete(invoiceId)
    } else {
      newSet.add(invoiceId)
    }
    setSelectedIds(newSet)
  }

  async function handlePayment() {
    if (selectedIds.size === 0) return

    try {
      setSubmitting(true)
      setErrorMessage('')
      setSuccessMessage('')

      const res = await fetch('/api/invoices/batch-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: Array.from(selectedIds),
          paymentMethod,
          reference: reference || undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setSuccessMessage(`Payment recorded! ${data.paid} invoice${data.paid !== 1 ? 's' : ''} paid totaling ${formatCurrency(data.totalAmount)}`)
        setSelectedIds(new Set())
        setReference('')
        setPaymentMethod('ACH')
        setTimeout(() => {
          setSuccessMessage('')
          fetchInvoices()
        }, 4000)
      } else {
        const error = await res.json()
        setErrorMessage(error.error || 'Payment failed')
      }
    } catch (err) {
      setErrorMessage('Failed to process payment')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ width: 32, height: 32, border: '4px solid #0f2a3e', borderTop: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!builder) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <p style={{ color: '#666', marginBottom: 16 }}>Please sign in to access your payments.</p>
        <Link href="/login" style={{ display: 'inline-block', padding: '8px 24px', backgroundColor: '#C6A24E', color: 'white', borderRadius: 8, fontWeight: 600, textDecoration: 'none' }}>Sign In</Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 8 }}>Batch Invoice Payments</h1>
        <p style={{ fontSize: 14, color: '#666' }}>Select invoices below to pay multiple invoices at once</p>
      </div>

      {/* Account Statement Section */}
      <AccountStatement />

      {/* Account Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e5e5', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Total Outstanding</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', marginBottom: 4 }}>{formatCurrency(totalOutstanding)}</p>
          <p style={{ fontSize: 12, color: '#666' }}>{invoices.length} unpaid invoice{invoices.length !== 1 ? 's' : ''}</p>
        </div>

        <div style={{ backgroundColor: 'white', border: '1px solid #e5e5e5', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Overdue Invoices</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: overdueInvoices.length > 0 ? '#E74C3C' : '#0f2a3e', marginBottom: 4 }}>
            {overdueInvoices.length}
          </p>
          <p style={{ fontSize: 12, color: '#666' }}>
            {overdueInvoices.length > 0
              ? `${formatCurrency(overdueInvoices.reduce((sum, inv) => sum + (inv.balanceDue > 0 ? inv.balanceDue : inv.total - inv.amountPaid), 0))}`
              : 'No overdue invoices'}
          </p>
        </div>

        <div style={{ backgroundColor: 'white', border: '1px solid #e5e5e5', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Next Payment Due</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', marginBottom: 4 }}>
            {nextDueInvoice ? formatDate(nextDueInvoice.dueDate) : '-'}
          </p>
          <p style={{ fontSize: 12, color: '#666' }}>
            {nextDueInvoice ? nextDueInvoice.invoiceNumber : 'No upcoming invoices'}
          </p>
        </div>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: 12, padding: 16, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, color: '#16a34a' }}>✓</span>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#15803d' }}>{successMessage}</p>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, color: '#dc2626' }}>!</span>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#991b1b' }}>{errorMessage}</p>
        </div>
      )}

      {/* Invoices Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading invoices...</div>
      ) : invoices.length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e5e5', borderRadius: 12, padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 8 }}>No unpaid invoices</p>
          <p style={{ fontSize: 14, color: '#666' }}>All your invoices have been paid or written off.</p>
        </div>
      ) : (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden' }}>
          {/* Table Header with Select All */}
          <div style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e5e5', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="checkbox"
              checked={selectedIds.size === invoices.length && invoices.length > 0}
              onChange={handleSelectAll}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#666' }}>
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select All'}
            </span>
          </div>

          {/* Invoice Rows */}
          <div>
            {invoices.map((invoice) => {
              const isSelected = selectedIds.has(invoice.id)
              const isOverdue = daysOverdue(invoice.dueDate) > 0
              const overdueDays = daysOverdue(invoice.dueDate)
              const amount = invoice.balanceDue > 0 ? invoice.balanceDue : invoice.total - invoice.amountPaid

              return (
                <div
                  key={invoice.id}
                  onClick={() => toggleInvoice(invoice.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '16px 20px',
                    borderBottom: '1px solid #e5e5e5',
                    backgroundColor: isSelected ? '#f0f9ff' : 'white',
                    cursor: 'pointer',
                    borderLeft: isOverdue ? '4px solid #E74C3C' : 'none',
                    transition: 'background-color 0.2s',
                    paddingLeft: isOverdue ? 16 : 20,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleInvoice(invoice.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#0f2a3e', fontFamily: 'monospace' }}>
                        {invoice.invoiceNumber}
                      </span>
                      {isOverdue && (
                        <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                          {overdueDays} day{overdueDays !== 1 ? 's' : ''} overdue
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {invoice.orderNumber && <span>{invoice.orderNumber} · </span>}
                      Issued {formatDate(invoice.issuedAt)}
                      {invoice.dueDate && <span> · Due {formatDate(invoice.dueDate)}</span>}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', minWidth: 100 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{formatCurrency(amount)}</p>
                    <p style={{ fontSize: 12, color: '#999' }}>Balance due</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sticky Payment Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'white',
          borderTop: '1px solid #e5e5e5',
          boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.08)',
          padding: '20px',
          zIndex: 40,
        }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 250 }}>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''} selected
              </p>
              <p style={{ fontSize: 18, fontWeight: 700, color: '#0f2a3e' }}>Total: {formatCurrency(selectedTotal)}</p>
            </div>

            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as any)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                color: '#111',
                backgroundColor: 'white',
                cursor: 'pointer',
              }}
            >
              <option value="ACH">ACH Transfer</option>
              <option value="CHECK">Check</option>
              <option value="CREDIT_CARD">Credit Card</option>
              <option value="WIRE">Wire Transfer</option>
            </select>

            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Reference (optional)"
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 14,
                color: '#111',
                minWidth: 200,
              }}
            />

            <button
              onClick={handlePayment}
              disabled={submitting}
              style={{
                padding: '10px 24px',
                backgroundColor: submitting ? '#9ca3af' : '#0f2a3e',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {submitting ? 'Processing...' : 'Pay Selected Invoices'}
            </button>
          </div>
        </div>
      )}

      {/* Padding to prevent overlap with sticky bar */}
      {selectedIds.size > 0 && <div style={{ height: 100 }} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
