'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

// ─── Types ──────────────────────────────────────────────────────────

interface QuoteItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  sku?: string
  location?: string
}

interface Quote {
  id: string
  quoteNumber: string
  status: string
  subtotal: number
  termAdjustment: number
  total: number
  validUntil?: string
  createdAt: string
  approvedAt?: string
  approvedBy?: string
  rejectedAt?: string
  rejectionReason?: string
  changeNotes?: string
  items: QuoteItem[]
  project?: {
    id: string
    name: string
    jobAddress?: string
    city?: string
    state?: string
    planName?: string
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  DRAFT: { bg: 'bg-surface-muted border-border', text: 'text-fg-muted', label: 'Draft', icon: '📝' },
  SENT: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', label: 'Ready for Review', icon: '📬' },
  APPROVED: { bg: 'bg-green-50 border-green-200', text: 'text-green-700', label: 'Approved', icon: '✅' },
  REJECTED: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', label: 'Rejected', icon: '❌' },
  EXPIRED: { bg: 'bg-surface-muted border-border', text: 'text-fg-muted', label: 'Expired', icon: '⏰' },
  ORDERED: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: 'Ordered', icon: '📦' },
}

// ─── Signature Pad Component ────────────────────────────────────────

function SignaturePad({ onSignature }: { onSignature: (data: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
  }, [getPos])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasDrawn(true)
  }, [isDrawing, getPos])

  const endDraw = useCallback(() => {
    setIsDrawing(false)
    if (hasDrawn && canvasRef.current) {
      onSignature(canvasRef.current.toDataURL('image/png'))
    }
  }, [hasDrawn, onSignature])

  function clearSignature() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
    onSignature('')
  }

  return (
    <div>
      <div className="relative border-2 border-dashed border-border-strong rounded-lg bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={560}
          height={160}
          className="w-full cursor-crosshair touch-none"
          style={{ height: '160px' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-fg-subtle text-sm">Sign here — draw your signature above</p>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button type="button" onClick={clearSignature}
          className="mt-2 text-xs text-fg-muted hover:text-red-500 transition-colors">
          Clear signature
        </button>
      )}
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function QuoteDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()
  const quoteId = params.id as string

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionInProgress, setActionInProgress] = useState(false)

  // Modal states
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showChangesModal, setShowChangesModal] = useState(false)
  const [signatureData, setSignatureData] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [changeNotes, setChangeNotes] = useState('')

  // Success state
  const [orderSuccess, setOrderSuccess] = useState<{ orderNumber: string; orderId: string } | null>(null)
  const [actionSuccess, setActionSuccess] = useState('')

  useEffect(() => {
    if (!quoteId) return
    fetchQuote()
  }, [quoteId])

  async function fetchQuote() {
    try {
      setLoading(true)
      const res = await fetch(`/api/quotes/${quoteId}`)
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Quote not found' : 'Failed to load quote')
      }
      const data = await res.json()
      setQuote(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove() {
    if (!signatureData) {
      setError('Please sign to approve the quote')
      return
    }

    try {
      setActionInProgress(true)
      setError('')
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', signature: signatureData }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to approve quote')
      }

      const data = await res.json()
      setShowApproveModal(false)
      setOrderSuccess({
        orderNumber: data.orderNumber,
        orderId: data.orderId,
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionInProgress(false)
    }
  }

  async function handleReject() {
    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejection')
      return
    }

    try {
      setActionInProgress(true)
      setError('')
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', changeNotes: rejectionReason }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reject quote')
      }

      setShowRejectModal(false)
      setActionSuccess('Quote has been rejected. Abel Lumber has been notified.')
      await fetchQuote()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionInProgress(false)
    }
  }

  async function handleRequestChanges() {
    if (!changeNotes.trim()) {
      setError('Please describe the changes you need')
      return
    }

    try {
      setActionInProgress(true)
      setError('')
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requestChanges', changeNotes }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit change request')
      }

      setShowChangesModal(false)
      setActionSuccess('Change request submitted. Abel Lumber will revise the quote.')
      await fetchQuote()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionInProgress(false)
    }
  }

  // ─── Loading / Error states ─────────────────────────────────────

  if (loading || authLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-muted rounded w-1/3" />
          <div className="h-4 bg-surface-muted rounded w-1/2" />
          <div className="grid grid-cols-2 gap-6 mt-6">
            <div className="h-40 bg-surface-muted rounded-xl" />
            <div className="h-40 bg-surface-muted rounded-xl" />
          </div>
          <div className="h-60 bg-surface-muted rounded-xl mt-4" />
        </div>
      </div>
    )
  }

  if (error && !quote) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <div className="text-5xl mb-4">📋</div>
        <h2 className="text-xl font-bold text-fg mb-2">Quote Not Found</h2>
        <p className="text-fg-muted mb-6">{error || 'This quote could not be loaded.'}</p>
        <Link href="/dashboard/quotes" className="text-[#0f2a3e] font-semibold hover:underline">
          &larr; Back to Quotes
        </Link>
      </div>
    )
  }

  if (!quote) return null

  // ─── Order Success state ────────────────────────────────────────

  if (orderSuccess) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-white rounded-xl border border-green-200 p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-green-700 mb-2">Quote Approved & Order Created</h2>
          <p className="text-fg-muted mb-6">
            Your signature has been recorded and the order has been submitted to the Abel Lumber fulfillment team.
          </p>
          <div className="bg-surface-muted rounded-lg p-4 mb-6">
            <p className="text-sm text-fg-muted">Order Number</p>
            <p className="text-xl font-mono font-bold text-[#0f2a3e]">{orderSuccess.orderNumber}</p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href={`/dashboard/orders/${orderSuccess.orderId}`}
              className="bg-[#C6A24E] hover:bg-[#A8882A] text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              View Order Details
            </Link>
            <Link href="/dashboard/quotes" className="text-[#0f2a3e] font-semibold hover:underline py-2">
              Back to Quotes
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ─── Quote Details ──────────────────────────────────────────────

  const cfg = STATUS_CONFIG[quote.status] || { bg: 'bg-surface-muted border-border', text: 'text-fg-muted', label: quote.status, icon: '📋' }
  const isExpired = quote.validUntil && new Date(quote.validUntil) < new Date()
  const canTakeAction = (quote.status === 'SENT' || quote.status === 'DRAFT') && !isExpired

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back Link */}
      <Link href="/dashboard/quotes" className="text-sm text-[#0f2a3e] hover:underline mb-4 inline-block">
        &larr; Back to Quotes
      </Link>

      {/* Action Success */}
      {actionSuccess && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-green-700 text-sm font-medium">{actionSuccess}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-fg">{quote.quoteNumber}</h1>
          <p className="text-sm text-fg-muted mt-1">
            Created {new Date(quote.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            {quote.project?.name && <span> &middot; {quote.project.name}</span>}
          </p>
        </div>
        <div className={`px-4 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 ${cfg.bg} ${cfg.text}`}>
          <span>{cfg.icon}</span>
          <span>{isExpired && quote.status === 'SENT' ? 'Expired' : cfg.label}</span>
        </div>
      </div>

      {/* Expiry Warning */}
      {isExpired && quote.status === 'SENT' && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
          <svg className="w-5 h-5 text-signal flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-amber-700 text-sm">This quote has expired. Please request an updated quote from Abel Lumber.</p>
        </div>
      )}

      {/* Action Banner for actionable quotes */}
      {canTakeAction && (
        <div className="mb-6 p-5 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-blue-900">This quote is ready for your review</h3>
              <p className="text-sm text-blue-700 mt-1">
                Review the items below, then approve with your signature, request changes, or decline.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowChangesModal(true)}
                className="px-4 py-2 border border-blue-300 text-blue-700 text-sm font-semibold rounded-lg hover:bg-blue-100 transition-colors"
              >
                Request Changes
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                className="px-4 py-2 border border-red-300 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={() => setShowApproveModal(true)}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
              >
                Approve & Sign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quote Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Project Info */}
        {quote.project && (
          <div className="bg-white rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-fg-muted mb-3">Project Information</h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-fg-muted">Project Name</p>
                <p className="text-sm font-semibold text-fg">{quote.project.name}</p>
              </div>
              {quote.project.jobAddress && (
                <div>
                  <p className="text-xs text-fg-muted">Address</p>
                  <p className="text-sm text-fg">
                    {quote.project.jobAddress}
                    {quote.project.city && `, ${quote.project.city}`}
                    {quote.project.state && `, ${quote.project.state}`}
                  </p>
                </div>
              )}
              {quote.project.planName && (
                <div>
                  <p className="text-xs text-fg-muted">Plan</p>
                  <p className="text-sm text-fg">{quote.project.planName}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quote Summary */}
        <div className="bg-white rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-fg-muted mb-3">Quote Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-fg-muted">Subtotal</span>
              <span className="text-sm font-medium text-fg">{fmt(quote.subtotal)}</span>
            </div>
            {quote.termAdjustment !== 0 && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-fg-muted">Payment Term Adjustment</span>
                <span className={`text-sm font-medium ${quote.termAdjustment > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {quote.termAdjustment > 0 ? '+' : ''}{fmt(quote.termAdjustment)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center border-t pt-2">
              <span className="text-sm font-bold text-fg">Total</span>
              <span className="text-lg font-bold text-[#0f2a3e]">{fmt(quote.total)}</span>
            </div>
            {quote.validUntil && (
              <div className="pt-2 border-t">
                <p className="text-xs text-fg-muted">Valid Until</p>
                <p className={`text-sm font-medium ${isExpired ? 'text-red-600' : 'text-fg'}`}>
                  {new Date(quote.validUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {isExpired && ' (Expired)'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rejection / Change Notes Info */}
      {quote.status === 'REJECTED' && quote.rejectionReason && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-xs text-red-600 font-semibold uppercase tracking-wide mb-1">Rejection Reason</p>
          <p className="text-sm text-red-800">{quote.rejectionReason}</p>
          {quote.rejectedAt && (
            <p className="text-xs text-red-500 mt-2">
              Rejected on {new Date(quote.rejectedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          )}
        </div>
      )}
      {quote.changeNotes && quote.status === 'DRAFT' && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-signal font-semibold uppercase tracking-wide mb-1">Changes Requested</p>
          <p className="text-sm text-amber-800">{quote.changeNotes}</p>
        </div>
      )}

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-border overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-fg-muted">Quote Items ({quote.items?.length || 0})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-muted">
              <tr className="text-xs text-fg-muted uppercase tracking-wider">
                <th className="px-5 py-3 text-left font-semibold">Description</th>
                {quote.items.some(i => i.location) && (
                  <th className="px-5 py-3 text-left font-semibold">Location</th>
                )}
                <th className="px-5 py-3 text-right font-semibold">Qty</th>
                <th className="px-5 py-3 text-right font-semibold">Unit Price</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quote.items.map(item => (
                <tr key={item.id} className="hover:bg-surface-muted/50">
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-fg">{item.description}</p>
                    {item.sku && <p className="text-[11px] text-fg-subtle font-mono mt-0.5">{item.sku}</p>}
                  </td>
                  {quote.items.some(i => i.location) && (
                    <td className="px-5 py-3 text-sm text-fg-muted">{item.location || '—'}</td>
                  )}
                  <td className="px-5 py-3 text-sm text-fg-muted text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-sm text-fg-muted text-right">{fmt(item.unitPrice)}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-fg text-right">{fmt(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-muted border-t border-border">
              <tr>
                <td colSpan={quote.items.some(i => i.location) ? 3 : 2} />
                <td className="px-5 py-3 text-sm font-semibold text-fg-muted text-right">Subtotal</td>
                <td className="px-5 py-3 text-sm font-semibold text-fg text-right">{fmt(quote.subtotal)}</td>
              </tr>
              {quote.termAdjustment !== 0 && (
                <tr>
                  <td colSpan={quote.items.some(i => i.location) ? 3 : 2} />
                  <td className="px-5 py-3 text-sm text-fg-muted text-right">Term Adj.</td>
                  <td className="px-5 py-3 text-sm text-fg-muted text-right">{fmt(quote.termAdjustment)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={quote.items.some(i => i.location) ? 3 : 2} />
                <td className="px-5 py-3 text-sm font-bold text-fg text-right">Total</td>
                <td className="px-5 py-3 text-lg font-bold text-[#0f2a3e] text-right">{fmt(quote.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Bottom Action Buttons (duplicate for convenience) */}
      {canTakeAction && (
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => setShowChangesModal(true)}
            className="flex-1 px-4 py-3 border border-border-strong text-fg-muted font-semibold rounded-lg hover:bg-surface-muted transition-colors text-center"
          >
            Request Changes
          </button>
          <button
            onClick={() => setShowRejectModal(true)}
            className="flex-1 px-4 py-3 border border-red-300 text-red-600 font-semibold rounded-lg hover:bg-red-50 transition-colors text-center"
          >
            Decline Quote
          </button>
          <button
            onClick={() => setShowApproveModal(true)}
            className="flex-[2] px-4 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors text-center"
          >
            Approve & Sign Quote
          </button>
        </div>
      )}

      {/* ──── Approve Modal (with Signature) ──── */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-fg">Approve Quote</h2>
              <button onClick={() => { setShowApproveModal(false); setError('') }}
                className="text-fg-subtle hover:text-fg-muted">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  By signing below, you approve quote <strong>{quote.quoteNumber}</strong> for{' '}
                  <strong>{fmt(quote.total)}</strong> and authorize Abel Lumber to create a sales order.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-2">Your Signature *</label>
                <SignaturePad onSignature={setSignatureData} />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowApproveModal(false); setError('') }} disabled={actionInProgress}
                  className="flex-1 px-4 py-2.5 border border-border-strong rounded-lg text-fg-muted font-semibold hover:bg-surface-muted disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleApprove} disabled={actionInProgress || !signatureData}
                  className="flex-1 px-4 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {actionInProgress && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {actionInProgress ? 'Approving...' : 'Approve Quote'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──── Reject Modal ──── */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-fg">Decline Quote</h2>
              <button onClick={() => { setShowRejectModal(false); setError('') }}
                className="text-fg-subtle hover:text-fg-muted">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-fg-muted">
                Please let us know why this quote doesn't work for you. This feedback helps us prepare better quotes in the future.
              </p>

              <div>
                <label className="block text-sm font-semibold text-fg mb-2">Reason for declining *</label>
                <textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="e.g., Pricing is above budget, need different products, project scope changed..."
                  rows={4}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowRejectModal(false); setError('') }} disabled={actionInProgress}
                  className="flex-1 px-4 py-2.5 border border-border-strong rounded-lg text-fg-muted font-semibold hover:bg-surface-muted disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleReject} disabled={actionInProgress || !rejectionReason.trim()}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {actionInProgress && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {actionInProgress ? 'Declining...' : 'Decline Quote'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──── Request Changes Modal ──── */}
      {showChangesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-fg">Request Changes</h2>
              <button onClick={() => { setShowChangesModal(false); setError('') }}
                className="text-fg-subtle hover:text-fg-muted">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-fg-muted">
                Describe what changes you'd like Abel Lumber to make. The quote will be returned to Draft status for revision.
              </p>

              <div>
                <label className="block text-sm font-semibold text-fg mb-2">What changes do you need? *</label>
                <textarea
                  value={changeNotes}
                  onChange={e => setChangeNotes(e.target.value)}
                  placeholder="e.g., Please swap the 2-panel doors for Shaker style, add hardware for 3 additional interior doors, adjust quantity on exterior door to 2..."
                  rows={4}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E] resize-none"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowChangesModal(false); setError('') }} disabled={actionInProgress}
                  className="flex-1 px-4 py-2.5 border border-border-strong rounded-lg text-fg-muted font-semibold hover:bg-surface-muted disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleRequestChanges} disabled={actionInProgress || !changeNotes.trim()}
                  className="flex-1 px-4 py-2.5 bg-[#C6A24E] text-white font-semibold rounded-lg hover:bg-[#A8882A] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {actionInProgress && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {actionInProgress ? 'Sending...' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
