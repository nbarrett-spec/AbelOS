'use client'

import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  description?: string
  basePrice: number
  sku: string
  imageUrl?: string
  thumbnailUrl?: string
}

interface Selection {
  id: string
  homeownerId: string
  homeownerName: string
  homeownerEmail: string
  homeownerPhone?: string
  homeownerLastVisit?: string
  location: string
  baseProductId: string
  selectedProductId: string
  adderCost: number
  status: string
  confirmedAt?: string
  baseProduct?: Product
  selectedProduct?: Product
  createdAt: string
  updatedAt: string
}

interface HomeownerAccess {
  id: string
  name: string
  email: string
  phone?: string
  accessToken: string
  active: boolean
  createdAt: string
  expiresAt?: string
  lastVisitAt?: string
  _count: { selections: number }
}

interface SelectionsData {
  projectId: string
  totalHomeowners: number
  totalSelections: number
  selections: Selection[]
}

interface HomeownerAccessesData {
  homeownerAccesses: HomeownerAccess[]
}

export default function ProjectSelectionsPage() {
  const params = useParams()
  const projectId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectionsData, setSelectionsData] = useState<SelectionsData | null>(null)
  const [homeownerAccesses, setHomeownerAccesses] = useState<HomeownerAccess[]>([])
  const [showNewHomeowner, setShowNewHomeowner] = useState(false)
  const [creatingToken, setCreatingToken] = useState(false)
  const [newHomeownerForm, setNewHomeownerForm] = useState({
    name: '',
    email: '',
    phone: '',
  })
  const [newAccessUrl, setNewAccessUrl] = useState('')
  const [copiedToClipboard, setCopiedToClipboard] = useState(false)

  useEffect(() => {
    fetchData()
  }, [projectId])

  async function fetchData() {
    try {
      setLoading(true)
      const [selectRes, accessRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/selections`),
        fetch(`/api/projects/${projectId}/homeowner-access`),
      ])

      if (selectRes.ok) {
        const data = await selectRes.json()
        setSelectionsData(data)
      }

      if (accessRes.ok) {
        const data: HomeownerAccessesData = await accessRes.json()
        setHomeownerAccesses(data.homeownerAccesses)
      }
    } catch (err) {
      setError('Failed to load homeowner selections')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateToken() {
    if (!newHomeownerForm.name || !newHomeownerForm.email) {
      alert('Name and email are required')
      return
    }

    setCreatingToken(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/homeowner-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHomeownerForm),
      })

      if (res.ok) {
        const data = await res.json()
        setNewAccessUrl(data.accessUrl)
        setNewHomeownerForm({ name: '', email: '', phone: '' })
        await fetchData()
      } else {
        alert('Failed to create access token')
      }
    } catch (err) {
      console.error('Error creating token:', err)
      alert('Error creating access token')
    } finally {
      setCreatingToken(false)
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(newAccessUrl)
    setCopiedToClipboard(true)
    setTimeout(() => setCopiedToClipboard(false), 2000)
  }

  const isUpgraded = (selection: Selection): boolean => {
    return selection.selectedProductId !== selection.baseProductId
  }

  const upgradePrice = (selection: Selection): number => {
    return selection.adderCost || 0
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md">
        <h2 className="text-lg font-bold text-red-700 mb-2">Error</h2>
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <button
          onClick={() => fetchData()}
          className="text-sm text-red-700 font-medium hover:underline"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Homeowner Selections</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage door and hardware selections from your homeowners
          </p>
        </div>
        <button
          onClick={() => setShowNewHomeowner(!showNewHomeowner)}
          className="px-4 py-2 bg-[#3E2A1E] text-white rounded-lg font-medium text-sm hover:bg-[#15395a] transition-colors"
        >
          {showNewHomeowner ? 'Cancel' : 'Generate Access Link'}
        </button>
      </div>

      {/* New Homeowner Access Form */}
      {showNewHomeowner && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Create Homeowner Access</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Homeowner Name
              </label>
              <input
                type="text"
                value={newHomeownerForm.name}
                onChange={(e) =>
                  setNewHomeownerForm({ ...newHomeownerForm, name: e.target.value })
                }
                placeholder="e.g., John Smith"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#3E2A1E]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={newHomeownerForm.email}
                onChange={(e) =>
                  setNewHomeownerForm({ ...newHomeownerForm, email: e.target.value })
                }
                placeholder="john@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#3E2A1E]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone (Optional)
              </label>
              <input
                type="tel"
                value={newHomeownerForm.phone}
                onChange={(e) =>
                  setNewHomeownerForm({ ...newHomeownerForm, phone: e.target.value })
                }
                placeholder="(555) 123-4567"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#3E2A1E]"
              />
            </div>

            {newAccessUrl && (
              <div className="bg-[#3E2A1E]/5 border border-[#3E2A1E]/20 rounded-lg p-4">
                <p className="text-xs font-medium text-gray-600 mb-2">Access Link Created</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={newAccessUrl}
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-xs font-mono"
                  />
                  <button
                    onClick={copyToClipboard}
                    className="px-3 py-2 bg-[#C9822B] text-white rounded text-xs font-medium hover:bg-[#A86B1F] transition-colors"
                  >
                    {copiedToClipboard ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleCreateToken}
              disabled={creatingToken}
              className="w-full px-4 py-2 bg-[#C9822B] text-white rounded-lg font-medium text-sm hover:bg-[#A86B1F] transition-colors disabled:opacity-50"
            >
              {creatingToken ? 'Creating...' : 'Create Access Link'}
            </button>
          </div>
        </div>
      )}

      {/* Homeowner Access List */}
      {homeownerAccesses.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-bold text-gray-900">Homeowner Access Links</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {homeownerAccesses.map((homeowner) => (
              <div key={homeowner.id} className="px-6 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{homeowner.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{homeowner.email}</p>
                    {homeowner.phone && (
                      <p className="text-xs text-gray-500">{homeowner.phone}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {homeowner._count.selections} selection{homeowner._count.selections !== 1 ? 's' : ''}
                      {homeowner.lastVisitAt && (
                        <>
                          {' • Last visited: '}
                          {new Date(homeowner.lastVisitAt).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      homeowner.active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {homeowner.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selections Table */}
      {selectionsData && selectionsData.selections.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-bold text-gray-900">
              All Selections ({selectionsData.totalSelections})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-white">
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Homeowner</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Location</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Base Product</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Selected Product</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Upgrade Cost</th>
                  <th className="px-6 py-3 text-center font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {selectionsData.selections.map((selection) => (
                  <tr key={selection.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{selection.homeownerName}</p>
                        <p className="text-xs text-gray-500">{selection.homeownerEmail}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-gray-900 font-medium">{selection.location}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <p className="text-gray-900 text-sm">
                          {selection.baseProduct?.name || 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-500">{selection.baseProduct?.sku}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <p className="text-gray-900 text-sm font-medium">
                          {selection.selectedProduct?.name || 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-500">{selection.selectedProduct?.sku}</p>
                        {isUpgraded(selection) && (
                          <span className="inline-block px-2 py-0.5 mt-1 rounded-full text-[10px] font-semibold bg-[#C9822B]/10 text-[#C9822B]">
                            Upgraded
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {upgradePrice(selection) > 0 ? (
                        <span className="font-bold text-[#C9822B]">
                          +${upgradePrice(selection).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      ) : (
                        <span className="text-gray-400">Included</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                        selection.status === 'CONFIRMED' || selection.status === 'LOCKED'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {selection.status === 'CONFIRMED' ? 'Confirmed' : selection.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-400 mb-2">No homeowner selections yet</p>
          <p className="text-xs text-gray-300">
            Generate access links above to let homeowners make selections
          </p>
        </div>
      )}

      {/* Summary Stats */}
      {selectionsData && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-xs text-gray-500 font-medium mb-1">Total Homeowners</p>
            <p className="text-2xl font-bold text-[#3E2A1E]">
              {selectionsData.totalHomeowners}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-xs text-gray-500 font-medium mb-1">Total Selections</p>
            <p className="text-2xl font-bold text-[#3E2A1E]">
              {selectionsData.totalSelections}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-xs text-gray-500 font-medium mb-1">Total Upgrade Cost</p>
            <p className="text-2xl font-bold text-[#C9822B]">
              +$
              {selectionsData.selections
                .reduce((sum, sel) => sum + sel.adderCost, 0)
                .toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
