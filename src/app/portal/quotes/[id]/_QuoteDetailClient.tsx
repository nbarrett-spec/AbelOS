'use client'

/**
 * Builder Portal — Quote detail client.
 *
 * §4.4 Quotes. Renders header, line items table, summary, and the
 * status-aware primary action (Convert / Requote / Download PDF).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  MessageCircle,
  Repeat,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'

export interface QuoteDetailItem {
  id: string
  productId: string | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface QuoteDetailPayload {
  id: string
  projectId: string
  quoteNumber: string
  subtotal: number
  termAdjustment: number
  total: number
  status: string
  validUntil: string | null
  createdAt: string
  updatedAt: string
  items: QuoteDetailItem[]
  project?: {
    id: string
    name: string
    planName: string | null
    builder: {
      companyName: string
      contactName: string | null
    }
  } | null
}

const STATUS_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  DRAFT:    { bg: 'rgba(107,96,86,0.12)',  fg: '#5A4F46', label: 'Draft' },
  SENT:     { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Sent' },
  APPROVED: { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Approved' },
  REJECTED: { bg: 'rgba(110,42,36,0.10)',   fg: '#7E2417', label: 'Rejected' },
  EXPIRED:  { bg: 'rgba(184,135,107,0.16)', fg: '#7A5A45', label: 'Expired' },
  ORDERED:  { bg: 'rgba(201,130,43,0.14)',  fg: '#7A4E0F', label: 'Ordered' },
}

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(iso: string | null): string {
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

function isExpired(validUntil: string | null): boolean {
  if (!validUntil) return false
  return new Date(validUntil).getTime() < Date.now()
}

export function QuoteDetailClient({
  quote,
}: {
  quote: QuoteDetailPayload
}) {
  const router = useRouter()
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expired = quote.status === 'EXPIRED' || isExpired(quote.validUntil)
  const effectiveStatus = expired && quote.status !== 'ORDERED' ? 'EXPIRED' : quote.status
  const badge = STATUS_BADGE[effectiveStatus] || STATUS_BADGE.DRAFT

  async function handleConvert() {
    if (converting) return
    setConverting(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${quote.id}/convert`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to convert quote')
      }
      const data = await res.json()
      if (data?.order?.id) {
        router.push(`/portal/orders/${data.order.id}`)
      } else {
        router.push('/portal/orders')
      }
    } catch (e: any) {
      setError(e?.message || 'Convert failed')
      setConverting(false)
    }
  }

  async function handleRequote() {
    if (!quote.items?.length) {
      router.push('/portal/quotes/new')
      return
    }
    try {
      for (const item of quote.items) {
        if (!item.productId) continue
        await fetch('/api/catalog/cart', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            description: item.description,
            sku: item.productId.slice(0, 12),
          }),
        })
      }
    } catch {
      // continue regardless
    }
    router.push('/portal/quotes/new')
  }

  return (
    <div className="space-y-6">
      <Link
        href="/portal/quotes"
        className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        style={{
          color: 'var(--c1)',
          fontFamily: 'var(--font-portal-body)',
        }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to quotes
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="portal-eyebrow mb-2">Quote Detail</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1
              className="portal-mono-data text-[28px]"
              style={{
                color: 'var(--portal-text-strong)',
                letterSpacing: '0.02em',
                fontWeight: 600,
              }}
            >
              {quote.quoteNumber}
            </h1>
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-full uppercase"
              style={{
                background: badge.bg,
                color: badge.fg,
                fontFamily: 'var(--font-portal-mono)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.12em',
              }}
            >
              {badge.label}
            </span>
          </div>
          {quote.project && (
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              {quote.project.name}
              {quote.project.planName ? ` · ${quote.project.planName}` : ''}
            </p>
          )}
          <p
            className="text-xs mt-0.5"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Issued {fmtDate(quote.createdAt)} · Valid until{' '}
            {fmtDate(quote.validUntil)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href={`/api/quotes/${quote.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </a>
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
            Ask
          </Link>
          {quote.status === 'APPROVED' && !expired && (
            <button
              type="button"
              onClick={handleConvert}
              disabled={converting}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-xs font-medium transition-shadow disabled:opacity-60"
              style={{
                background:
                  'var(--grad)',
                color: 'white',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {converting ? (
                <>Converting…</>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Convert to Order
                </>
              )}
            </button>
          )}
          {expired && (
            <button
              type="button"
              onClick={handleRequote}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-xs font-medium transition-shadow"
              style={{
                background:
                  'var(--grad)',
                color: 'white',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <Repeat className="w-3.5 h-3.5" />
              Requote
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="px-4 py-3 rounded-md text-sm"
          style={{
            background: 'rgba(110,42,36,0.08)',
            border: '1px solid rgba(110,42,36,0.2)',
            color: '#7E2417',
          }}
        >
          {error}
        </div>
      )}

      {/* Body grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PortalCard
          title="Line Items"
          subtitle={`${quote.items.length} ${quote.items.length === 1 ? 'item' : 'items'}`}
          className="lg:col-span-2"
          noBodyPadding
        >
          {quote.items.length === 0 ? (
            <div
              className="px-6 py-10 text-center text-sm"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              No items on this quote.
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
                  {quote.items.map((item) => (
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
                            {item.description}
                          </Link>
                        ) : (
                          <span
                            className="font-medium"
                            style={{
                              color: 'var(--portal-text-strong, #3E2A1E)',
                            }}
                          >
                            {item.description}
                          </span>
                        )}
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PortalCard>

        <div className="space-y-4">
          <PortalCard title="Summary">
            <dl className="space-y-2 text-sm">
              <Row label="Subtotal" value={`$${fmtUsd(quote.subtotal)}`} />
              {quote.termAdjustment !== 0 && (
                <Row
                  label="Term Adjustment"
                  value={`${quote.termAdjustment > 0 ? '+' : '-'}$${fmtUsd(Math.abs(quote.termAdjustment))}`}
                />
              )}
              <div
                className="pt-2 mt-2"
                style={{
                  borderTop: '1px solid var(--portal-border-light, #F0E8DA)',
                }}
              >
                <Row label="Total" value={`$${fmtUsd(quote.total)}`} bold />
              </div>
            </dl>
          </PortalCard>

          {quote.status === 'APPROVED' && !expired && (
            <PortalCard>
              <p
                className="text-sm leading-relaxed"
                style={{ color: 'var(--portal-text, #2C2C2C)' }}
              >
                <strong>Approved.</strong> Convert this quote to an order to
                start production. Pricing locks at conversion.
              </p>
            </PortalCard>
          )}

          {expired && (
            <PortalCard>
              <p
                className="text-sm leading-relaxed"
                style={{ color: 'var(--portal-text, #2C2C2C)' }}
              >
                <strong>Expired.</strong> Pricing may have changed. Click{' '}
                <em>Requote</em> to start a fresh quote with the same items.
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
