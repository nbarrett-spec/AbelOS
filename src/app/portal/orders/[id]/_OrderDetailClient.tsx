'use client'

/**
 * Builder Portal — Order detail client.
 *
 * §4.2.1 Order Detail. Renders header (order number, project, status pill),
 * timeline, two-column body (line items table + summary side panel), and
 * the reorder action.
 *
 * Reorder posts to /api/orders/[id]/reorder which mutates the cart cookie
 * server-side, then we navigate to /portal/quotes/new to let the builder
 * review and submit. (The cart format already matches what the quotes
 * builder expects.)
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Hash,
  MapPin,
  MessageCircle,
  Package,
  Repeat,
  Truck,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { PortalStatusBadge } from '@/components/portal/PortalStatusBadge'
import { PortalOrderTimeline } from '@/components/portal/PortalOrderTimeline'

export interface OrderDetailItem {
  id: string
  productId: string | null
  description: string
  productName: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface OrderDetailPayload {
  id: string
  orderNumber: string
  poNumber: string | null
  createdAt: string
  status: string
  paymentStatus?: string
  paymentTerm?: string
  paidAt?: string | null
  dueDate?: string | null
  deliveryDate?: string | null
  deliveryNotes?: string | null
  subtotal: number
  taxAmount: number
  shippingCost: number
  total: number
  project?: {
    name: string | null
    planName: string | null
    jobAddress: string | null
    city: string | null
    state: string | null
  }
  builder?: {
    companyName: string
    contactName: string | null
  }
  items: OrderDetailItem[]
}

function fmtUsd(n: number | string | null | undefined): string {
  const v = Number(n) || 0
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

interface OrderDetailClientProps {
  order: OrderDetailPayload
}

export function OrderDetailClient({ order }: OrderDetailClientProps) {
  const router = useRouter()
  const [reordering, setReordering] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)

  async function handleReorder() {
    if (reordering) return
    setReordering(true)
    setReorderError(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/reorder`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to add to cart')
      }
      router.push('/portal/quotes/new')
    } catch (e: any) {
      setReorderError(e?.message || 'Reorder failed')
      setReordering(false)
    }
  }

  const project = order.project
  const projectLine = project
    ? [project.name, project.planName].filter(Boolean).join(' · ')
    : ''
  const addressLine = project
    ? [project.jobAddress, project.city, project.state]
        .filter(Boolean)
        .join(', ')
    : ''

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/portal/orders"
        className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        style={{ color: 'var(--portal-walnut, #3E2A1E)' }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1
              className="text-2xl font-medium font-mono tabular-nums"
              style={{
                fontFamily: 'var(--font-portal-mono, JetBrains Mono)',
                color: 'var(--portal-text-strong, #3E2A1E)',
                letterSpacing: '-0.01em',
              }}
            >
              {order.orderNumber}
            </h1>
            <PortalStatusBadge status={order.status} size="md" />
          </div>
          {projectLine && (
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              {projectLine}
            </p>
          )}
          {addressLine && (
            <p
              className="text-xs mt-0.5 flex items-center gap-1"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              <MapPin className="w-3 h-3" /> {addressLine}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href="/portal/messages"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Message PM
          </Link>
          <button
            type="button"
            onClick={handleReorder}
            disabled={reordering}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-xs font-medium transition-shadow disabled:opacity-60"
            style={{
              background:
                'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
              color: 'white',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Repeat className="w-3.5 h-3.5" />
            {reordering ? 'Adding…' : 'Reorder these items'}
          </button>
        </div>
      </div>

      {reorderError && (
        <div
          className="px-4 py-3 rounded-md text-sm"
          style={{
            background: 'rgba(110,42,36,0.08)',
            border: '1px solid rgba(110,42,36,0.2)',
            color: '#7E2417',
          }}
        >
          {reorderError}
        </div>
      )}

      {/* Timeline */}
      <PortalCard title="Progress">
        <PortalOrderTimeline status={order.status} />
      </PortalCard>

      {/* Body grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Line items */}
        <PortalCard
          title="Line Items"
          subtitle={`${order.items.length} ${order.items.length === 1 ? 'item' : 'items'}`}
          className="lg:col-span-2"
          noBodyPadding
        >
          {order.items.length === 0 ? (
            <div
              className="px-6 py-10 text-center text-sm"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              No line items on this order.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[10px] uppercase tracking-wider"
                    style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
                  >
                    <th className="px-6 py-3 font-semibold">Item</th>
                    <th className="px-2 py-3 font-semibold text-right">Qty</th>
                    <th className="px-2 py-3 font-semibold text-right">Unit</th>
                    <th className="px-6 py-3 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => {
                    const name = item.productName || item.description
                    return (
                      <tr
                        key={item.id}
                        className="border-t"
                        style={{
                          borderColor: 'var(--portal-border-light, #F0E8DA)',
                        }}
                      >
                        <td className="px-6 py-3 align-top">
                          {item.productId ? (
                            <Link
                              href={`/portal/catalog/${item.productId}`}
                              className="font-medium hover:underline"
                              style={{
                                color: 'var(--portal-text-strong, #3E2A1E)',
                              }}
                            >
                              {name}
                            </Link>
                          ) : (
                            <span
                              className="font-medium"
                              style={{
                                color: 'var(--portal-text-strong, #3E2A1E)',
                              }}
                            >
                              {name}
                            </span>
                          )}
                          <div
                            className="text-[11px] font-mono mt-0.5"
                            style={{
                              color: 'var(--portal-text-muted, #6B6056)',
                            }}
                          >
                            {item.sku || '—'}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums align-top">
                          {item.quantity}
                        </td>
                        <td
                          className="px-2 py-3 text-right tabular-nums align-top font-mono text-xs"
                          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                        >
                          ${fmtUsd(item.unitPrice)}
                        </td>
                        <td
                          className="px-6 py-3 text-right tabular-nums align-top font-mono"
                          style={{
                            color: 'var(--portal-text-strong, #3E2A1E)',
                          }}
                        >
                          ${fmtUsd(item.lineTotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PortalCard>

        {/* Summary panel */}
        <div className="space-y-4">
          <PortalCard title="Summary">
            <dl className="space-y-2 text-sm">
              <Row label="Subtotal" value={`$${fmtUsd(order.subtotal)}`} />
              <Row label="Tax" value={`$${fmtUsd(order.taxAmount)}`} />
              <Row
                label="Shipping"
                value={`$${fmtUsd(order.shippingCost)}`}
              />
              <div
                className="pt-2 mt-2"
                style={{
                  borderTop: '1px solid var(--portal-border-light, #F0E8DA)',
                }}
              >
                <Row
                  label="Total"
                  value={`$${fmtUsd(order.total)}`}
                  bold
                />
              </div>
            </dl>
          </PortalCard>

          <PortalCard title="Details">
            <dl className="space-y-3 text-sm">
              <DetailRow
                icon={<Hash className="w-3.5 h-3.5" />}
                label="PO Number"
                value={order.poNumber || '—'}
                mono
              />
              <DetailRow
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Placed"
                value={fmtDate(order.createdAt)}
              />
              {order.deliveryDate && (
                <DetailRow
                  icon={<Truck className="w-3.5 h-3.5" />}
                  label="Delivery"
                  value={fmtDate(order.deliveryDate)}
                />
              )}
              {order.paymentTerm && (
                <DetailRow
                  icon={<Package className="w-3.5 h-3.5" />}
                  label="Terms"
                  value={order.paymentTerm.replace(/_/g, ' ')}
                />
              )}
              {order.paymentStatus && (
                <DetailRow
                  icon={<Hash className="w-3.5 h-3.5" />}
                  label="Payment"
                  value={order.paymentStatus.replace(/_/g, ' ')}
                />
              )}
              {order.dueDate && (
                <DetailRow
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  label="Due"
                  value={fmtDate(order.dueDate)}
                />
              )}
            </dl>
          </PortalCard>

          {order.deliveryNotes && (
            <PortalCard title="Delivery Notes">
              <p
                className="text-sm whitespace-pre-line leading-relaxed"
                style={{ color: 'var(--portal-text, #2C2C2C)' }}
              >
                {order.deliveryNotes}
              </p>
            </PortalCard>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt
        className="text-xs"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        {label}
      </dt>
      <dd
        className={`tabular-nums font-mono ${bold ? 'text-base' : 'text-sm'}`}
        style={{
          color: 'var(--portal-text-strong, #3E2A1E)',
          fontWeight: bold ? 600 : 400,
        }}
      >
        {value}
      </dd>
    </div>
  )
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt
        className="text-xs flex items-center gap-1.5"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        {icon}
        {label}
      </dt>
      <dd
        className={`text-xs text-right ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
      >
        {value}
      </dd>
    </div>
  )
}
