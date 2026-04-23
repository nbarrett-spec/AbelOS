'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface OrderItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  product?: { name: string; sku: string }
}

interface Order {
  id: string
  orderNumber: string
  status: string
  paymentStatus: string
  subtotal: number
  taxAmount: number
  total: number
  paymentTerm: string
  deliveryDate?: string
  deliveryNotes?: string
  deliveryConfirmedAt?: string
  poNumber?: string
  createdAt: string
  items: OrderItem[]
  quote?: {
    quoteNumber: string
    project?: { name: string; jobAddress: string; city: string; state: string }
  }
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  RECEIVED:       { bg: 'bg-data-info-bg',     text: 'text-data-info-fg',     label: 'Received' },
  CONFIRMED:      { bg: 'bg-brand-subtle',     text: 'text-accent-fg',        label: 'Confirmed' },
  IN_PRODUCTION:  { bg: 'bg-data-warning-bg',  text: 'text-data-warning-fg',  label: 'In Production' },
  READY_TO_SHIP:  { bg: 'bg-data-positive-bg', text: 'text-data-positive-fg', label: 'Ready to Ship' },
  SHIPPED:        { bg: 'bg-data-info-bg',     text: 'text-data-info-fg',     label: 'Shipped' },
  DELIVERED:      { bg: 'bg-data-positive-bg', text: 'text-data-positive-fg', label: 'Delivered' },
  COMPLETE:       { bg: 'bg-data-positive-bg', text: 'text-data-positive-fg', label: 'Complete' },
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-data-warning-bg text-data-warning-fg',
  PARTIAL: 'bg-data-warning-bg text-data-warning-fg',
  PAID:    'bg-data-positive-bg text-data-positive-fg',
  OVERDUE: 'bg-data-negative-bg text-data-negative-fg',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function BuilderOrderDetailPage() {
  const params = useParams()
  const orderId = params.id as string
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) return
    fetch(`/api/orders/${orderId}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load order')
        return r.json()
      })
      .then(data => {
          const o = data.order || data
          // Normalize: API may return project at root or nested in quote
          if (o.project && !o.quote) {
            o.quote = { quoteNumber: '', project: o.project }
          }
          setOrder(o)
        })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [orderId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <h2 className="text-xl font-bold text-fg mb-2">Order not found</h2>
        <p className="text-fg-muted mb-6">{error || 'We couldn&apos;t load this order.'}</p>
        <Link href="/dashboard/orders" className="text-brand font-semibold hover:underline">
          &larr; Back to your orders
        </Link>
      </div>
    )
  }

  const cfg = STATUS_CONFIG[order.status] || { bg: 'bg-surface-muted', text: 'text-fg-muted', label: order.status }
  const paymentCfg = PAYMENT_STATUS_COLORS[order.paymentStatus] || 'bg-surface-muted text-fg-muted'
  const steps = ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED']
  const currentIdx = steps.indexOf(order.status)

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back Link */}
      <Link href="/dashboard/orders" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Back to your orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">{order.orderNumber}</h1>
          <p className="text-sm text-fg-muted mt-1">
            Placed {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            {order.quote?.project?.name && <span> &middot; {order.quote.project.name}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
            {cfg.label}
          </span>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${paymentCfg}`}>
            {order.paymentStatus || 'PENDING'}
          </span>
        </div>
      </div>

      {/* Progress Tracker */}
      <div className="bg-surface rounded-xl border border-border p-6 mb-6">
        <h3 className="text-sm font-semibold text-fg-muted mb-4">Order progress</h3>
        <div className="flex items-center justify-between relative">
          {/* Progress line */}
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-surface-muted" />
          <div
            className="absolute top-4 left-0 h-0.5 bg-accent transition-all duration-500"
            style={{ width: `${currentIdx >= 0 ? (currentIdx / (steps.length - 1)) * 100 : 0}%` }}
          />
          {steps.map((step, idx) => {
            const isComplete = idx <= currentIdx
            const isCurrent = idx === currentIdx
            const label = STATUS_CONFIG[step]?.label || step
            return (
              <div key={step} className="flex flex-col items-center relative z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  isComplete
                    ? 'bg-accent border-accent text-fg-on-accent'
                    : 'bg-surface border-border text-fg-subtle'
                } ${isCurrent ? 'ring-4 ring-accent-subtle' : ''}`}>
                  {isComplete ? '✓' : idx + 1}
                </div>
                <span className={`text-[10px] mt-2 font-medium text-center max-w-[70px] ${
                  isComplete ? 'text-accent' : 'text-fg-subtle'
                }`}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Order Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Delivery Info */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-fg-muted mb-3">Delivery</h3>
          <div className="space-y-3">
            {order.deliveryDate && (
              <div>
                <p className="text-xs text-fg-muted">Scheduled</p>
                <p className="text-sm font-semibold text-fg">
                  {new Date(order.deliveryDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            )}
            {order.deliveryConfirmedAt && (
              <div>
                <p className="text-xs text-fg-muted">Delivered</p>
                <p className="text-sm font-semibold text-data-positive-fg">
                  {new Date(order.deliveryConfirmedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            )}
            {order.quote?.project?.jobAddress && (
              <div>
                <p className="text-xs text-fg-muted">Address</p>
                <p className="text-sm text-fg">
                  {order.quote.project.jobAddress}
                  {order.quote.project.city && `, ${order.quote.project.city}`}
                  {order.quote.project.state && `, ${order.quote.project.state}`}
                </p>
              </div>
            )}
            {order.deliveryNotes && (
              <div>
                <p className="text-xs text-fg-muted">Notes</p>
                <p className="text-sm text-fg-muted">{order.deliveryNotes}</p>
              </div>
            )}
            {!order.deliveryDate && !order.deliveryConfirmedAt && !order.quote?.project?.jobAddress && (
              <p className="text-sm text-fg-subtle italic">No delivery details yet</p>
            )}
          </div>
        </div>

        {/* Payment Info */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-fg-muted mb-3">Payment summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-fg-muted">Subtotal</span>
              <span className="text-sm font-medium text-fg">{fmt(Number(order.subtotal))}</span>
            </div>
            {Number(order.taxAmount) > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-fg-muted">Tax</span>
                <span className="text-sm font-medium text-fg">{fmt(Number(order.taxAmount))}</span>
              </div>
            )}
            <div className="flex justify-between items-center border-t border-border pt-2">
              <span className="text-sm font-bold text-fg">Total</span>
              <span className="text-lg font-bold text-brand">{fmt(Number(order.total))}</span>
            </div>
            {order.paymentTerm && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-fg-muted">Payment terms</p>
                <p className="text-sm font-medium text-fg">
                  {order.paymentTerm === 'NET_30' ? 'Net 30' :
                   order.paymentTerm === 'NET_15' ? 'Net 15' :
                   order.paymentTerm === 'DUE_ON_RECEIPT' ? 'Due on Receipt' :
                   order.paymentTerm === 'PAY_ON_DELIVERY' ? 'Pay on Delivery' :
                   order.paymentTerm === 'PAY_AT_ORDER' ? 'Pay at Order' :
                   order.paymentTerm}
                </p>
              </div>
            )}
            {order.poNumber && (
              <div>
                <p className="text-xs text-fg-muted">PO number</p>
                <p className="text-sm font-mono font-medium text-fg">{order.poNumber}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-fg-muted">Items ({order.items?.length || 0})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-muted">
              <tr className="text-xs text-fg-muted uppercase tracking-wider">
                <th className="px-5 py-3 text-left font-semibold">Item</th>
                <th className="px-5 py-3 text-right font-semibold">Qty</th>
                <th className="px-5 py-3 text-right font-semibold">Unit price</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(order.items || []).map(item => (
                <tr key={item.id}>
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-fg">{item.description}</p>
                    {item.product?.sku && (
                      <p className="text-xs text-fg-subtle mt-0.5">SKU: {item.product.sku}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm text-fg-muted text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-sm text-fg-muted text-right">{fmt(Number(item.unitPrice))}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-fg text-right">{fmt(Number(item.lineTotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reference Info */}
      {order.quote?.quoteNumber && (
        <div className="bg-data-info-bg border border-data-info rounded-xl p-4 mb-6">
          <p className="text-sm text-data-info-fg">
            Created from quote <span className="font-semibold font-mono">{order.quote.quoteNumber}</span>.
          </p>
        </div>
      )}

      {/* Help */}
      <div className="bg-surface-muted border border-border rounded-xl p-4">
        <p className="text-sm text-fg-muted">
          <strong>Need help?</strong> Questions on this order, the delivery schedule, or a change? Your account rep can handle it.
        </p>
      </div>
    </div>
  )
}
