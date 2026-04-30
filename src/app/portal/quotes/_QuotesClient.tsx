'use client'

/**
 * Builder Portal — Quotes client.
 *
 * §4.4 Quotes. Status tabs (All / Draft / Sent / Approved / Expired /
 * Ordered), table with status-aware actions:
 *   APPROVED → "Convert to Order"  (POST /api/quotes/[id]/convert)
 *   EXPIRED  → "Requote"           (push items into cart, redirect to /quotes/new)
 *   else     → "View"              (push to /portal/quotes/[id])
 *
 * Status colors:
 *   DRAFT/SENT  – walnut neutral
 *   APPROVED    – success green
 *   REJECTED    – oxblood
 *   EXPIRED     – kiln-oak muted
 *   ORDERED     – sky blue
 */

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  Repeat,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'

export interface PortalQuoteRow {
  id: string
  projectId: string
  quoteNumber: string
  subtotal: number
  termAdjustment: number
  total: number
  status: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'ORDERED' | string
  validUntil: string | null
  createdAt: string
  updatedAt: string
  projectName?: string | null
  planName?: string | null
  items?: Array<{
    id: string
    productId: string | null
    description: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
}

const QUOTE_STATUS_BADGE: Record<
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

const FILTER_TABS: { value: string; label: string }[] = [
  { value: '',         label: 'All' },
  { value: 'DRAFT',    label: 'Draft' },
  { value: 'SENT',     label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'EXPIRED',  label: 'Expired' },
  { value: 'ORDERED',  label: 'Ordered' },
]

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function isExpired(validUntil: string | null): boolean {
  if (!validUntil) return false
  return new Date(validUntil).getTime() < Date.now()
}

interface QuotesClientProps {
  quotes: PortalQuoteRow[]
  initialStatus: string
}

export function QuotesClient({ quotes, initialStatus }: QuotesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!initialStatus) return quotes
    return quotes.filter((q) => {
      // Treat SENT as the "Pending" tab value
      if (initialStatus === 'SENT') return q.status === 'SENT' || q.status === 'DRAFT'
      return q.status === initialStatus
    })
  }, [quotes, initialStatus])

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': quotes.length }
    for (const t of FILTER_TABS) {
      if (!t.value) continue
      c[t.value] = quotes.filter((q) =>
        t.value === 'SENT'
          ? q.status === 'SENT' || q.status === 'DRAFT'
          : q.status === t.value,
      ).length
    }
    return c
  }, [quotes])

  function setTab(value: string) {
    const next = new URLSearchParams(searchParams?.toString() ?? '')
    if (value) next.set('status', value)
    else next.delete('status')
    router.push(`${pathname}?${next.toString()}`)
  }

  async function handleConvert(quoteId: string) {
    if (convertingId) return
    setConvertingId(quoteId)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${quoteId}/convert`, {
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
      setConvertingId(null)
    }
  }

  async function handleRequote(quote: PortalQuoteRow) {
    if (!quote.items?.length) {
      router.push('/portal/quotes/new')
      return
    }
    // Push line items into the cart cookie (sequentially — endpoint is fast).
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
      // Even if cart fill fails, send them to the new-quote flow.
    }
    router.push('/portal/quotes/new')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2
            className="text-2xl font-medium leading-tight"
            style={{
              fontFamily: 'var(--font-portal-display, Georgia)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              letterSpacing: '-0.02em',
            }}
          >
            Quotes
          </h2>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            {quotes.length > 0
              ? `${quotes.length} quote${quotes.length === 1 ? '' : 's'} on file`
              : 'No quotes yet — start a new one to begin.'}
          </p>
        </div>
        <Link
          href="/portal/quotes/new"
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
          style={{
            background:
              'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
            color: 'white',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <FilePlus className="w-3.5 h-3.5" />
          New Quote
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTER_TABS.map((tab) => {
          const active = (initialStatus || '') === tab.value
          const count = counts[tab.value] || 0
          return (
            <button
              key={tab.value || 'all'}
              type="button"
              onClick={() => setTab(tab.value)}
              className="h-8 px-3 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1.5"
              style={
                active
                  ? {
                      background: 'var(--portal-walnut, #3E2A1E)',
                      color: 'white',
                    }
                  : {
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                    }
              }
            >
              {tab.label}
              <span
                className="text-[10px] tabular-nums opacity-70"
                style={{
                  background: active
                    ? 'rgba(255,255,255,0.18)'
                    : 'var(--portal-bg-elevated, #FAF5E8)',
                  padding: '0 6px',
                  borderRadius: 999,
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
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

      {/* Table */}
      <PortalCard noBodyPadding>
        {filtered.length === 0 ? (
          <EmptyState filtered={!!initialStatus} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
                >
                  <th className="px-6 py-3 font-semibold">Quote #</th>
                  <th className="px-2 py-3 font-semibold">Project</th>
                  <th className="px-2 py-3 font-semibold">Items</th>
                  <th className="px-2 py-3 font-semibold">Total</th>
                  <th className="px-2 py-3 font-semibold">Status</th>
                  <th className="px-2 py-3 font-semibold">Valid Until</th>
                  <th className="px-6 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => {
                  const expired = q.status === 'EXPIRED' || isExpired(q.validUntil)
                  const effectiveStatus = expired && q.status !== 'ORDERED' ? 'EXPIRED' : q.status
                  const badge =
                    QUOTE_STATUS_BADGE[effectiveStatus] || QUOTE_STATUS_BADGE.DRAFT
                  const itemCount = q.items?.length || 0

                  return (
                    <tr
                      key={q.id}
                      className="border-t group transition-colors hover:bg-[var(--portal-bg-elevated)]"
                      style={{
                        borderColor: 'var(--portal-border-light, #F0E8DA)',
                      }}
                    >
                      <td className="px-6 py-3 align-top">
                        <Link
                          href={`/portal/quotes/${q.id}`}
                          className="font-mono text-xs hover:underline"
                          style={{
                            color: 'var(--portal-text-strong, #3E2A1E)',
                          }}
                        >
                          {q.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-2 py-3 align-top">
                        <div
                          className="text-xs truncate max-w-[260px]"
                          style={{
                            color: 'var(--portal-text-strong, #3E2A1E)',
                          }}
                        >
                          {q.projectName || '—'}
                        </div>
                        {q.planName && (
                          <div
                            className="text-[11px]"
                            style={{
                              color: 'var(--portal-text-muted, #6B6056)',
                            }}
                          >
                            {q.planName}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top text-xs tabular-nums">
                        {itemCount}
                      </td>
                      <td
                        className="px-2 py-3 align-top font-mono tabular-nums"
                        style={{
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      >
                        ${fmtUsd(q.total)}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: badge.bg, color: badge.fg }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td
                        className="px-2 py-3 align-top text-xs"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      >
                        {fmtDate(q.validUntil)}
                      </td>
                      <td className="px-6 py-3 align-top text-right">
                        <QuoteAction
                          quote={q}
                          expired={expired}
                          isConverting={convertingId === q.id}
                          onConvert={() => handleConvert(q.id)}
                          onRequote={() => handleRequote(q)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </PortalCard>
    </div>
  )
}

function QuoteAction({
  quote,
  expired,
  isConverting,
  onConvert,
  onRequote,
}: {
  quote: PortalQuoteRow
  expired: boolean
  isConverting: boolean
  onConvert: () => void
  onRequote: () => void
}) {
  // Approved & not expired → convert to order
  if (quote.status === 'APPROVED' && !expired) {
    return (
      <button
        type="button"
        onClick={onConvert}
        disabled={isConverting}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium disabled:opacity-60"
        style={{
          background:
            'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
          color: 'white',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {isConverting ? (
          <>Converting…</>
        ) : (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" />
            Convert to Order
          </>
        )}
      </button>
    )
  }

  // Expired → requote
  if (expired || quote.status === 'EXPIRED') {
    return (
      <button
        type="button"
        onClick={onRequote}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          color: 'var(--portal-text-strong, #3E2A1E)',
          border: '1px solid var(--portal-border, #E8DFD0)',
        }}
      >
        <Repeat className="w-3.5 h-3.5" />
        Requote
      </button>
    )
  }

  // Ordered → view linked order
  if (quote.status === 'ORDERED') {
    return (
      <Link
        href={`/portal/quotes/${quote.id}`}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          color: 'var(--portal-text-strong, #3E2A1E)',
          border: '1px solid var(--portal-border, #E8DFD0)',
        }}
      >
        <ArrowRight className="w-3.5 h-3.5" />
        View
      </Link>
    )
  }

  // Default → view
  return (
    <Link
      href={`/portal/quotes/${quote.id}`}
      className="inline-flex items-center gap-1 text-xs font-medium px-2 h-8 rounded transition-colors hover:bg-[var(--portal-bg-elevated)]"
      style={{ color: 'var(--portal-walnut, #3E2A1E)' }}
    >
      View <ChevronRight className="w-3.5 h-3.5" />
    </Link>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div
        className="px-6 py-16 text-center"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p
          className="text-base font-medium"
          style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
        >
          No quotes match this filter
        </p>
        <p className="text-sm mt-1">Try another tab.</p>
      </div>
    )
  }
  return (
    <div
      className="px-6 py-16 text-center"
      style={{ color: 'var(--portal-text-muted, #6B6056)' }}
    >
      <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p
        className="text-base font-medium"
        style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
      >
        No quotes yet
      </p>
      <p className="text-sm mt-1 max-w-xs mx-auto">
        Start a quote and it&apos;ll appear here.
      </p>
      <Link
        href="/portal/quotes/new"
        className="inline-flex items-center gap-1.5 mt-4 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
        style={{
          background:
            'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
          color: 'white',
        }}
      >
        <FilePlus className="w-3.5 h-3.5" />
        Start a Quote
      </Link>
    </div>
  )
}

// Suppress unused-name lint for the lucide Download icon import (wired in
// future quote detail action set).
void Download
