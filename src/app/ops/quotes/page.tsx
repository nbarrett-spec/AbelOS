'use client'

import { useState, useEffect, useCallback } from 'react'

interface QuoteItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  location?: string
  product?: { name: string; sku: string }
}

interface EditableLineItem {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  location?: string
}

interface Quote {
  id: string
  quoteNumber: string
  status: string
  subtotal: number
  termAdjustment: number
  total: number
  validUntil: string
  notes?: string
  createdAt: string
  items: QuoteItem[]
  project?: {
    name: string
    planName?: string
    builder?: { id: string; companyName: string; contactName: string }
  }
}

interface Builder {
  id: string
  companyName: string
  contactName: string
  email: string
}

interface Project {
  id: string
  name: string
  planName?: string
}

interface NewLineItem {
  description: string
  quantity: number
  unitPrice: number
  location: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SENT: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-yellow-100 text-yellow-700',
  ORDERED: 'bg-indigo-100 text-indigo-700',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function SortIcon({ col, currentSort, currentDir }: { col: string; currentSort: string; currentDir: string }) {
  if (col !== currentSort) {
    return <span className="ml-1 text-[10px] text-gray-400">⇅</span>
  }
  return <span className="ml-1 text-[10px]">{currentDir === 'asc' ? '▲' : '▼'}</span>
}

export default function OpsQuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  // Create modal state
  const [showCreate, setShowCreate] = useState(false)
  const [builders, setBuilders] = useState<Builder[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedBuilder, setSelectedBuilder] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [quoteNotes, setQuoteNotes] = useState('')
  const [lineItems, setLineItems] = useState<NewLineItem[]>([
    { description: '', quantity: 1, unitPrice: 0, location: '' },
  ])
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null)
  const [editItems, setEditItems] = useState<EditableLineItem[]>([])
  const [editValidUntil, setEditValidUntil] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteQuoteId, setDeleteQuoteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // AI optimization state
  const [aiOptimizing, setAiOptimizing] = useState(false)
  const [aiResult, setAiResult] = useState<{ appliedRules: string[]; reasoning: string; marginBefore: number; marginAfter: number } | null>(null)

  // Toast notification
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  const fetchQuotes = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      params.set('sortBy', sortBy)
      params.set('sortDir', sortDir)
      params.set('page', String(page))
      params.set('limit', '50')
      const res = await fetch(`/api/ops/quotes?${params}`)
      const data = await res.json()
      setQuotes(data.data || [])
      setTotal(data.pagination?.total || 0)
    } catch (err) {
      console.error('Failed to fetch quotes:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search, dateFrom, dateTo, sortBy, sortDir, page])

  useEffect(() => { fetchQuotes() }, [fetchQuotes])

  // Load builders when create modal opens
  useEffect(() => {
    if (!showCreate) return
    fetch('/api/ops/builders')
      .then(r => r.json())
      .then(d => setBuilders(d.builders || d.data || []))
      .catch(() => {})
  }, [showCreate])

  // Load projects when builder selected
  useEffect(() => {
    if (!selectedBuilder) { setProjects([]); return }
    fetch(`/api/projects?builderId=${selectedBuilder}`)
      .then(r => r.json())
      .then(d => setProjects(d.projects || d || []))
      .catch(() => {})
  }, [selectedBuilder])

  async function updateStatus(quoteId: string, newStatus: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/ops/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: quoteId, status: newStatus }),
      })
      if (res.ok) fetchQuotes()
    } catch (err) {
      console.error('Status update failed:', err)
    } finally {
      setSaving(false)
    }
  }

  async function convertToOrder(quote: Quote) {
    if (!quote.project?.builder?.id) {
      showToast('This quote has no linked builder', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/ops/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: quote.id, builderId: quote.project.builder.id }),
      })
      if (res.ok) {
        showToast(`Order created from ${quote.quoteNumber}!`)
        fetchQuotes()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to convert to order', 'error')
      }
    } catch (err) {
      console.error('Convert to order failed:', err)
    } finally {
      setSaving(false)
    }
  }

  function addLineItem() {
    setLineItems([...lineItems, { description: '', quantity: 1, unitPrice: 0, location: '' }])
  }

  function removeLineItem(idx: number) {
    setLineItems(lineItems.filter((_, i) => i !== idx))
  }

  function updateLineItem(idx: number, field: keyof NewLineItem, value: string | number) {
    const updated = [...lineItems]
    ;(updated[idx] as any)[field] = value
    setLineItems(updated)
  }

  async function handleCreateQuote() {
    const validItems = lineItems.filter(i => i.description.trim() && i.unitPrice > 0)
    if (!selectedBuilder || validItems.length === 0) {
      showToast('Select a builder and add at least one line item with description and price', 'error')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/ops/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderId: selectedBuilder,
          projectId: selectedProject || undefined,
          notes: quoteNotes || undefined,
          items: validItems.map(i => ({
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            location: i.location || undefined,
          })),
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setSelectedBuilder('')
        setSelectedProject('')
        setQuoteNotes('')
        setLineItems([{ description: '', quantity: 1, unitPrice: 0, location: '' }])
        fetchQuotes()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to create quote', 'error')
      }
    } catch (err) {
      console.error('Create quote failed:', err)
    } finally {
      setCreating(false)
    }
  }

  function openEditModal(quote: Quote) {
    setAiResult(null)
    setEditingQuote(quote)
    setEditItems(quote.items.map(item => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      location: item.location,
    })))
    setEditValidUntil(quote.validUntil.split('T')[0])
    setEditNotes(quote.notes || '')
    setShowEditModal(true)
  }

  function closeEditModal() {
    setShowEditModal(false)
    setEditingQuote(null)
    setEditItems([])
    setEditValidUntil('')
    setEditNotes('')
  }

  function addEditLineItem() {
    setEditItems([...editItems, { description: '', quantity: 1, unitPrice: 0, location: '' }])
  }

  function removeEditLineItem(idx: number) {
    setEditItems(editItems.filter((_, i) => i !== idx))
  }

  function updateEditLineItem(idx: number, field: keyof EditableLineItem, value: string | number) {
    const updated = [...editItems]
    ;(updated[idx] as any)[field] = value
    setEditItems(updated)
  }

  async function handleSaveEdit() {
    if (!editingQuote) return

    const validItems = editItems.filter(i => i.description.trim() && i.unitPrice > 0)
    if (validItems.length === 0) {
      showToast('Add at least one line item with description and price', 'error')
      return
    }

    setEditSaving(true)
    try {
      const res = await fetch('/api/ops/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingQuote.id,
          notes: editNotes || undefined,
          validUntil: editValidUntil ? new Date(editValidUntil).toISOString() : undefined,
          items: validItems.map(item => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            location: item.location || undefined,
          })),
        }),
      })

      if (res.ok) {
        showToast('Quote updated successfully')
        closeEditModal()
        fetchQuotes()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to save changes', 'error')
      }
    } catch (err) {
      console.error('Save edit failed:', err)
      showToast('Failed to save changes', 'error')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleAiOptimize() {
    if (!editingQuote?.project?.builder?.id) {
      showToast('Cannot optimize — no builder assigned to this quote', 'error')
      return
    }

    const validItems = editItems.filter(i => i.description.trim() && i.unitPrice > 0)
    if (validItems.length === 0) {
      showToast('Add line items with prices before optimizing', 'error')
      return
    }

    setAiOptimizing(true)
    setAiResult(null)
    try {
      const res = await fetch('/api/ops/revenue-intelligence/pricing-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'optimize_quote',
          quoteId: editingQuote.id,
          builderId: editingQuote.project.builder.id,
          items: validItems.map(i => ({
            productId: (i as any).productId || i.id || '',
            quantity: i.quantity,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        showToast(err.error || 'AI optimization failed', 'error')
        return
      }

      const data = await res.json()
      const opt = data.optimized

      if (opt?.items?.length > 0) {
        // Apply optimized prices to line items where we got results
        const updatedItems = [...editItems]
        for (const optItem of opt.items) {
          const idx = updatedItems.findIndex(i => i.id === optItem.productId || (i as any).productId === optItem.productId)
          if (idx >= 0 && optItem.optimizedPrice > 0) {
            updatedItems[idx] = { ...updatedItems[idx], unitPrice: optItem.optimizedPrice }
          }
        }
        setEditItems(updatedItems)
      }

      setAiResult({
        appliedRules: opt?.appliedRules || [],
        reasoning: opt?.reasoning || 'No optimization applied',
        marginBefore: opt?.marginBefore || 0,
        marginAfter: opt?.marginAfter || 0,
      })

      showToast(`AI optimized pricing — ${opt?.appliedRules?.length || 0} rules applied`)
    } catch (err) {
      console.error('AI optimize failed:', err)
      showToast('AI optimization failed', 'error')
    } finally {
      setAiOptimizing(false)
    }
  }

  async function handleDeleteQuote(quoteId: string) {
    setDeleteQuoteId(quoteId)
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    if (!deleteQuoteId) return

    setDeleting(true)
    try {
      const res = await fetch('/api/ops/quotes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteQuoteId }),
      })

      if (res.ok) {
        showToast('Quote deleted')
        setShowDeleteConfirm(false)
        setDeleteQuoteId(null)
        fetchQuotes()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to delete quote', 'error')
      }
    } catch (err) {
      console.error('Delete failed:', err)
      showToast('Failed to delete quote', 'error')
    } finally {
      setDeleting(false)
    }
  }

  // KPIs
  const kpis = {
    total: quotes.length,
    draft: quotes.filter(q => q.status === 'DRAFT').length,
    sent: quotes.filter(q => q.status === 'SENT').length,
    totalValue: quotes.reduce((s, q) => s + Number(q.total), 0),
  }

  const newItemTotal = lineItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0)
  const statuses = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'ORDERED']

  return (
    <div className="max-w-[1200px]">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
        }`}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quote Management</h1>
          <p className="text-sm text-gray-500 mt-1">Create, review, and send quotes to builders</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => window.open('/api/ops/export?type=quotes', '_blank')}
            className="px-5 py-2.5 bg-gray-600 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 bg-[#C6A24E] text-white rounded-lg text-sm font-semibold hover:bg-[#A8882A] transition-colors"
          >
            + Create Quote
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Quotes</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{total}</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-yellow-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Drafts</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{kpis.draft}</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Sent / Awaiting</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{kpis.sent}</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-green-600 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Pipeline Value</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{fmt(kpis.totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search quotes, builders, projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-lg text-sm w-72 focus:outline-none focus:border-[#0f2a3e]"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setStatusFilter('')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              !statusFilter ? 'bg-[#0f2a3e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === s ? 'bg-[#0f2a3e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">From</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]/30 focus:border-[#0f2a3e]" />
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">To</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]/30 focus:border-[#0f2a3e]" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
              className="text-xs text-red-500 hover:text-red-700 font-medium">Clear</button>
          )}
        </div>
      </div>

      {/* Quotes List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
        </div>
      ) : quotes.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <p className="text-lg text-gray-500 mb-2">No quotes found</p>
          <p className="text-sm text-gray-400">Create your first quote or adjust filters</p>
        </div>
      ) : (
        <>
          {/* Table Header with Sortable Columns */}
          <div className="bg-white rounded-t-xl border border-b-0 px-5 py-4">
            <div className="flex justify-between items-center text-xs text-gray-600 uppercase tracking-wider font-semibold">
              <div className="flex-1 cursor-pointer hover:text-gray-900" onClick={() => toggleSort('quoteNumber')}>
                Quote # <SortIcon col="quoteNumber" currentSort={sortBy} currentDir={sortDir} />
              </div>
              <div className="flex-1 cursor-pointer hover:text-gray-900" onClick={() => toggleSort('builder')}>
                Builder/Project <SortIcon col="builder" currentSort={sortBy} currentDir={sortDir} />
              </div>
              <div className="flex-1 cursor-pointer hover:text-gray-900 text-right" onClick={() => toggleSort('total')}>
                Total <SortIcon col="total" currentSort={sortBy} currentDir={sortDir} />
              </div>
              <div className="flex-1 cursor-pointer hover:text-gray-900" onClick={() => toggleSort('status')}>
                Status <SortIcon col="status" currentSort={sortBy} currentDir={sortDir} />
              </div>
              <div className="flex-1 cursor-pointer hover:text-gray-900" onClick={() => toggleSort('createdAt')}>
                Date <SortIcon col="createdAt" currentSort={sortBy} currentDir={sortDir} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-0 border border-t-0 rounded-b-xl overflow-hidden">
            {quotes.map((quote, idx) => {
              const isExpanded = expandedQuote === quote.id
              const isExpired = new Date(quote.validUntil) < new Date() && quote.status === 'SENT'

              return (
                <div key={quote.id} className={`bg-white ${idx !== quotes.length - 1 ? 'border-b' : ''} overflow-hidden`}>
                  {/* Header Row */}
                  <div
                    onClick={() => setExpandedQuote(isExpanded ? null : quote.id)}
                    className="px-5 py-4 cursor-pointer flex justify-between items-center hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1">
                      <span className="text-sm font-bold text-[#0f2a3e] font-mono">{quote.quoteNumber}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">
                        {quote.project?.builder?.companyName || 'Unknown Builder'}
                        {quote.project?.name ? ` — ${quote.project.name}` : ''}
                      </p>
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-lg font-bold text-gray-900">{fmt(quote.total)}</p>
                    </div>
                    <div className="flex-1">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLORS[quote.status] || 'bg-gray-100 text-gray-600'}`}>
                        {quote.status}
                      </span>
                      {isExpired && (
                        <span className="inline-block ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">EXPIRED</span>
                      )}
                    </div>
                    <div className="flex-1 text-sm text-gray-400">{new Date(quote.createdAt).toLocaleDateString()}</div>
                  </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t px-5 py-4">
                    {/* Notes */}
                    {quote.notes && (
                      <div className="mb-4 p-3 bg-yellow-50 rounded-lg text-sm text-yellow-800">
                        <span className="font-semibold">Notes:</span> {quote.notes}
                      </div>
                    )}

                    {/* Line Items Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-gray-500 uppercase tracking-wider">
                            <th className="text-left py-2 font-semibold">Item</th>
                            <th className="text-left py-2 font-semibold">Location</th>
                            <th className="text-right py-2 font-semibold">Qty</th>
                            <th className="text-right py-2 font-semibold">Unit</th>
                            <th className="text-right py-2 font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quote.items.map(item => (
                            <tr key={item.id} className="border-b border-gray-50">
                              <td className="py-2 text-gray-800">
                                {item.description}
                                {item.product?.sku && <span className="text-gray-400 ml-2 text-xs">{item.product.sku}</span>}
                              </td>
                              <td className="py-2 text-gray-500">{item.location || '—'}</td>
                              <td className="py-2 text-right text-gray-800">{item.quantity}</td>
                              <td className="py-2 text-right text-gray-800">{fmt(item.unitPrice)}</td>
                              <td className="py-2 text-right font-semibold text-gray-900">{fmt(item.lineTotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2">
                            <td colSpan={4} className="py-2 text-right font-semibold text-gray-500">Subtotal</td>
                            <td className="py-2 text-right font-semibold">{fmt(quote.subtotal)}</td>
                          </tr>
                          {quote.termAdjustment !== 0 && (
                            <tr>
                              <td colSpan={4} className="py-1 text-right text-xs text-gray-400">Term Adjustment</td>
                              <td className="py-1 text-right text-xs text-gray-400">{fmt(quote.termAdjustment)}</td>
                            </tr>
                          )}
                          <tr>
                            <td colSpan={4} className="py-2 text-right font-bold text-gray-900">Total</td>
                            <td className="py-2 text-right font-bold text-lg text-[#0f2a3e]">{fmt(quote.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-4 pt-4 border-t flex-wrap">
                      <div className="flex gap-2 flex-wrap">
                        {quote.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => updateStatus(quote.id, 'SENT')}
                              disabled={saving}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                            >
                              Send to Builder
                            </button>
                            <button
                              onClick={() => updateStatus(quote.id, 'APPROVED')}
                              disabled={saving}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                            >
                              Mark Approved
                            </button>
                          </>
                        )}
                        {quote.status === 'SENT' && (
                          <>
                            <button onClick={() => updateStatus(quote.id, 'APPROVED')} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                              Mark Approved
                            </button>
                            <button onClick={() => updateStatus(quote.id, 'REJECTED')} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                              Mark Rejected
                            </button>
                          </>
                        )}
                        {quote.status === 'APPROVED' && (
                          <button onClick={() => convertToOrder(quote)} disabled={saving} className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg text-sm font-semibold hover:bg-[#0a1a28] disabled:opacity-50">
                            Convert to Order
                          </button>
                        )}
                        {quote.status === 'ORDERED' && (
                          <span className="text-sm text-green-600 font-semibold">Order created from this quote</span>
                        )}

                        {/* Edit button for DRAFT and SENT */}
                        {(quote.status === 'DRAFT' || quote.status === 'SENT') && (
                          <button
                            onClick={() => openEditModal(quote)}
                            className="px-4 py-2 bg-[#C6A24E] text-white rounded-lg text-sm font-semibold hover:bg-[#A8882A]"
                          >
                            Edit Quote
                          </button>
                        )}

                        {/* Delete button for DRAFT and SENT */}
                        {(quote.status === 'DRAFT' || quote.status === 'SENT') && (
                          <button
                            onClick={() => handleDeleteQuote(quote.id)}
                            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-200"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 ml-auto">
                        Valid until {new Date(quote.validUntil).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              )
            })}
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="mt-6 flex justify-center items-center gap-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button
                onClick={() => setPage(p => Math.min(Math.ceil(total / 50), p + 1))}
                disabled={page >= Math.ceil(total / 50)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* ── EDIT QUOTE MODAL ──────────────────────────────────── */}
      {showEditModal && editingQuote && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-10 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 mb-10">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Quote</h2>
                <p className="text-sm text-gray-500">{editingQuote.quoteNumber} — {editingQuote.project?.builder?.companyName}</p>
              </div>
              <button onClick={closeEditModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="p-6 space-y-5">
              {/* Quote Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Quote Number</label>
                  <input
                    type="text"
                    value={editingQuote.quoteNumber}
                    disabled
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
                  <input
                    type="text"
                    value={editingQuote.status}
                    disabled
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                  />
                </div>
              </div>

              {/* Valid Until */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Valid Until</label>
                <input
                  type="date"
                  value={editValidUntil}
                  onChange={e => setEditValidUntil(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={2}
                  placeholder="Internal notes about this quote..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e] resize-none"
                />
              </div>

              {/* Line Items */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-gray-700">Line Items</label>
                  <button onClick={addEditLineItem} className="text-xs font-semibold text-[#C6A24E] hover:text-[#A8882A]">
                    + Add Item
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_120px_80px_100px_32px] gap-2 text-xs font-semibold text-gray-500 uppercase px-1">
                    <span>Description</span>
                    <span>Location</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Unit Price</span>
                    <span></span>
                  </div>
                  {editItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_120px_80px_100px_32px] gap-2 items-center">
                      <input
                        value={item.description}
                        onChange={e => updateEditLineItem(idx, 'description', e.target.value)}
                        placeholder="e.g., 2068 Hollow Core Door"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <input
                        value={item.location || ''}
                        onChange={e => updateEditLineItem(idx, 'location', e.target.value)}
                        placeholder="e.g., Master"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateEditLineItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                        min={1}
                        className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <input
                        type="number"
                        value={item.unitPrice || ''}
                        onChange={e => updateEditLineItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        placeholder="0.00"
                        className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <button
                        onClick={() => removeEditLineItem(idx)}
                        disabled={editItems.length <= 1}
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-20 rounded"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Running Totals */}
              <div className="flex justify-end">
                <div className="bg-gray-50 rounded-lg px-5 py-3 text-right w-full max-w-xs">
                  <div className="mb-2">
                    <p className="text-xs text-gray-500 uppercase">Subtotal</p>
                    <p className="text-lg font-bold text-gray-900">{fmt(editItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0))}</p>
                  </div>
                  {editingQuote.termAdjustment !== 0 && (
                    <div className="mb-2 pb-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500">Term Adjustment</p>
                      <p className="text-sm text-gray-600">{fmt((editingQuote.termAdjustment / editingQuote.subtotal) * editItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0))}</p>
                    </div>
                  )}
                  <div className="border-t border-gray-200 pt-2">
                    <p className="text-xs text-gray-500 uppercase">Estimated Total</p>
                    <p className="text-xl font-bold text-[#0f2a3e]">{fmt(editItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0) * (1 + (editingQuote.termAdjustment / editingQuote.subtotal || 0)))}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Optimization Result */}
            {aiResult && (
              <div className="mx-6 mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🤖</span>
                  <span className="font-bold text-sm text-[#0f2a3e]">AI Optimization Applied</span>
                </div>
                <p className="text-xs text-gray-600 mb-2">{aiResult.reasoning}</p>
                {aiResult.appliedRules.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {aiResult.appliedRules.map((rule, i) => (
                      <span key={i} className="text-xs bg-white px-2 py-1 rounded border border-blue-200 text-blue-700 font-medium">{rule}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 text-xs">
                  <span className="text-gray-500">Margin: <strong className="text-gray-700">{aiResult.marginBefore.toFixed(1)}%</strong> → <strong className="text-green-600">{aiResult.marginAfter.toFixed(1)}%</strong></span>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t flex justify-between items-center">
              <button
                onClick={handleAiOptimize}
                disabled={aiOptimizing || editItems.every(i => !i.description.trim())}
                className="px-4 py-2.5 bg-gradient-to-r from-[#0f2a3e] to-[#2980b9] text-white rounded-lg text-sm font-semibold hover:from-[#153d59] hover:to-[#1f6fa0] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {aiOptimizing ? (
                  <>⏳ Optimizing...</>
                ) : (
                  <>🤖 AI Optimize Pricing</>
                )}
              </button>
              <div className="flex gap-3">
                <button
                  onClick={closeEditModal}
                  className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving || editItems.every(i => !i.description.trim())}
                  className="px-6 py-2.5 bg-[#C6A24E] text-white rounded-lg text-sm font-semibold hover:bg-[#A8882A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION DIALOG ────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Quote?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete quote <span className="font-semibold">{deleteQuoteId && quotes.find(q => q.id === deleteQuoteId)?.quoteNumber}</span>? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete Quote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE QUOTE MODAL ────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-10 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 mb-10">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Create New Quote</h2>
                <p className="text-sm text-gray-500">Build a quote for a builder project</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="p-6 space-y-5">
              {/* Builder Select */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Builder *</label>
                  <select
                    value={selectedBuilder}
                    onChange={e => { setSelectedBuilder(e.target.value); setSelectedProject('') }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                  >
                    <option value="">Select a builder...</option>
                    {builders.map(b => (
                      <option key={b.id} value={b.id}>{b.companyName} — {b.contactName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Project (optional)</label>
                  <select
                    value={selectedProject}
                    onChange={e => setSelectedProject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                    disabled={!selectedBuilder}
                  >
                    <option value="">No project linked</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.planName ? ` (${p.planName})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                <textarea
                  value={quoteNotes}
                  onChange={e => setQuoteNotes(e.target.value)}
                  rows={2}
                  placeholder="Internal notes about this quote..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e] resize-none"
                />
              </div>

              {/* Line Items */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-gray-700">Line Items *</label>
                  <button onClick={addLineItem} className="text-xs font-semibold text-[#C6A24E] hover:text-[#A8882A]">
                    + Add Item
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_120px_80px_100px_32px] gap-2 text-xs font-semibold text-gray-500 uppercase px-1">
                    <span>Description</span>
                    <span>Location</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Unit Price</span>
                    <span></span>
                  </div>
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_120px_80px_100px_32px] gap-2 items-center">
                      <input
                        value={item.description}
                        onChange={e => updateLineItem(idx, 'description', e.target.value)}
                        placeholder="e.g., 2068 Hollow Core Door"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <input
                        value={item.location}
                        onChange={e => updateLineItem(idx, 'location', e.target.value)}
                        placeholder="e.g., Master"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateLineItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                        min={1}
                        className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <input
                        type="number"
                        value={item.unitPrice || ''}
                        onChange={e => updateLineItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        placeholder="0.00"
                        className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:border-[#0f2a3e]"
                      />
                      <button
                        onClick={() => removeLineItem(idx)}
                        disabled={lineItems.length <= 1}
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-20 rounded"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Running Total */}
              <div className="flex justify-end">
                <div className="bg-gray-50 rounded-lg px-5 py-3 text-right">
                  <p className="text-xs text-gray-500 uppercase">Estimated Total</p>
                  <p className="text-xl font-bold text-[#0f2a3e]">{fmt(newItemTotal)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Final total may include payment term adjustments</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateQuote}
                disabled={creating || !selectedBuilder || lineItems.every(i => !i.description.trim())}
                className="px-6 py-2.5 bg-[#C6A24E] text-white rounded-lg text-sm font-semibold hover:bg-[#A8882A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating...' : 'Create Quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
