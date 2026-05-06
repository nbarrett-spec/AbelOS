'use client'

/**
 * Builder Portal — Order detail client.
 *
 * §4.2.1 Order Detail. Renders header (order number, project, status pill),
 * timeline, two-column body (line items table + summary side panel), and
 * the reorder + save-as-template actions (A-BIZ-14).
 *
 * Reorder opens a confirmation modal that lets the builder edit qty / drop
 * lines, then POSTs to /api/portal/orders/from-order which goes through the
 * same credit-hold + inventory-reservation pipeline as POST /api/orders.
 * The new order's id comes back and we route to it directly — no detour
 * through the quote builder.
 *
 * "Save as Template" appears for completed orders (DELIVERED / SHIPPED /
 * COMPLETE) and writes an OrderTemplate the builder can re-launch later.
 */

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Bookmark,
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
import { ReorderModal } from '../_ReorderModal'
import { SaveTemplateModal } from '../_SaveTemplateModal'

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

// Statuses that count as "completed" for the Reorder + Save-as-Template
// actions. Spec calls them "completed orders" — anything that already
// shipped or is closed out is fair game.
const COMPLETED_STATUSES = new Set([
  'DELIVERED',
  'SHIPPED',
  'COMPLETE',
  'PARTIAL_SHIPPED',
])

export function OrderDetailClient({ order }: OrderDetailClientProps) {
  const [reorderOpen, setReorderOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)

  const isCompleted = COMPLETED_STATUSES.has(order.status)

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
        style={{
          color: 'var(--c1)',
          fontFamily: 'var(--font-portal-body)',
        }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="portal-eyebrow mb-2">Order Detail</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1
              className="portal-mono-data text-[28px]"
              style={{
                color: 'var(--portal-text-strong)',
                letterSpacing: '0.02em',
                fontWeight: 600,
              }}
            >
              {order.orderNumber}
            </h1>
            <PortalStatusBadge status={order.status} size="md" />
          </div>
          {projectLine && (
            <p
              className="text-[15px] mt-2"
              style={{
                color: 'var(--portal-text-muted)',
                fontFamily: 'var(--font-portal-body)',
              }}
            >
              {projectLine}
            </p>
          )}
          {addressLine && (
            <p
              className="text-xs mt-0.5 flex items-center gap-1"
              style={{
                color: 'var(--portal-text-subtle)',
                fontFamily: 'var(--font-portal-body)',
              }}
            >
              <MapPin className="w-3 h-3" /> {addressLine}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href="/portal/messages"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-medium transition-colors"
            style={{
              background: 'var(--glass)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              color: 'var(--portal-text-strong)',
              border: '1px solid var(--glass-border)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Message PM
          </Link>
          {isCompleted && (
            <button
              type="button"
              onClick={() => setSaveTemplateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-medium transition-colors"
              style={{
                background: 'var(--glass)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                color: 'var(--portal-text-strong)',
                border: '1px solid var(--glass-border)',
                fontFamily: 'var(--font-portal-body)',
              }}
            >
              <Bookmark className="w-3.5 h-3.5" />
              Save as Template
            </button>
          )}
          <button
            type="button"
            onClick={() => setReorderOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-xs font-medium transition-shadow"
            style={{
              background: 'var(--grad)',
              color: 'white',
              boxShadow: '0 6px 20px rgba(79,70,229,0.25)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            <Repeat className="w-3.5 h-3.5" />
            Reorder
          </button>
        </div>
      </div>

      <ReorderModal
        open={reorderOpen}
        onClose={() => setReorderOpen(false)}
        mode="order"
        sourceId={order.id}
        sourceLabel={order.orderNumber}
      />
      <SaveTemplateModal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        sourceOrderId={order.id}
        defaultName={`Template from ${order.orderNumber}`}
      />

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
                  <tr className="text-left portal-meta-label">
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
