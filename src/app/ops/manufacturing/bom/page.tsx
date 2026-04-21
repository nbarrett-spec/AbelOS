'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

export default function BOMManagementPage() {
  const [parents, setParents] = useState<any[]>([])
  const [potentialParents, setPotentialParents] = useState<any[]>([])
  const [selectedParent, setSelectedParent] = useState<any>(null)
  const [components, setComponents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bill of Materials</h1>
          <p className="text-gray-600 text-sm mt-1">Define component breakdowns for assembled products (prehung doors, etc.)</p>
        </div>
        <Link href="/ops/manufacturing" className="text-sm text-[#0f2a3e] hover:text-[#C6A24E]">← Manufacturing Dashboard</Link>
      </div>

      {msg && <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parent Products List */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-900 mb-3">Parent Products with BOMs</h2>
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
                  selectedParent?.id === p.id ? 'border-[#0f2a3e] bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <p className="font-semibold text-sm">{p.name}</p>
                <p className="text-xs text-gray-500">{p.sku} — {p.componentCount} components</p>
                <p className="text-xs text-gray-400">Cost: ${p.totalComponentCost?.toFixed(2)}</p>
              </button>
            ))}
            {parents.length === 0 && <p className="text-gray-500 text-sm">No BOMs defined yet. Select a product to start.</p>}
          </div>

          {/* Quick-create: pick a product that doesn't have a BOM yet */}
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-gray-600 mb-2 font-medium">Set up BOM for:</p>
            <div className="max-h-32 overflow-auto space-y-1">
              {potentialParents
                .filter(pp => !parents.some(p => p.id === pp.id))
                .slice(0, 20)
                .map(pp => (
                  <button
                    key={pp.id}
                    onClick={() => { setSelectedParent(pp); setComponents([]) }}
                    className="w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100"
                  >
                    {pp.name} <span className="text-gray-400">({pp.sku})</span>
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
                <h2 className="font-bold text-gray-900">{selectedParent.name}</h2>
                <p className="text-sm text-gray-500">{selectedParent.sku} — {selectedParent.category}</p>
                {selectedParent.basePrice && (
                  <p className="text-sm text-gray-500 mt-1">Base Price: ${selectedParent.basePrice?.toFixed(2)} | Cost: ${selectedParent.cost?.toFixed(2)}</p>
                )}
              </div>

              {/* Current Components */}
              <div className="bg-white rounded-xl border overflow-hidden">
                <div className="bg-gray-50 px-6 py-3 border-b">
                  <h3 className="font-bold text-gray-900">Components ({components.length})</h3>
                </div>
                {components.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
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
                      {components.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{c.componentType || '—'}</span>
                          </td>
                          <td className="px-4 py-2 font-medium">{c.componentName}</td>
                          <td className="px-4 py-2 text-gray-500">{c.componentSku}</td>
                          <td className="px-4 py-2 text-center">{c.quantity}</td>
                          <td className="px-4 py-2 text-right">${c.componentCost?.toFixed(2)}</td>
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
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={4} className="px-4 py-2 font-bold text-right">Total Component Cost:</td>
                        <td className="px-4 py-2 text-right font-bold">
                          ${components.reduce((sum, c) => sum + (c.componentCost * c.quantity), 0).toFixed(2)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="p-6 text-center text-gray-500">
                    <p>No components added yet. Search below to add.</p>
                  </div>
                )}
              </div>

              {/* Add Component */}
              <div className="bg-white rounded-xl border p-6">
                <h3 className="font-bold text-gray-900 mb-3">Add Component</h3>
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
                            <span className="text-gray-400 ml-2">{p.sku}</span>
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
            <div className="bg-white rounded-xl border p-12 text-center text-gray-500">
              <p className="text-4xl mb-4">🔩</p>
              <p className="text-lg font-medium">Select a product to view or edit its BOM</p>
              <p className="text-sm mt-2">Choose from the left panel, or pick a product to set up a new BOM</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
