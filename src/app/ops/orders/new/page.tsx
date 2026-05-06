'use client'

/**
 * /ops/orders/new — FIX-5 from PO-SYSTEM-FIXES-HANDOFF.docx (2026-05-04).
 *
 * Orders in Aegis are quote-first. POST /api/ops/orders requires a quoteId;
 * there's no path to create an order from line items directly. So this page
 * is a quote-selector + confirmation flow:
 *
 *   1. Fetch APPROVED quotes via GET /api/ops/quotes?status=APPROVED
 *   2. Render a searchable list with builder + project + total + date
 *   3. User picks a quote → preview pane shows line items
 *   4. Confirm → POST /api/ops/orders { quoteId } → redirect to detail
 *
 * If Nate eventually wants direct order creation (no quote required), a new
 * POST endpoint would be needed; the current API explicitly rejects that.
 */
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, AlertTriangle, Search, FileText, ArrowRight, X } from 'lucide-react'
import { PageHeader, Card } from '@/components/ui'
import { cn } from '@/lib/utils'

interface QuoteRow {
  id: string
  quoteNumber: string
  status: string
  total: number
  subtotal: number
  taxAmount: number
  validUntil: string | null
  createdAt: string
  notes?: string | null
  project?: {
    id: string
    name: string
    jobAddress?: string | null
    builder?: { id: string; companyName: string } | null
  } | null
  builder?: { id: string; companyName: string } | null
  items?: Array<{
    id: string
    productId: string | null
    description: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
}

function NewOrderForm() {
  const router = useRouter()
  // BUG-16: when arrived from a builder profile we filter the quote list to
  // that builder's APPROVED quotes only, and surface a chip so the user knows
  // they're scoped. We also try to resolve the builder name for display.
  const searchParamsHook = useSearchParams()
  const builderIdParam = searchParamsHook?.get('builderId') || null
  const [builderName, setBuilderName] = useState<string | null>(null)

  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<QuoteRow | null>(null)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/ops/quotes?status=APPROVED&limit=200')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const list: QuoteRow[] = Array.isArray(data) ? data : data.data || data.quotes || []
        if (!cancelled) setQuotes(list)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load quotes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    let list = quotes
    // BUG-16: scope to one builder when ?builderId is present. Match either
    // top-level builder or project.builder — older quotes may only have one.
    if (builderIdParam) {
      list = list.filter(
        (x) =>
          x.builder?.id === builderIdParam ||
          x.project?.builder?.id === builderIdParam,
      )
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((x) => {
      const builder = x.builder?.companyName || x.project?.builder?.companyName || ''
      const project = x.project?.name || ''
      return (
        x.quoteNumber.toLowerCase().includes(q) ||
        builder.toLowerCase().includes(q) ||
        project.toLowerCase().includes(q)
      )
    })
  }, [quotes, search, builderIdParam])

  // Resolve builder name for the chip + auto-select if there's exactly one
  // approved quote available for this builder.
  useEffect(() => {
    if (!builderIdParam) {
      setBuilderName(null)
      return
    }
    let cancelled = false
    fetch(`/api/admin/builders/${builderIdParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        setBuilderName(d?.builder?.companyName || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [builderIdParam])

  const selectQuote = async (q: QuoteRow) => {
    setSelected(q)
    setError('')
    // If items aren't already on the row, fetch the full quote for preview.
    if (!q.items || q.items.length === 0) {
      try {
        const res = await fetch(`/api/ops/quotes/${q.id}`)
        if (res.ok) {
          const data = await res.json()
          const fullQuote = data.quote || data
          setSelected({ ...q, items: fullQuote.items || [] })
        }
      } catch {
        // non-fatal — preview just shows totals
      }
    }
  }

  const handleSubmit = async () => {
    if (!selected) return
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/ops/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: selected.id,
          deliveryDate: deliveryDate || undefined,
          deliveryNotes: deliveryNotes || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const orderId = data.id || data.order?.id
      setSuccess(true)
      setTimeout(() => {
        if (orderId) router.push(`/ops/orders/${orderId}`)
        else router.push('/ops/orders')
      }, 1200)
    } catch (e: any) {
      setError(e?.message || 'Failed to create order')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-data-positive-bg ring-1 ring-border mb-4">
          <CheckCircle2 className="w-8 h-8 text-data-positive" />
        </div>
        <h2 className="text-xl font-semibold text-fg mb-1">Order Created</h2>
        <p className="text-sm text-fg-muted">Redirecting…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-enter max-w-5xl">
      <PageHeader
        eyebrow="Sales Orders"
        title="Create Order from Quote"
        description="Pick an APPROVED quote — items copy, builder + project link, project flips to ORDERED."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Orders', href: '/ops/orders' },
          { label: 'New' },
        ]}
        actions={
          <button type="button" onClick={() => router.back()} className="btn btn-secondary btn-sm">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        }
      />

      {error && (
        <div className="flex items-start gap-2 panel border-l-2 border-l-data-negative p-3">
          <AlertTriangle className="w-4 h-4 text-data-negative shrink-0 mt-0.5" />
          <div className="text-sm text-fg">{error}</div>
        </div>
      )}

      {/* BUG-16: chip when arrived from a builder profile */}
      {builderIdParam && (
        <div className="flex items-center gap-2 bg-signal/5 border border-signal/30 rounded-lg px-3 py-2 text-sm">
          <span className="text-fg-muted">Filtered by:</span>
          <span className="font-medium text-fg">
            {builderName || `Builder ${builderIdParam.slice(0, 8)}`}
          </span>
          <span className="text-xs text-fg-subtle">
            ({filtered.length} approved {filtered.length === 1 ? 'quote' : 'quotes'})
          </span>
          <button
            type="button"
            onClick={() => router.push('/ops/orders/new')}
            className="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
            aria-label="Clear builder filter"
          >
            <X className="w-3 h-3" /> Clear filter
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
        {/* Quote list */}
        <Card variant="default" padding="md">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-fg-muted" />
            <span className="text-sm font-semibold text-fg">Approved Quotes</span>
            <span className="text-xs text-fg-subtle ml-auto">
              {loading ? 'Loading…' : `${filtered.length} of ${quotes.length}`}
            </span>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by quote #, builder, or project…"
              className="input w-full pl-9"
            />
          </div>

          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="text-sm text-fg-muted py-6 text-center">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-fg-muted py-6 text-center">
                {quotes.length === 0
                  ? 'No APPROVED quotes available. Approve a quote first.'
                  : 'No matches.'}
              </div>
            ) : (
              filtered.map((q) => {
                const builder = q.builder?.companyName || q.project?.builder?.companyName || '—'
                const project = q.project?.name || '—'
                const isSelected = selected?.id === q.id
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => selectQuote(q)}
                    className={cn(
                      'w-full text-left px-3 py-3 transition-colors flex items-start justify-between gap-3',
                      isSelected ? 'bg-row-hover ring-1 ring-signal' : 'hover:bg-surface-hover',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-fg truncate">{q.quoteNumber}</div>
                      <div className="text-xs text-fg-muted truncate mt-0.5">
                        {builder} · {project}
                      </div>
                      <div className="text-[11px] text-fg-subtle mt-0.5">
                        {new Date(q.createdAt).toLocaleDateString()}
                        {q.validUntil ? ` · valid until ${new Date(q.validUntil).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-fg">
                        ${q.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </Card>

        {/* Confirmation pane */}
        <Card variant="default" padding="md">
          <div className="text-sm font-semibold text-fg mb-3">Order Details</div>

          {!selected ? (
            <div className="text-sm text-fg-muted py-8 text-center">
              Pick a quote to preview the order.
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="eyebrow">Quote</div>
                <div className="text-sm font-medium text-fg mt-0.5">{selected.quoteNumber}</div>
                <div className="text-xs text-fg-muted mt-0.5">
                  {selected.builder?.companyName || selected.project?.builder?.companyName || '—'}
                  {selected.project?.name ? ` · ${selected.project.name}` : ''}
                </div>
              </div>

              {selected.items && selected.items.length > 0 && (
                <div>
                  <div className="eyebrow mb-1.5">Line items ({selected.items.length})</div>
                  <div className="text-xs space-y-1 max-h-40 overflow-y-auto pr-1">
                    {selected.items.slice(0, 12).map((it) => (
                      <div key={it.id} className="flex items-center justify-between gap-2 text-fg-muted">
                        <span className="truncate">
                          {it.quantity}× {it.description}
                        </span>
                        <span className="tabular-nums shrink-0 text-fg">
                          ${it.lineTotal?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                    {selected.items.length > 12 && (
                      <div className="text-fg-subtle">… and {selected.items.length - 12} more</div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">Delivery Date (optional)</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">Delivery Notes (optional)</label>
                <textarea
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  rows={2}
                  className="input w-full resize-y"
                  placeholder="Special instructions…"
                />
              </div>

              <div className="panel border-l-2 border-l-data-positive p-3 flex items-center justify-between">
                <div className="text-sm font-medium text-fg-muted">Order Total</div>
                <div className="text-lg font-semibold tabular-nums text-data-positive">
                  ${selected.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="btn btn-primary btn-md w-full"
              >
                {submitting ? 'Creating Order…' : 'Confirm — Convert Quote to Order'}
                {!submitting && <ArrowRight className="w-4 h-4 ml-1" />}
              </button>
              <Link href={`/ops/quotes/${selected.id}`} className="text-xs text-fg-subtle hover:text-fg block text-center">
                View full quote →
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[300px] text-sm text-fg-muted">Loading…</div>}>
      <NewOrderForm />
    </Suspense>
  )
}
