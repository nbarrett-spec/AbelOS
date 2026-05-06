'use client'

/**
 * /ops/quotes/new — FIX-6 from PO-SYSTEM-FIXES-HANDOFF.docx (2026-05-04).
 *
 * Manual quote builder for staff. Walks through:
 *   1. Builder selector — search active builders
 *   2. Project selector — projects for the chosen builder; an existing
 *      Takeoff is required (Quote.takeoffId is NOT NULL). The page picks
 *      the most-recent Takeoff for the project automatically. If none
 *      exists, an inline error directs the user to upload a blueprint
 *      first (the takeoff flow already lives in the app).
 *   3. Product search — same /api/ops/products?search= typeahead pattern
 *      from /ops/purchasing/new
 *   4. Line items table — qty, unit price, line total, remove button
 *   5. Notes
 *   6. Save as DRAFT (POST /api/ops/quotes)
 *
 * The quote-create API at /api/ops/quotes accepts:
 *   { builderId, projectId, takeoffId, items, validDays, notes }
 * and applies the builder's payment-term multiplier to compute
 * termAdjustment + total automatically.
 */
import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, AlertTriangle, Search, Plus, Trash2, Package, FileText } from 'lucide-react'
import { PageHeader, Card } from '@/components/ui'
import { cn } from '@/lib/utils'

interface Builder {
  id: string
  companyName: string
  paymentTerm?: string
  status?: string
}

interface Project {
  id: string
  name: string
  jobAddress?: string | null
  status?: string
  builderId: string
}

interface ProductInfo {
  id: string
  name: string
  sku: string
  category?: string
  cost?: number
  basePrice?: number
}

interface LineItem {
  key: string
  productId: string | null
  description: string
  quantity: number
  unitPrice: number
  cost: number
  location?: string
}

function NewQuoteForm() {
  const router = useRouter()
  // BUG-17: when arrived from a builder profile (`?builderId=...`), pre-select
  // the matching builder once the list has loaded. Skipped if the list lacks
  // that builder (e.g. status != ACTIVE filter dropped them).
  const searchParamsHook = useSearchParams()
  const builderIdParam = searchParamsHook?.get('builderId') || null

  const [builders, setBuilders] = useState<Builder[]>([])
  const [builderSearch, setBuilderSearch] = useState('')
  const [selectedBuilder, setSelectedBuilder] = useState<Builder | null>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [latestTakeoffId, setLatestTakeoffId] = useState<string | null>(null)
  const [takeoffError, setTakeoffError] = useState<string | null>(null)

  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [validDays, setValidDays] = useState(30)
  const [notes, setNotes] = useState('')

  // Product search state
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ProductInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // ────── Load builders on mount ──────
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
        // non-fatal — surface in UI on empty list
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ────── BUG-17: pre-select builder from ?builderId= on first match ──────
  useEffect(() => {
    if (!builderIdParam || selectedBuilder) return
    const match = builders.find((b) => b.id === builderIdParam)
    if (match) {
      setSelectedBuilder(match)
      return
    }
    // Builder may be missing from the active list (PENDING/SUSPENDED) — pull
    // it directly so the form can still pre-fill. Best-effort.
    let cancelled = false
    fetch(`/api/admin/builders/${builderIdParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        const b = d?.builder
        if (b?.id) {
          setSelectedBuilder({
            id: b.id,
            companyName: b.companyName,
            paymentTerm: b.paymentTerm,
            status: b.status,
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [builderIdParam, builders, selectedBuilder])

  // ────── Load projects when builder selected ──────
  useEffect(() => {
    if (!selectedBuilder) {
      setProjects([])
      setSelectedProject(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/ops/projects?builderId=${selectedBuilder.id}&limit=200`)
        if (res.ok) {
          const data = await res.json()
          const list: Project[] = Array.isArray(data) ? data : data.projects || data.data || []
          if (!cancelled) {
            setProjects(list)
            setSelectedProject(null)
          }
        }
      } catch {
        // ignore
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedBuilder])

  // ────── When project selected, find its most-recent Takeoff ──────
  useEffect(() => {
    if (!selectedProject) {
      setLatestTakeoffId(null)
      setTakeoffError(null)
      return
    }
    let cancelled = false
    const load = async () => {
      setLatestTakeoffId(null)
      setTakeoffError(null)
      try {
        const res = await fetch(`/api/ops/projects/${selectedProject.id}/takeoffs`)
        if (res.ok) {
          const data = await res.json()
          const list: Array<{ id: string; createdAt: string }> = Array.isArray(data)
            ? data
            : data.takeoffs || data.data || []
          if (cancelled) return
          if (list.length === 0) {
            setTakeoffError(
              'This project has no takeoff yet. Upload a blueprint and run the takeoff flow first, then come back here.',
            )
            return
          }
          // Most recent first
          const sorted = [...list].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          setLatestTakeoffId(sorted[0].id)
        } else if (res.status === 404) {
          setTakeoffError(
            'This project has no takeoff yet. Upload a blueprint and run the takeoff flow first, then come back here.',
          )
        } else {
          setTakeoffError(`Couldn't load takeoffs (HTTP ${res.status}). Try again or contact support.`)
        }
      } catch (e: any) {
        if (!cancelled) setTakeoffError(e?.message || 'Failed to load takeoff')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedProject])

  // ────── Product search (300ms debounced) ──────
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const handleProductSearch = useCallback((q: string) => {
    setProductSearch(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (q.length < 2) {
      setSearchResults([])
      setShowResults(false)
      return
    }
    setSearching(true)
    setShowResults(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ops/products?search=${encodeURIComponent(q)}&take=10`)
        if (res.ok) {
          const data = await res.json()
          const products: ProductInfo[] = Array.isArray(data) ? data : data.products || data.data || []
          setSearchResults(products)
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  const addProductToLines = (p: ProductInfo) => {
    if (lineItems.some((li) => li.productId === p.id)) {
      setError(`${p.sku} is already on this quote`)
      setTimeout(() => setError(''), 3000)
      return
    }
    setLineItems((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        description: p.name,
        quantity: 1,
        unitPrice: p.basePrice || 0,
        cost: p.cost || 0,
        location: '',
      },
    ])
    setProductSearch('')
    setSearchResults([])
    setShowResults(false)
  }

  const addBlankLine = () => {
    setLineItems((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        productId: null,
        description: '',
        quantity: 1,
        unitPrice: 0,
        cost: 0,
        location: '',
      },
    ])
  }

  const updateLine = <K extends keyof LineItem>(key: string, field: K, value: LineItem[K]) =>
    setLineItems((prev) => prev.map((li) => (li.key === key ? { ...li, [field]: value } : li)))

  const removeLine = (key: string) =>
    setLineItems((prev) => prev.filter((li) => li.key !== key))

  const filteredBuilders = useMemo(() => {
    const q = builderSearch.trim().toLowerCase()
    if (!q) return builders.slice(0, 50)
    return builders
      .filter((b) => b.companyName.toLowerCase().includes(q))
      .slice(0, 50)
  }, [builderSearch, builders])

  const subtotal = useMemo(
    () => lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0),
    [lineItems],
  )
  const totalCost = useMemo(
    () => lineItems.reduce((s, li) => s + li.quantity * li.cost, 0),
    [lineItems],
  )
  const grossMargin = subtotal - totalCost
  const grossMarginPercent = subtotal > 0 ? (grossMargin / subtotal) * 100 : 0

  const handleSubmit = async () => {
    setError('')
    if (!selectedBuilder) return setError('Pick a builder first')
    if (!selectedProject) return setError('Pick a project first')
    if (!latestTakeoffId) return setError(takeoffError || 'No takeoff available for this project')
    if (lineItems.length === 0) return setError('Add at least one line item')
    if (lineItems.some((li) => !li.description.trim())) {
      return setError('Every line needs a description')
    }
    if (lineItems.some((li) => li.quantity <= 0)) {
      return setError('Every quantity must be > 0')
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/ops/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderId: selectedBuilder.id,
          projectId: selectedProject.id,
          takeoffId: latestTakeoffId,
          validDays,
          notes: notes || undefined,
          items: lineItems.map((li) => ({
            productId: li.productId,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            location: li.location || undefined,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const quoteId = data.id || data.quote?.id
      setSuccess(true)
      setTimeout(() => {
        if (quoteId) router.push(`/ops/quotes/${quoteId}`)
        else router.push('/ops/quotes')
      }, 1200)
    } catch (e: any) {
      setError(e?.message || 'Failed to create quote')
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
        <h2 className="text-xl font-semibold text-fg mb-1">Quote Created</h2>
        <p className="text-sm text-fg-muted">Redirecting…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        eyebrow="Quotes"
        title="New Quote"
        description="Pick a builder + project, add line items by BC code or name, save as DRAFT."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Quotes', href: '/ops/quotes' },
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

      {/* Step 1 — Builder + Project */}
      <Card variant="default" padding="md">
        <div className="text-sm font-semibold text-fg mb-3">1 · Builder &amp; Project</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Builder *</label>
            {selectedBuilder ? (
              <div className="flex items-center justify-between panel p-2.5">
                <div className="text-sm font-medium text-fg truncate">{selectedBuilder.companyName}</div>
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
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Project *</label>
            <select
              value={selectedProject?.id || ''}
              onChange={(e) => {
                const p = projects.find((x) => x.id === e.target.value) || null
                setSelectedProject(p)
              }}
              disabled={!selectedBuilder || projects.length === 0}
              className="input w-full"
            >
              <option value="">
                {!selectedBuilder
                  ? 'Pick a builder first'
                  : projects.length === 0
                    ? 'No projects for this builder'
                    : 'Select project…'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.jobAddress ? ` — ${p.jobAddress}` : ''}
                </option>
              ))}
            </select>
            {selectedProject && (
              <div className="text-[11px] text-fg-subtle mt-1">
                {takeoffError ? (
                  <span className="text-data-warning">{takeoffError}</span>
                ) : latestTakeoffId ? (
                  <span>Linked takeoff ✓</span>
                ) : (
                  <span>Loading takeoff…</span>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Step 2 — Product search */}
      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-fg-muted" />
          <span className="text-sm font-semibold text-fg">2 · Add Line Items</span>
          <button type="button" onClick={addBlankLine} className="btn btn-secondary btn-xs ml-auto">
            <Plus className="w-3 h-3" /> Custom line
          </button>
        </div>
        <div ref={searchRef} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
          <input
            type="text"
            value={productSearch}
            onChange={(e) => handleProductSearch(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            placeholder="Type BC code or product name… (e.g. BC003764)"
            className="input w-full pl-9"
            autoComplete="off"
          />
          {showResults && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 panel rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-fg-muted">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-fg-muted">
                  {productSearch.length >= 2 ? 'No products found' : 'Type at least 2 characters'}
                </div>
              ) : (
                searchResults.map((product) => {
                  const alreadyAdded = lineItems.some((li) => li.productId === product.id)
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => addProductToLines(product)}
                      className={cn(
                        'w-full px-4 py-2.5 text-left flex items-center justify-between gap-3',
                        alreadyAdded ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface-hover',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg truncate">{product.name}</div>
                        <div className="text-xs text-fg-muted font-mono mt-0.5">
                          {product.sku}
                          <span className="text-fg-subtle"> · </span>
                          {product.category}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-fg-muted">${(product.basePrice || 0).toFixed(2)}</div>
                        <div className="text-[11px] text-fg-subtle">cost ${(product.cost || 0).toFixed(2)}</div>
                      </div>
                      {!alreadyAdded && <Plus className="w-4 h-4 text-fg-muted shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Line items table */}
        {lineItems.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="hidden md:grid grid-cols-[1.7fr_70px_90px_90px_90px_32px] gap-2 px-1 pb-2 border-b border-border">
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider">Description</div>
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Qty</div>
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Unit Price</div>
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Cost</div>
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Line</div>
              <div />
            </div>
            <div className="divide-y divide-border">
              {lineItems.map((li) => (
                <div
                  key={li.key}
                  className="grid grid-cols-1 md:grid-cols-[1.7fr_70px_90px_90px_90px_32px] gap-2 py-2 px-1 items-center"
                >
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => updateLine(li.key, 'description', e.target.value)}
                    className="input w-full text-sm"
                    placeholder="Product or custom description"
                  />
                  <input
                    type="number"
                    min={1}
                    value={li.quantity}
                    onChange={(e) => updateLine(li.key, 'quantity', Number(e.target.value))}
                    className="input w-full text-right tabular-nums text-sm"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={li.unitPrice}
                    onChange={(e) => updateLine(li.key, 'unitPrice', Number(e.target.value))}
                    className="input w-full text-right tabular-nums text-sm"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={li.cost}
                    onChange={(e) => updateLine(li.key, 'cost', Number(e.target.value))}
                    className="input w-full text-right tabular-nums text-sm"
                  />
                  <div className="text-sm tabular-nums text-right text-fg font-medium self-center">
                    ${(li.quantity * li.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(li.key)}
                    className="text-fg-subtle hover:text-data-negative justify-self-center"
                    title="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Step 3 — Notes + margin + submit */}
      <Card variant="default" padding="md">
        <div className="text-sm font-semibold text-fg mb-3">3 · Quote Details</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Valid for (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={validDays}
              onChange={(e) => setValidDays(Number(e.target.value) || 30)}
              className="input w-full"
            />
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
            placeholder="Any special terms…"
          />
        </div>

        {/* Margin summary */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="panel p-3">
            <div className="eyebrow">Subtotal</div>
            <div className="text-base font-semibold tabular-nums text-fg mt-0.5">
              ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="panel p-3">
            <div className="eyebrow">Total Cost</div>
            <div className="text-base font-semibold tabular-nums text-fg mt-0.5">
              ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div
            className={cn(
              'panel p-3 border-l-2',
              grossMarginPercent >= 30
                ? 'border-l-data-positive'
                : grossMarginPercent >= 15
                  ? 'border-l-data-warning'
                  : 'border-l-data-negative',
            )}
          >
            <div className="eyebrow">Margin</div>
            <div className="text-base font-semibold tabular-nums text-fg mt-0.5">
              ${grossMargin.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              <span className="text-xs text-fg-muted ml-1">({grossMarginPercent.toFixed(1)}%)</span>
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs text-fg-subtle leading-relaxed">
          <FileText className="w-3 h-3 inline mr-1" />
          Total above is pre-adjustment. The server applies the builder's payment-term multiplier
          (PAY_AT_ORDER −3%, PAY_ON_DELIVERY −2%, NET_15 0%, NET_30 +2%) and writes the final
          total + termAdjustment to the Quote on save.
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !selectedBuilder || !selectedProject || !latestTakeoffId || lineItems.length === 0}
            className="btn btn-primary btn-md flex-1"
          >
            {submitting ? 'Creating Quote…' : 'Save Quote (DRAFT)'}
          </button>
          <button type="button" onClick={() => router.push('/ops/quotes')} className="btn btn-secondary btn-md">
            Cancel
          </button>
        </div>
      </Card>
    </div>
  )
}

export default function NewQuotePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[300px] text-sm text-fg-muted">Loading…</div>}>
      <NewQuoteForm />
    </Suspense>
  )
}
