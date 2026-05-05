'use client'

/**
 * /ops/invoices/new — Manual Invoice Builder
 *
 * FIX-2 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). The Invoice
 * model already supports orderId / jobId as optional, and POST
 * /api/ops/invoices accepts builderId + paymentTerm + items[] without
 * an order. This page is the missing UI surface — a manual invoice
 * builder for charges that aren't tied to an order or job (e.g. retainer
 * fees, equipment rental, ad-hoc service).
 *
 * Flow
 *   1. Pick builder (search active accounts).
 *   2. Adjust payment term — defaults to the builder's term, override allowed.
 *   3. Add line items: description, qty, unit price (manual entry, no SKU lookup).
 *   4. Optional tax rate (percent applied to subtotal).
 *   5. Save → POST /api/ops/invoices → redirect to detail page.
 *
 * The companion API change in this commit accepts taxRate (percentage) or
 * taxAmount (explicit dollars); either or neither is fine.
 */
import { useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Plus, Trash2, FileText } from 'lucide-react'
import { PageHeader, Card } from '@/components/ui'

interface Builder {
  id: string
  companyName: string
  paymentTerm?: string
  status?: string
}

interface LineItem {
  key: string
  description: string
  quantity: number
  unitPrice: number
}

const PAYMENT_TERMS = ['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30'] as const

function newKey() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function NewManualInvoiceForm() {
  const router = useRouter()

  // ── Form state ─────────────────────────────────────────────────────
  const [builders, setBuilders] = useState<Builder[]>([])
  const [builderSearch, setBuilderSearch] = useState('')
  const [selectedBuilder, setSelectedBuilder] = useState<Builder | null>(null)

  const [paymentTerm, setPaymentTerm] = useState<string>('NET_30')
  const [taxRate, setTaxRate] = useState<number>(0)
  const [notes, setNotes] = useState('')

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { key: newKey(), description: '', quantity: 1, unitPrice: 0 },
  ])

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // ── Load builders on mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/ops/builders?status=ACTIVE&limit=500')
        if (res.ok) {
          const data = await res.json()
          const list: Builder[] = Array.isArray(data) ? data : data.builders || data.data || []
          if (!cancelled) setBuilders(list)
        }
      } catch {
        // surfaced via empty list in UI
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-fill payment term from builder when one is picked
  useEffect(() => {
    if (selectedBuilder?.paymentTerm) {
      setPaymentTerm(selectedBuilder.paymentTerm)
    }
  }, [selectedBuilder])

  const filteredBuilders = useMemo(() => {
    const q = builderSearch.trim().toLowerCase()
    if (!q) return builders.slice(0, 50)
    return builders.filter((b) => b.companyName.toLowerCase().includes(q)).slice(0, 50)
  }, [builderSearch, builders])

  // ── Line-item helpers ──────────────────────────────────────────────
  const addLine = () =>
    setLineItems((prev) => [
      ...prev,
      { key: newKey(), description: '', quantity: 1, unitPrice: 0 },
    ])

  const removeLine = (key: string) =>
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)))

  const updateLine = <K extends keyof LineItem>(key: string, field: K, value: LineItem[K]) =>
    setLineItems((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)))

  // ── Totals ─────────────────────────────────────────────────────────
  const subtotal = useMemo(
    () => lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    [lineItems],
  )
  const taxAmount = useMemo(() => +(subtotal * (taxRate / 100)).toFixed(2), [subtotal, taxRate])
  const total = +(subtotal + taxAmount).toFixed(2)

  // ── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError('')
    if (!selectedBuilder) return setError('Pick a builder first')
    if (lineItems.length === 0) return setError('Add at least one line item')
    if (lineItems.some((l) => !l.description.trim())) {
      return setError('Every line needs a description')
    }
    if (lineItems.some((l) => l.quantity <= 0)) {
      return setError('Every quantity must be greater than 0')
    }
    if (lineItems.some((l) => l.unitPrice < 0)) {
      return setError('Unit price cannot be negative')
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/ops/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderId: selectedBuilder.id,
          paymentTerm,
          taxRate: taxRate > 0 ? taxRate : undefined,
          notes: notes || undefined,
          items: lineItems.map((l) => ({
            description: l.description.trim(),
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const invoiceId = data.id || data.invoice?.id
      setSuccess(true)
      setTimeout(() => {
        if (invoiceId) router.push(`/ops/invoices/${invoiceId}`)
        else router.push('/ops/invoices')
      }, 800)
    } catch (e: any) {
      setError(e?.message || 'Failed to create invoice')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <FileText className="w-10 h-10 text-data-positive mx-auto mb-3" />
        <h2 className="text-xl font-semibold text-fg mb-1">Invoice created</h2>
        <p className="text-sm text-fg-muted">Redirecting…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        eyebrow="Invoices"
        title="New Manual Invoice"
        description="Bill a builder for charges not tied to an order or PO. Use this for retainer fees, ad-hoc services, equipment rental, etc."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Invoices', href: '/ops/invoices' },
          { label: 'New (manual)' },
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

      {/* Step 1 — Builder + Terms */}
      <Card variant="default" padding="md">
        <div className="text-sm font-semibold text-fg mb-3">1 · Builder &amp; Terms</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Builder *</label>
            {selectedBuilder ? (
              <div className="flex items-center justify-between panel p-2.5">
                <div className="text-sm font-medium text-fg truncate">
                  {selectedBuilder.companyName}
                  {selectedBuilder.paymentTerm && (
                    <span className="ml-2 text-[11px] text-fg-subtle font-mono">
                      ({selectedBuilder.paymentTerm.replace('_', ' ')})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBuilder(null)
                    setBuilderSearch('')
                  }}
                  className="text-xs text-fg-subtle hover:text-fg"
                >
                  change
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  type="text"
                  value={builderSearch}
                  onChange={(e) => setBuilderSearch(e.target.value)}
                  placeholder="Search builder…"
                  className="input w-full"
                  autoFocus
                />
                {builderSearch.trim() && (
                  <div className="panel max-h-48 overflow-y-auto">
                    {filteredBuilders.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-fg-muted">No matches</div>
                    ) : (
                      filteredBuilders.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setSelectedBuilder(b)
                            setBuilderSearch('')
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-sm text-fg"
                        >
                          {b.companyName}
                          {b.paymentTerm && (
                            <span className="ml-2 text-[11px] text-fg-subtle font-mono">
                              {b.paymentTerm.replace('_', ' ')}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Payment Term</label>
            <select
              value={paymentTerm}
              onChange={(e) => setPaymentTerm(e.target.value)}
              className="input w-full"
            >
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {selectedBuilder?.paymentTerm &&
              selectedBuilder.paymentTerm !== paymentTerm && (
                <div className="text-[11px] text-fg-subtle mt-1">
                  Builder default: {selectedBuilder.paymentTerm.replace('_', ' ')} (overridden)
                </div>
              )}
          </div>
        </div>
      </Card>

      {/* Step 2 — Line items */}
      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-fg">2 · Line Items</span>
          <button type="button" onClick={addLine} className="btn btn-secondary btn-xs ml-auto">
            <Plus className="w-3 h-3" /> Add line
          </button>
        </div>

        <div className="hidden md:grid grid-cols-[1fr_90px_110px_110px_32px] gap-2 px-1 pb-2 border-b border-border">
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider">
            Description
          </div>
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">
            Qty
          </div>
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">
            Unit Price
          </div>
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">
            Line
          </div>
          <div />
        </div>

        <div className="divide-y divide-border">
          {lineItems.map((l) => (
            <div
              key={l.key}
              className="grid grid-cols-1 md:grid-cols-[1fr_90px_110px_110px_32px] gap-2 py-2 px-1 items-center"
            >
              <input
                type="text"
                value={l.description}
                onChange={(e) => updateLine(l.key, 'description', e.target.value)}
                className="input w-full text-sm"
                placeholder="What is this line for?"
              />
              <input
                type="number"
                min={1}
                value={l.quantity}
                onChange={(e) =>
                  updateLine(l.key, 'quantity', Math.max(0, Number(e.target.value) || 0))
                }
                className="input w-full text-right tabular-nums text-sm"
              />
              <input
                type="number"
                step="0.01"
                min={0}
                value={l.unitPrice}
                onChange={(e) =>
                  updateLine(l.key, 'unitPrice', Math.max(0, Number(e.target.value) || 0))
                }
                className="input w-full text-right tabular-nums text-sm"
              />
              <div className="text-sm tabular-nums text-right text-fg font-medium self-center">
                ${(l.quantity * l.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <button
                type="button"
                onClick={() => removeLine(l.key)}
                disabled={lineItems.length === 1}
                className="text-fg-subtle hover:text-data-negative disabled:opacity-30 disabled:cursor-not-allowed justify-self-center"
                title={lineItems.length === 1 ? 'At least one line required' : 'Remove line'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Step 3 — Totals + notes */}
      <Card variant="default" padding="md">
        <div className="text-sm font-semibold text-fg mb-3">3 · Tax, Notes &amp; Total</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Tax Rate (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(Math.max(0, Number(e.target.value) || 0))}
              className="input w-full"
            />
            <div className="text-[11px] text-fg-subtle mt-1">
              Applied to subtotal. Leave 0 for no tax.
            </div>
          </div>
          <div className="hidden md:block" />
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-fg-muted mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input w-full resize-y"
            placeholder="Anything special — payment instructions, reference numbers, etc."
          />
        </div>

        {/* Totals summary */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="panel p-3">
            <div className="eyebrow">Subtotal</div>
            <div className="text-base font-semibold tabular-nums text-fg mt-0.5">
              ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="panel p-3">
            <div className="eyebrow">Tax ({taxRate}%)</div>
            <div className="text-base font-semibold tabular-nums text-fg mt-0.5">
              ${taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="panel p-3 border-l-2 border-l-brand">
            <div className="eyebrow">Total</div>
            <div className="text-base font-semibold tabular-nums text-fg mt-0.5">
              ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !selectedBuilder || lineItems.length === 0}
            className="btn btn-primary btn-md flex-1"
          >
            {submitting ? 'Creating Invoice…' : 'Create Invoice'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/ops/invoices')}
            className="btn btn-secondary btn-md"
          >
            Cancel
          </button>
        </div>
      </Card>
    </div>
  )
}

export default function NewManualInvoicePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[300px] text-sm text-fg-muted">
          Loading…
        </div>
      }
    >
      <NewManualInvoiceForm />
    </Suspense>
  )
}
