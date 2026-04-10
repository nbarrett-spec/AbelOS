'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface WarrantyPolicy {
  id: string
  name: string
  type: string
  category: string | null
  description: string | null
  durationMonths: number
  coverageDetails: string | null
  exclusions: string | null
  claimProcess: string | null
  isActive: boolean
  createdAt: string
}

const TYPE_ICONS: Record<string, string> = {
  PRODUCT: '📦',
  MATERIAL: '🪵',
  INSTALLATION: '🔧',
}

const TYPE_COLORS: Record<string, string> = {
  PRODUCT: 'bg-blue-50 border-blue-200',
  MATERIAL: 'bg-amber-50 border-amber-200',
  INSTALLATION: 'bg-green-50 border-green-200',
}

export default function WarrantyPoliciesPage() {
  const [policies, setPolicies] = useState<WarrantyPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    fetchPolicies()
  }, [])

  const fetchPolicies = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/ops/warranty/policies?active=all')
      if (res.ok) {
        const data = await res.json()
        setPolicies(data.policies || [])
      }
    } catch (error) {
      console.error('Failed to fetch policies:', error)
    } finally {
      setLoading(false)
    }
  }

  const seedDefaults = async () => {
    try {
      const res = await fetch('/api/ops/warranty/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' })
      })
      if (res.ok) {
        const data = await res.json()
        showToast(`${data.created?.length || 0} default policies created`)
        fetchPolicies()
      }
    } catch (error) {
      console.error('Seed failed:', error)
    }
  }

  const toggleActive = async (policyId: string, isActive: boolean) => {
    try {
      await fetch('/api/ops/warranty/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyId, isActive: !isActive })
      })
      fetchPolicies()
    } catch (error) {
      console.error('Toggle failed:', error)
    }
  }

  const handleCreatePolicy = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload: Record<string, any> = {}
    form.forEach((val, key) => { if (val) payload[key] = val })
    if (payload.durationMonths) payload.durationMonths = parseInt(payload.durationMonths)

    try {
      const res = await fetch('/api/ops/warranty/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setShowNewForm(false)
        fetchPolicies()
      }
    } catch (error) {
      console.error('Create failed:', error)
    }
  }

  const grouped = {
    PRODUCT: policies.filter(p => p.type === 'PRODUCT'),
    MATERIAL: policies.filter(p => p.type === 'MATERIAL'),
    INSTALLATION: policies.filter(p => p.type === 'INSTALLATION'),
  }

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#1B4F72]'
        }`}>
          {toast}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/ops/warranty" className="text-gray-400 hover:text-gray-600">&larr;</Link>
            <h1 className="text-2xl font-bold text-gray-900">Warranty Policies</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1 ml-8">Define warranty terms, coverage, and claim processes</p>
        </div>
        <div className="flex gap-3">
          {policies.length === 0 && (
            <button
              onClick={seedDefaults}
              className="px-4 py-2 border border-[#e67e22] text-[#e67e22] rounded-lg text-sm font-medium hover:bg-orange-50"
            >
              Load Default Policies
            </button>
          )}
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="px-4 py-2 bg-[#e67e22] text-white rounded-lg text-sm font-medium hover:bg-[#d46711]"
          >
            + New Policy
          </button>
        </div>
      </div>

      {/* New Policy Form */}
      {showNewForm && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Create New Warranty Policy</h3>
          <form onSubmit={handleCreatePolicy} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Policy Name *</label>
                <input name="name" required className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                <select name="type" required className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="PRODUCT">Product Defect</option>
                  <option value="MATERIAL">Material</option>
                  <option value="INSTALLATION">Installation/Labor</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (months) *</label>
                <input name="durationMonths" type="number" defaultValue="12" required className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input name="category" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., Doors - Interior" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea name="description" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Coverage Details</label>
              <textarea name="coverageDetails" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Exclusions</label>
              <textarea name="exclusions" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Claim Process</label>
              <textarea name="claimProcess" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowNewForm(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-[#1B2A4A] text-white rounded-lg text-sm font-medium">Create Policy</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading policies...</div>
      ) : policies.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <p className="text-gray-400 text-lg mb-2">No warranty policies configured</p>
          <p className="text-gray-300 text-sm mb-4">Click &quot;Load Default Policies&quot; to set up Abel Lumber&apos;s standard warranty policies</p>
          <button
            onClick={seedDefaults}
            className="px-6 py-3 bg-[#e67e22] text-white rounded-lg font-medium hover:bg-[#d46711]"
          >
            Load Default Policies
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([type, typePolicies]) => {
            if (typePolicies.length === 0) return null
            return (
              <div key={type}>
                <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <span>{TYPE_ICONS[type]}</span>
                  {type === 'PRODUCT' ? 'Product Defect Warranties' : type === 'MATERIAL' ? 'Material Warranties' : 'Installation Warranties'}
                  <span className="text-sm font-normal text-gray-400">({typePolicies.length})</span>
                </h2>
                <div className="grid gap-4">
                  {typePolicies.map((policy) => (
                    <div
                      key={policy.id}
                      className={`bg-white rounded-xl border ${policy.isActive ? '' : 'opacity-60'} ${TYPE_COLORS[type] || ''}`}
                    >
                      <div
                        className="px-6 py-4 flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedPolicy(expandedPolicy === policy.id ? null : policy.id)}
                      >
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold text-gray-900">{policy.name}</h3>
                            <span className="text-xs bg-white/80 px-2 py-0.5 rounded-full border font-medium text-gray-600">
                              {policy.durationMonths} months
                            </span>
                            {!policy.isActive && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Inactive</span>
                            )}
                          </div>
                          {policy.category && (
                            <p className="text-sm text-gray-500 mt-0.5">{policy.category}</p>
                          )}
                          {policy.description && (
                            <p className="text-sm text-gray-600 mt-1">{policy.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleActive(policy.id, policy.isActive) }}
                            className={`text-xs px-3 py-1 rounded-lg border ${policy.isActive ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}
                          >
                            {policy.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <span className="text-gray-300">{expandedPolicy === policy.id ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {expandedPolicy === policy.id && (
                        <div className="px-6 pb-4 pt-0 border-t space-y-3">
                          {policy.coverageDetails && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase">Coverage Details</p>
                              <p className="text-sm text-gray-700 mt-1">{policy.coverageDetails}</p>
                            </div>
                          )}
                          {policy.exclusions && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase">Exclusions</p>
                              <p className="text-sm text-gray-700 mt-1">{policy.exclusions}</p>
                            </div>
                          )}
                          {policy.claimProcess && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase">Claim Process</p>
                              <p className="text-sm text-gray-700 mt-1">{policy.claimProcess}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
