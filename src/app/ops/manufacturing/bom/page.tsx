'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Wrench, AlertTriangle, Copy, Hash, Truck, DollarSign, X } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import ExplodedDoor from '@/components/ExplodedDoor'

type ValidationFilter = 'all' | 'duplicates' | 'zeroQty' | 'noSupplier' | 'noCost'

export default function BOMManagementPage() {
  const [parents, setParents] = useState<any[]>([])
  const [potentialParents, setPotentialParents] = useState<any[]>([])
  const [selectedParent, setSelectedParent] = useState<any>(null)
  const [components, setComponents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('all')

  // Add component form
  const [compSearch, setCompSearch] = useState('')
  const [compResults, setCompResults] = useState<any[]>([])
  const [addQty, setAddQty] = useState(1)
  const [addType, setAddType] = useState('')

  const loadParents = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/manufacturing/bom${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      if (res.ok) {
        const d = await res.json()
        setParents(d.parents || [])
        setPotentialParents(d.potentialParents || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [search])

  useEffect(() => { loadParents() }, [loadParents])

  const loadBOM = async (parentId: string) => {
    try {
      const res = await fetch(`/api/ops/manufacturing/bom?parentId=${parentId}`)
      if (res.ok) {
        const d = await res.json()
        setSelectedParent(d.parent)
        setComponents(d.components || [])
        setValidationFilter('all')
      }
    } catch { /* ignore */ }
  }

  const searchComponents = async (q: string) => {
    if (!q || q.length < 2) { setCompResults([]); return }
    try {
      const res = await fetch(`/api/ops/products?search=${encodeURIComponent(q)}&limit=10`)
      if (res.ok) {
        const d = await res.json()
        setCompResults(d.products || [])
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const t = setTimeout(() => searchComponents(compSearch), 300)
    return () => clearTimeout(t)
  }, [compSearch])

  const addComponent = async (componentId: string, componentName: string) => {
    if (!selectedParent) return
    try {
      const res = await fetch('/api/ops/manufacturing/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: selectedParent.id,
          componentId,
          quantity: addQty,
          componentType: addType || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMsg(`Added ${componentName} to BOM`)
      setCompSearch('')
      setCompResults([])
      setAddQty(1)
      setAddType('')
      loadBOM(selectedParent.id)
      loadParents()
    } catch (e: any) {
      setMsg(`Error: ${e.message}`)
    }
  }

  const removeComponent = async (bomEntryId: string) => {
    try {
      const res = await fetch('/api/ops/manufacturing/bom', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bomEntryId }),
      })
      if (!res.ok) throw new Error('Delete failed')
      setMsg('Component removed')
      if (selectedParent) loadBOM(selectedParent.id)
      loadParents()
    } catch (e: any) {
      setMsg(`Error: ${e.message}`)
    }
  }

  const typeOptions = ['Slab', 'Jamb', 'Casing', 'Hinge', 'Lockset', 'Strike', 'Stop', 'Weatherstrip', 'Other']

  // -------------------------------------------------------------
  // Validation (read-only, client-side)
  // Computes data-quality signals from the already-fetched BOM rows.
  // No mutations. No API calls.
  // -------------------------------------------------------------
  const validation = useMemo(() => {
    const duplicateIds = new Set<string>()
    const zeroQtyIds = new Set<string>()
    const noSupplierIds = new Set<string>()
    const noCostIds = new Set<string>()

    // Bucket rows by SKU to find duplicate component SKUs under the same parent.
    const skuBuckets: Record<string, any[]> = {}
    for (const c of components) {
      const sku = (c?.componentSku ?? '').toString().trim()
      if (!sku) continue
      const key = sku.toUpperCase()
      ;(skuBuckets[key] ||= []).push(c)
    }
    const duplicateSkus = new Set<string>()
    for (const [key, rows] of Object.entries(skuBuckets)) {
      if (rows.length > 1) {
        duplicateSkus.add(key)
        for (const r of rows) duplicateIds.add(r.id)
      }
    }

    for (const c of components) {
      const qty = Number(c?.quantity ?? 0)
      if (!qty || qty <= 0) zeroQtyIds.add(c.id)

      const supplier = c?.supplier ?? c?.componentSupplier ?? c?.preferredSupplier ?? null
      const supplierStr = typeof supplier === 'string' ? supplier.trim() : (supplier?.name ?? '').toString().trim()
      if (!supplierStr) noSupplierIds.add(c.id)

      const cost = c?.componentCost
      if (cost === null || cost === undefined || Number(cost) === 0) noCostIds.add(c.id)
    }

    const totalRollup = components.reduce(
      (sum, c) => sum + (Number(c?.componentCost ?? 0) * Number(c?.quantity ?? 0)),
      0,
    )

    return {
      duplicateIds,
      zeroQtyIds,
      noSupplierIds,
      noCostIds,
      duplicateSkuCount: duplicateSkus.size,
      zeroQtyCount: zeroQtyIds.size,
      noSupplierCount: noSupplierIds.size,
      noCostCount: noCostIds.size,
      totalRollup,
    }
  }, [components])

  const visibleComponents = useMemo(() => {
    switch (validationFilter) {
      case 'duplicates':
        return components.filter((c) => validation.duplicateIds.has(c.id))
      case 'zeroQty':
        return components.filter((c) => validation.zeroQtyIds.has(c.id))
      case 'noSupplier':
        return components.filter((c) => validation.noSupplierIds.has(c.id))
      case 'noCost':
        return components.filter((c) => validation.noCostIds.has(c.id))
      default:
        return components
    }
  }, [components, validation, validationFilter])

  const totalIssues =
    validation.duplicateSkuCount +
    validation.zeroQtyCount +
    validation.noSupplierCount +
    validation.noCostCount

  const toggleFilter = (f: ValidationFilter) => {
    setValidationFilter((cur) => (cur === f ? 'all' : f))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bill of Materials"
        description="Define component breakdowns for assembled products (prehung doors, etc.)"
        actions={
          <Link href="/ops/manufacturing" className="text-sm text-[#0f2a3e] hover:text-signal">← Manufacturing Dashboard</Link>
        }
      />

      {msg && <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parent Products List */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-fg mb-3">Parent Products with BOMs</h2>
          <input
            type="text"
            placeholder="Search products..."
            className="w-full px-3 py-2 border rounded-lg text-sm mb-3 focus:ring-2 focus:ring-[#0f2a3e] focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="space-y-2 max-h-96 overflow-auto">
            {parents.map((p) => (
              <button
                key={p.id}
                onClick={() => loadBOM(p.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedParent?.id === p.id ? 'border-[#0f2a3e] bg-blue-50' : 'border-gray-200 hover:bg-row-hover'
                }`}
              >
                <p className="font-semibold text-sm">{p.name}</p>
                <p className="text-xs text-fg-subtle">{p.sku} — {p.componentCount} components</p>
                <p className="text-xs text-fg-subtle">Cost: ${p.totalComponentCost?.toFixed(2)}</p>
              </button>
            ))}
            {parents.length === 0 && <p className="text-fg-muted text-sm">No BOMs defined yet. Select a product to start.</p>}
          </div>

          {/* Quick-create: pick a product that doesn't have a BOM yet */}
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-fg-muted mb-2 font-medium">Set up BOM for:</p>
            <div className="max-h-32 overflow-auto space-y-1">
              {potentialParents
                .filter(pp => !parents.some(p => p.id === pp.id))
                .slice(0, 20)
                .map(pp => (
                  <button
                    key={pp.id}
                    onClick={() => { setSelectedParent(pp); setComponents([]) }}
                    className="w-full text-left px-2 py-1 text-xs rounded hover:bg-surface-muted"
                  >
                    {pp.name} <span className="text-fg-subtle">({pp.sku})</span>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* BOM Detail / Editor */}
        <div className="lg:col-span-2 space-y-4">
          {selectedParent ? (
            <>
              <div className="bg-white rounded-xl border p-6">
                <h2 className="font-semibold text-fg">{selectedParent.name}</h2>
                <p className="text-sm text-fg-subtle">{selectedParent.sku} — {selectedParent.category}</p>
                {selectedParent.basePrice && (
                  <p className="text-sm text-fg-subtle mt-1">Base Price: ${selectedParent.basePrice?.toFixed(2)} | Cost: ${selectedParent.cost?.toFixed(2)}</p>
                )}
              </div>

              {/* Validation panel — read-only data-quality signals */}
              {components.length > 0 && (
                <div className="bg-white rounded-xl border p-6">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h3 className="font-semibold text-fg flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Validation
                      </h3>
                      <p className="text-xs text-fg-subtle mt-0.5">
                        {totalIssues === 0
                          ? 'No data-quality issues detected on this BOM.'
                          : 'Click a chip to filter the components table to flagged rows.'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-fg-muted uppercase tracking-wide">Cost rollup</p>
                      <p className="text-lg font-semibold text-fg flex items-center justify-end gap-1">
                        <DollarSign className="w-4 h-4 text-fg-subtle" />
                        {validation.totalRollup.toFixed(2)}
                      </p>
                      <p className="text-[11px] text-fg-subtle">unit cost × qty, all components</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleFilter('duplicates')}
                      disabled={validation.duplicateSkuCount === 0}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                        validation.duplicateSkuCount === 0
                          ? 'border-gray-200 text-fg-muted bg-gray-50 cursor-not-allowed'
                          : validationFilter === 'duplicates'
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      <Copy className="w-3 h-3" />
                      {validation.duplicateSkuCount} duplicate {validation.duplicateSkuCount === 1 ? 'SKU' : 'SKUs'}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleFilter('zeroQty')}
                      disabled={validation.zeroQtyCount === 0}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                        validation.zeroQtyCount === 0
                          ? 'border-gray-200 text-fg-muted bg-gray-50 cursor-not-allowed'
                          : validationFilter === 'zeroQty'
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                      }`}
                    >
                      <Hash className="w-3 h-3" />
                      {validation.zeroQtyCount} zero-qty {validation.zeroQtyCount === 1 ? 'line' : 'lines'}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleFilter('noSupplier')}
                      disabled={validation.noSupplierCount === 0}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                        validation.noSupplierCount === 0
                          ? 'border-gray-200 text-fg-muted bg-gray-50 cursor-not-allowed'
                          : validationFilter === 'noSupplier'
                            ? 'border-orange-600 bg-orange-600 text-white'
                            : 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100'
                      }`}
                    >
                      <Truck className="w-3 h-3" />
                      {validation.noSupplierCount} missing {validation.noSupplierCount === 1 ? 'supplier' : 'suppliers'}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleFilter('noCost')}
                      disabled={validation.noCostCount === 0}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                        validation.noCostCount === 0
                          ? 'border-gray-200 text-fg-muted bg-gray-50 cursor-not-allowed'
                          : validationFilter === 'noCost'
                            ? 'border-yellow-600 bg-yellow-600 text-white'
                            : 'border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100'
                      }`}
                    >
                      <DollarSign className="w-3 h-3" />
                      {validation.noCostCount} missing unit {validation.noCostCount === 1 ? 'cost' : 'costs'}
                    </button>

                    {validationFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setValidationFilter('all')}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-gray-300 bg-white text-xs font-medium text-fg-subtle hover:bg-gray-50"
                      >
                        <X className="w-3 h-3" />
                        Clear filter
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Current Components */}
              <div className="bg-white rounded-xl border overflow-hidden">
                <div className="bg-gray-50 px-6 py-3 border-b flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-fg">
                    Components ({components.length})
                    {validationFilter !== 'all' && (
                      <span className="ml-2 text-xs font-normal text-amber-700">
                        showing {visibleComponents.length} flagged
                      </span>
                    )}
                  </h3>
                </div>
                {components.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-fg-muted text-xs uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-left">Component</th>
                        <th className="px-4 py-2 text-left">SKU</th>
                        <th className="px-4 py-2 text-center">Qty</th>
                        <th className="px-4 py-2 text-right">Unit Cost</th>
                        <th className="px-4 py-2 text-center">In Stock</th>
                        <th className="px-4 py-2 text-center">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {visibleComponents.map((c) => {
                        const flags: string[] = []
                        if (validation.duplicateIds.has(c.id)) flags.push('duplicate SKU')
                        if (validation.zeroQtyIds.has(c.id)) flags.push('zero qty')
                        if (validation.noSupplierIds.has(c.id)) flags.push('no supplier')
                        if (validation.noCostIds.has(c.id)) flags.push('no cost')
                        const flagged = flags.length > 0
                        return (
                          <tr key={c.id} className={`hover:bg-row-hover ${flagged ? 'bg-amber-50/40' : ''}`}>
                            <td className="px-4 py-2">
                              <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{c.componentType || '—'}</span>
                            </td>
                            <td className="px-4 py-2 font-medium">
                              {c.componentName}
                              {flagged && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700" title={flags.join(' · ')}>
                                  ⚠ {flags.length}
                                </span>
                              )}
                            </td>
                            <td className={`px-4 py-2 text-fg-subtle ${validation.duplicateIds.has(c.id) ? 'text-amber-700 font-semibold' : ''}`}>{c.componentSku}</td>
                            <td className={`px-4 py-2 text-center ${validation.zeroQtyIds.has(c.id) ? 'text-red-600 font-semibold' : ''}`}>{c.quantity}</td>
                            <td className={`px-4 py-2 text-right ${validation.noCostIds.has(c.id) ? 'text-yellow-700 font-semibold' : ''}`}>${Number(c.componentCost ?? 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={c.componentAvailable > 0 ? 'text-green-600' : 'text-red-600'}>
                                {c.componentAvailable ?? 0}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button onClick={() => removeComponent(c.id)} className="text-red-500 hover:text-red-700 text-xs">
                                Remove
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                      {visibleComponents.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-fg-muted text-sm">
                            No components match the current validation filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={4} className="px-4 py-2 font-semibold text-right">Total Component Cost:</td>
                        <td className="px-4 py-2 text-right font-semibold">
                          ${validation.totalRollup.toFixed(2)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="p-6 text-center text-fg-muted">
                    <p>No components added yet. Search below to add.</p>
                  </div>
                )}
              </div>

              {/* Add Component */}
              <div className="bg-white rounded-xl border p-6">
                <h3 className="font-semibold text-fg mb-3">Add Component</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2 relative">
                    <input
                      type="text"
                      placeholder="Search for component product..."
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e] focus:outline-none"
                      value={compSearch}
                      onChange={(e) => setCompSearch(e.target.value)}
                    />
                    {compResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-auto">
                        {compResults.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => addComponent(p.id, p.name)}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                          >
                            <span className="font-medium">{p.name}</span>
                            <span className="text-fg-subtle ml-2">{p.sku}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    value={addType}
                    onChange={(e) => setAddType(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e] focus:outline-none"
                  >
                    <option value="">Component Type...</option>
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={addQty}
                    onChange={(e) => setAddQty(Number(e.target.value))}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e] focus:outline-none"
                    placeholder="Qty"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-center py-4">
                <ExplodedDoor variant="compact" autoPlay />
              </div>
              <div className="bg-white rounded-xl border p-6">
                <EmptyState
                  size="full"
                  icon={<Wrench className="w-10 h-10 text-fg-subtle" />}
                  title="Select a product to view or edit its BOM"
                  description="Choose from the left panel, or pick a product to set up a new BOM. Click the door above to see how a 3080 2-panel prehung breaks down."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
