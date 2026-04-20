'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'

const STATUS_STEPS = [
  { key: 'RECEIVED', label: 'Order Received', icon: '📥', description: 'Your order has been received and is being processed' },
  { key: 'CONFIRMED', label: 'Confirmed', icon: '✅', description: 'Order confirmed and materials sourced' },
  { key: 'IN_PRODUCTION', label: 'In Production', icon: '🏭', description: 'Your doors and trim are being manufactured' },
  { key: 'READY_TO_SHIP', label: 'Ready to Ship', icon: '📦', description: 'Order is staged and ready for delivery' },
  { key: 'SHIPPED', label: 'Out for Delivery', icon: '🚚', description: 'Your order is on the truck' },
  { key: 'DELIVERED', label: 'Delivered', icon: '🏠', description: 'Order has been delivered to the job site' },
]

export default function OrderDetailPage() {
  const params = useParams()
  const orderId = params.id as string
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactMessage, setContactMessage] = useState('')
  const [contactType, setContactType] = useState('QUESTION')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetch(`/api/orders/${orderId}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load')
        return r.json()
      })
      .then(data => setOrder(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [orderId])

  const handleSendMessage = async () => {
    if (!contactMessage.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `${contactType === 'ISSUE' ? 'Issue' : contactType === 'CHANGE' ? 'Change Request' : 'Question'}: Order ${order?.orderNumber}`,
          message: contactMessage,
          category: contactType,
          orderId: order?.id,
          projectId: order?.projectId,
        }),
      })
      if (res.ok) {
        showToast('Message sent to Abel Lumber!', 'success')
        setShowContactModal(false)
        setContactMessage('')
      } else {
        showToast('Failed to send message. Please try again.', 'error')
      }
    } catch {
      showToast('Failed to send message. Please check your connection.', 'error')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-5xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-500 mb-4">{error ? 'Failed to load order details.' : 'Order not found.'}</p>
          <Link href="/dashboard/orders" className="text-[#C9822B] hover:text-[#A86B1F] font-medium">← Back to Orders</Link>
        </div>
      </div>
    )
  }

  const currentStepIndex = STATUS_STEPS.findIndex(s => s.key === order.status)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toastType === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/dashboard" className="hover:text-[#3E2A1E]">Dashboard</Link>
          <span>/</span>
          <Link href="/dashboard/orders" className="hover:text-[#3E2A1E]">Orders</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{order.orderNumber}</span>
        </div>

        {/* Header */}
        <div className="bg-white rounded-2xl border p-4 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{order.orderNumber}</h1>
              <p className="text-gray-500 mt-1 text-sm">{order.project?.name} &middot; {order.project?.planName || 'Custom'}</p>
              <p className="text-sm text-gray-400 mt-1">Placed {new Date(order.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-2xl sm:text-3xl font-bold text-[#3E2A1E]">${order.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              {order.deliveryDate && (
                <p className="text-sm text-gray-500 mt-1">Est. delivery: {new Date(order.deliveryDate).toLocaleDateString()}</p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mt-5 pt-5 border-t">
            <button
              onClick={() => { setContactType('QUESTION'); setShowContactModal(true) }}
              className="px-4 py-2 bg-[#3E2A1E] text-white text-sm font-medium rounded-lg hover:bg-[#1a2f4e] transition"
            >
              Contact Abel Lumber
            </button>
            <button
              onClick={() => { setContactType('ISSUE'); setShowContactModal(true) }}
              className="px-4 py-2 border border-red-300 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 transition"
            >
              Report Issue
            </button>
            <button
              onClick={() => { setContactType('CHANGE'); setShowContactModal(true) }}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
            >
              Request Change
            </button>
          </div>
        </div>

        {/* Status Timeline */}
        <div className="bg-white rounded-2xl border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Order Status</h2>
          <div className="relative">
            {STATUS_STEPS.map((step, i) => {
              const isComplete = i <= currentStepIndex
              const isCurrent = i === currentStepIndex
              return (
                <div key={step.key} className="flex items-start gap-4 mb-6 last:mb-0">
                  <div className="relative flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                      isComplete
                        ? isCurrent
                          ? 'border-[#C9822B] bg-[#C9822B]/10'
                          : 'border-green-500 bg-green-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}>
                      {isComplete && !isCurrent ? '✓' : step.icon}
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`w-0.5 h-8 mt-1 ${i < currentStepIndex ? 'bg-green-400' : 'bg-gray-200'}`} />
                    )}
                  </div>
                  <div className={`pt-1 ${isComplete ? '' : 'opacity-40'}`}>
                    <p className={`font-semibold ${isCurrent ? 'text-[#C9822B]' : isComplete ? 'text-gray-900' : 'text-gray-400'}`}>
                      {step.label}
                      {isCurrent && <span className="ml-2 text-xs bg-[#C9822B] text-white px-2 py-0.5 rounded-full">Current</span>}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Delivery Info */}
        {(order.deliveryDate || order.driverId) && (
          <div className="bg-white rounded-2xl border p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Delivery Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {order.deliveryDate && (
                <div>
                  <p className="text-sm text-gray-500">Scheduled Date</p>
                  <p className="font-medium text-gray-900">{new Date(order.deliveryDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                </div>
              )}
              {order.project?.jobAddress && (
                <div>
                  <p className="text-sm text-gray-500">Delivery Address</p>
                  <p className="font-medium text-gray-900">{order.project.jobAddress}{order.project.city ? `, ${order.project.city}` : ''}</p>
                </div>
              )}
              {order.deliveryNotes && (
                <div className="col-span-2">
                  <p className="text-sm text-gray-500">Delivery Notes</p>
                  <p className="font-medium text-gray-900">{order.deliveryNotes}</p>
                </div>
              )}
            </div>
            {order.deliveryConfirmedAt && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-green-700 font-medium">Delivered on {new Date(order.deliveryConfirmedAt).toLocaleDateString()}</p>
              </div>
            )}
          </div>
        )}

        {/* Order Items */}
        <div className="bg-white rounded-2xl border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">Order Items ({order.items?.length || 0})</h2>
          </div>
          <div className="divide-y">
            {(order.items || []).map((item: any) => (
              <div key={item.id} className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
                  {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                  {item.location && <p className="text-xs text-gray-500 mt-0.5">{item.location}</p>}
                </div>
                <div className="flex items-center gap-3 sm:gap-6 flex-shrink-0">
                  <span className="text-sm text-gray-500">&times;{item.quantity}</span>
                  <span className="text-sm font-medium text-gray-900 w-16 sm:w-20 text-right">
                    ${(item.lineTotal || item.unitPrice * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center">
            <span className="text-sm font-medium text-gray-600">Total</span>
            <span className="text-xl font-bold text-[#3E2A1E]">${order.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Related Invoice Info */}
        {order.invoiceId && (
          <div className="bg-white rounded-2xl border p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Invoice</h2>
            <Link href="/dashboard/invoices" className="text-[#C9822B] hover:text-[#A86B1F] font-medium text-sm">
              View Invoice →
            </Link>
          </div>
        )}
      </div>

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {contactType === 'ISSUE' ? 'Report an Issue' : contactType === 'CHANGE' ? 'Request a Change' : 'Contact Abel Lumber'}
              </h3>
              <button onClick={() => setShowContactModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Re: Order <strong>{order.orderNumber}</strong>
              {order.project?.name && <> — {order.project.name}</>}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={contactType}
                onChange={(e) => setContactType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="QUESTION">General Question</option>
                <option value="ISSUE">Report Issue / Damage</option>
                <option value="CHANGE">Change Request</option>
                <option value="DELIVERY">Delivery Inquiry</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                rows={4}
                placeholder={contactType === 'ISSUE' ? 'Describe the issue...' : contactType === 'CHANGE' ? 'What changes do you need?' : 'Your message...'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowContactModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={handleSendMessage}
                disabled={sending || !contactMessage.trim()}
                className="px-4 py-2 bg-[#C9822B] text-white text-sm font-medium rounded-lg hover:bg-[#A86B1F] disabled:opacity-50 transition"
              >
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
