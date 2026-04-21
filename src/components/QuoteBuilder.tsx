'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { PAYMENT_TERM_LABELS } from '@/lib/constants'

interface QuoteItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  location: string | null
  isUpgrade: boolean
  upgradeAdder: number | null
}

interface QuoteBuilderProps {
  quoteId: string
  quoteNumber: string
  items: QuoteItem[]
  subtotal: number
  termAdjustment: number
  total: number
  paymentTerm: string
  validUntil: string
  onApprove: () => void
}

export default function QuoteBuilder({
  quoteId,
  quoteNumber,
  items,
  subtotal,
  termAdjustment,
  total,
  paymentTerm,
  validUntil,
  onApprove,
}: QuoteBuilderProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['all'])
  )
  const [isDownloading, setIsDownloading] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [signature, setSignature] = useState('')
  const [changeNotes, setChangeNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Group items by location
  const grouped = items.reduce(
    (acc, item) => {
      const loc = item.location || 'General'
      if (!acc[loc]) acc[loc] = []
      acc[loc].push(item)
      return acc
    },
    {} as Record<string, QuoteItem[]>
  )

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const termLabel =
    PAYMENT_TERM_LABELS[paymentTerm as keyof typeof PAYMENT_TERM_LABELS] ||
    paymentTerm

  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
      const s = document.createElement('script')
      s.src = src
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`Failed to load ${src}`))
      document.head.appendChild(s)
    })
  }

  const handleDownloadPDF = async () => {
    try {
      setIsDownloading(true)

      // Load jsPDF and autoTable from CDN
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')

      const { jsPDF } = (window as any).jspdf
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()

      // --- Header ---
      doc.setFontSize(24)
      doc.setTextColor(27, 79, 114) // brand
      doc.text('ABEL LUMBER', 14, 22)
      doc.setFontSize(9)
      doc.setTextColor(120, 120, 120)
      doc.text('Building Materials & Door Solutions', 14, 28)

      // Quote info right side
      doc.setFontSize(14)
      doc.setTextColor(27, 79, 114)
      doc.text(`Quote ${quoteNumber}`, pageWidth - 14, 22, { align: 'right' })
      doc.setFontSize(9)
      doc.setTextColor(100, 100, 100)
      doc.text(`Valid until ${new Date(validUntil).toLocaleDateString()}`, pageWidth - 14, 28, { align: 'right' })
      doc.text(`Payment Term: ${termLabel}`, pageWidth - 14, 33, { align: 'right' })

      // Divider
      doc.setDrawColor(27, 79, 114)
      doc.setLineWidth(0.5)
      doc.line(14, 37, pageWidth - 14, 37)

      // --- Line Items Table ---
      let startY = 44
      const tableData: any[] = []

      Object.entries(grouped).forEach(([location, locationItems]) => {
        // Room header row
        const sectionTotal = locationItems.reduce((s, i) => s + i.lineTotal, 0)
        tableData.push([{
          content: `${location}  —  ${formatCurrency(sectionTotal)}`,
          colSpan: 4,
          styles: { fontStyle: 'bold', fillColor: [240, 244, 248], textColor: [27, 79, 114], fontSize: 9 }
        }])

        // Item rows
        locationItems.forEach(item => {
          tableData.push([
            item.description,
            { content: String(item.quantity), styles: { halign: 'center' } },
            { content: formatCurrency(item.unitPrice), styles: { halign: 'right' } },
            { content: formatCurrency(item.lineTotal), styles: { halign: 'right', fontStyle: 'bold' } },
          ])
        })
      })

      // Use autoTable
      ;(doc as any).autoTable({
        startY,
        head: [['Description', 'Qty', 'Unit Price', 'Total']],
        body: tableData,
        theme: 'grid',
        headStyles: {
          fillColor: [27, 79, 114],
          textColor: [255, 255, 255],
          fontSize: 9,
          fontStyle: 'bold',
        },
        styles: {
          fontSize: 8,
          cellPadding: 3,
        },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 22, halign: 'center' },
          2: { cellWidth: 30, halign: 'right' },
          3: { cellWidth: 30, halign: 'right' },
        },
        margin: { left: 14, right: 14 },
      })

      // --- Totals ---
      const finalY = (doc as any).lastAutoTable.finalY + 8

      doc.setFontSize(10)
      doc.setTextColor(80, 80, 80)
      doc.text('Subtotal:', pageWidth - 74, finalY)
      doc.text(formatCurrency(subtotal), pageWidth - 14, finalY, { align: 'right' })

      if (termAdjustment !== 0) {
        doc.text('Term adjustment:', pageWidth - 74, finalY + 6)
        doc.text(
          `${termAdjustment < 0 ? '-' : '+'}${formatCurrency(Math.abs(termAdjustment))}`,
          pageWidth - 14, finalY + 6, { align: 'right' }
        )
      }

      doc.setDrawColor(27, 79, 114)
      doc.line(pageWidth - 80, finalY + (termAdjustment !== 0 ? 10 : 4), pageWidth - 14, finalY + (termAdjustment !== 0 ? 10 : 4))

      const totalY = finalY + (termAdjustment !== 0 ? 17 : 11)
      doc.setFontSize(14)
      doc.setTextColor(27, 79, 114)
      doc.setFont(undefined as any, 'bold')
      doc.text('Total:', pageWidth - 74, totalY)
      doc.text(formatCurrency(total), pageWidth - 14, totalY, { align: 'right' })

      // --- Footer ---
      const footerY = doc.internal.pageSize.getHeight() - 15
      doc.setFontSize(8)
      doc.setFont(undefined as any, 'normal')
      doc.setTextColor(150, 150, 150)
      doc.text('Abel Lumber — Your Trusted Building Materials Partner', 14, footerY)
      doc.text('This quote is valid for 30 days from the date above.', 14, footerY + 4)

      // Save
      doc.save(`${quoteNumber}.pdf`)
    } catch (error: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('PDF download error:', error?.message || error, error?.stack)
      }
      alert('Failed to generate PDF. Please try again.')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleApproveQuote = async () => {
    if (!signature.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', signature: signature.trim() }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setActionResult({ type: 'success', message: `Quote approved! Order ${data.orderNumber} has been created.` })
        setShowApproveModal(false)
        onApprove()
      } else {
        setActionResult({ type: 'error', message: data.error || 'Failed to approve' })
      }
    } catch {
      setActionResult({ type: 'error', message: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRejectQuote = async () => {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', changeNotes }),
      })
      const data = await res.json()
      if (res.ok) {
        setActionResult({ type: 'success', message: 'Quote rejected.' })
        setShowRejectModal(false)
      } else {
        setActionResult({ type: 'error', message: data.error || 'Failed to reject' })
      }
    } catch {
      setActionResult({ type: 'error', message: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestChanges = async () => {
    if (!changeNotes.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requestChanges', changeNotes }),
      })
      const data = await res.json()
      if (res.ok) {
        setActionResult({ type: 'success', message: 'Change request submitted to Abel Lumber.' })
        setShowRejectModal(false)
      } else {
        setActionResult({ type: 'error', message: data.error || 'Failed' })
      }
    } catch {
      setActionResult({ type: 'error', message: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Action Result Banner */}
      {actionResult && (
        <div className={`rounded-xl p-4 flex items-center justify-between ${
          actionResult.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <p className={actionResult.type === 'success' ? 'text-green-700' : 'text-red-700'}>
            {actionResult.message}
          </p>
          <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {/* Approve Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Approve Quote {quoteNumber}</h3>
            <p className="text-sm text-gray-500 mb-4">
              By signing below, you authorize Abel Lumber to proceed with this order for <strong>{formatCurrency(total)}</strong>.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name (E-Signature)</label>
              <input
                type="text"
                value={signature}
                onChange={e => setSignature(e.target.value)}
                placeholder="Type your full name to sign"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#0f2a3e] focus:ring-0 text-lg font-serif italic"
              />
              {signature && (
                <div className="mt-2 p-3 bg-gray-50 rounded-lg border">
                  <p className="text-xs text-gray-400">Signature Preview</p>
                  <p className="text-2xl font-serif italic text-[#0f2a3e] mt-1">{signature}</p>
                </div>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-700">
                This is a binding approval. An order will be created and Abel Lumber will begin processing your materials.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowApproveModal(false); setSignature('') }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveQuote}
                disabled={!signature.trim() || submitting}
                className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl disabled:opacity-50"
              >
                {submitting ? 'Processing...' : 'Sign & Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject / Request Changes Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Request Changes or Reject</h3>
            <p className="text-sm text-gray-500 mb-4">
              Let Abel Lumber know what needs to change, or reject this quote entirely.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={changeNotes}
                onChange={e => setChangeNotes(e.target.value)}
                placeholder="Describe what changes you need..."
                rows={4}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#0f2a3e] focus:ring-0"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setChangeNotes('') }}
                className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={!changeNotes.trim() || submitting}
                className="flex-1 px-4 py-2.5 bg-[#0f2a3e] hover:bg-[#0a1a28] text-white font-semibold rounded-xl disabled:opacity-50"
              >
                {submitting ? 'Sending...' : 'Request Changes'}
              </button>
              <button
                onClick={handleRejectQuote}
                disabled={submitting}
                className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quote Header */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-brand">
              Quote {quoteNumber}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Valid until {new Date(validUntil).toLocaleDateString()}
            </p>
          </div>
          <span className="px-4 py-1.5 bg-brand/10 text-brand rounded-full text-sm font-medium">
            {termLabel}
          </span>
        </div>

        {/* Totals Summary */}
        <div className="mt-6 bg-gray-50 rounded-xl p-4">
          <div className="flex justify-between text-sm py-1">
            <span className="text-gray-600">
              Subtotal ({items.length} items)
            </span>
            <span className="font-medium">{formatCurrency(subtotal)}</span>
          </div>
          {termAdjustment !== 0 && (
            <div className="flex justify-between text-sm py-1">
              <span className="text-gray-600">
                Payment term {termAdjustment < 0 ? 'discount' : 'adjustment'}
              </span>
              <span
                className={
                  termAdjustment < 0
                    ? 'text-green-600 font-medium'
                    : 'text-gray-600'
                }
              >
                {termAdjustment < 0 ? '-' : '+'}
                {formatCurrency(Math.abs(termAdjustment))}
              </span>
            </div>
          )}
          <div className="border-t mt-2 pt-2 flex justify-between">
            <span className="text-lg font-semibold text-navy">Total</span>
            <span className="text-2xl font-bold text-brand">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Line Items by Room */}
      {Object.entries(grouped).map(([location, locationItems]) => {
        const sectionTotal = locationItems.reduce(
          (s, i) => s + i.lineTotal,
          0
        )
        const isExpanded = expandedSections.has('all') || expandedSections.has(location)

        return (
          <div key={location} className="bg-white rounded-xl border overflow-hidden">
            <button
              onClick={() => toggleSection(location)}
              className="w-full bg-gray-50 px-4 py-3 border-b flex items-center justify-between hover:bg-gray-100 transition"
            >
              <h3 className="font-medium text-navy">{location}</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">
                  {formatCurrency(sectionTotal)}
                </span>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            {isExpanded && (
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="px-4 py-2 font-medium">Description</th>
                      <th className="px-4 py-2 font-medium text-center">Qty</th>
                      <th className="px-4 py-2 font-medium text-right">
                        Unit Price
                      </th>
                      <th className="px-4 py-2 font-medium text-right">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {locationItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {item.description}
                            {item.isUpgrade && (
                              <span className="text-xs px-2 py-0.5 bg-signal/10 text-signal rounded">
                                Upgrade
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {/* Actions */}
      <div className="flex justify-between items-center">
        <button
          onClick={handleDownloadPDF}
          disabled={isDownloading}
          className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDownloading ? 'Downloading...' : 'Download PDF'}
        </button>
        <div className="flex gap-3">
          <button
            onClick={() => setShowRejectModal(true)}
            className="px-6 py-2.5 border border-brand text-brand rounded-xl hover:bg-brand/5 transition"
          >
            Request Changes
          </button>
          <button
            onClick={() => setShowApproveModal(true)}
            className="px-8 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-lg transition"
          >
            Approve Quote
          </button>
        </div>
      </div>
    </div>
  )
}
