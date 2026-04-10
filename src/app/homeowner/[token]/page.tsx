'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'

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
  location: string
  baseProductId: string
  selectedProductId: string
  adderCost: number
  status: string
  baseProduct?: Product
  selectedProduct?: Product
}

interface UpgradeOption {
  id: string
  toProductId: string
  fromProductId: string
  upgradeType: string
  category?: 'BUILDER_OPTION' | 'ABEL_PREMIUM' | string
  description: string
  priceDelta: number
  product: Product
}

interface HomeownerData {
  homeownerAccess: { id: string; name: string; email: string; phone?: string }
  builder: { id: string; companyName: string; phone?: string; email?: string }
  project: { id: string; name: string; jobAddress?: string; city?: string; state?: string }
  selections: Selection[]
  progress: { totalSelections: number; completedSelections: number; totalUpgradeCost: number; status: string }
}

export default function HomeownerPortal() {
  const params = useParams()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<HomeownerData | null>(null)
  const [selections, setSelections] = useState<Selection[]>([])
  const [expandedSelection, setExpandedSelection] = useState<string | null>(null)
  const [upgrades, setUpgrades] = useState<Record<string, UpgradeOption[]>>({})
  const [loadingUpgrades, setLoadingUpgrades] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  useEffect(() => {
    fetchData()
  }, [token])

  async function fetchData() {
    try {
      const res = await fetch(`/api/homeowner/${token}`)
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || 'Failed to load portal')
        return
      }
      const homeownerData: HomeownerData = await res.json()
      setData(homeownerData)
      setSelections(homeownerData.selections)
    } catch {
      setError('An error occurred while loading your portal')
    } finally {
      setLoading(false)
    }
  }

  async function loadUpgrades(selectionId: string, baseProductId: string) {
    if (upgrades[baseProductId]) {
      setExpandedSelection(expandedSelection === selectionId ? null : selectionId)
      return
    }

    setLoadingUpgrades(selectionId)
    setExpandedSelection(selectionId)
    try {
      const res = await fetch(`/api/homeowner/${token}/upgrades?baseProductId=${baseProductId}`)
      if (res.ok) {
        const data = await res.json()
        setUpgrades(prev => ({ ...prev, [baseProductId]: data }))
      }
    } catch {
      console.error('Failed to load upgrades')
    } finally {
      setLoadingUpgrades(null)
    }
  }

  async function selectUpgrade(selectionId: string, newProductId: string, priceDifference: number) {
    try {
      const res = await fetch(`/api/homeowner/${token}/upgrades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectionId, newProductId, priceDifference }),
      })
      if (res.ok) {
        const updated = await res.json()
        setSelections(prev => {
          const newSelections = prev.map(s => s.id === selectionId ? updated : s)
          const newTotal = newSelections.reduce((sum, s) => sum + (s.adderCost || 0), 0)
          if (data) {
            setData(d => d ? { ...d, progress: { ...d.progress, totalUpgradeCost: newTotal } } : d)
          }
          return newSelections
        })
      }
    } catch (err) {
      console.error('Selection update failed:', err)
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      const res = await fetch(`/api/homeowner/${token}/confirm`, { method: 'POST' })
      if (res.ok) {
        setConfirmed(true)
        setShowConfirmDialog(false)
        fetchData()
      }
    } catch {
      console.error('Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 mt-4 text-sm">Loading your portal...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-red-700 mb-2">Unable to Access Portal</h2>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <a href="/homeowner" className="text-sm text-[#1B4F72] font-medium hover:underline">
            Return to Login
          </a>
        </div>
      </div>
    )
  }

  if (!data) return null

  const isLocked = selections.some(s => s.status === 'CONFIRMED' || s.status === 'LOCKED')
  const totalUpgradeCost = selections.reduce((sum, s) => sum + s.adderCost, 0)
  const progressPct = data.progress.totalSelections > 0
    ? Math.round((data.progress.completedSelections / data.progress.totalSelections) * 100)
    : 0

  return (
    <div>
      {/* Project Header Card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider">Your Project</p>
            <h2 className="text-xl font-bold text-gray-900 mt-1">{data.project.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">Builder: {data.builder.companyName}</p>
            {data.project.jobAddress && (
              <p className="text-sm text-gray-400 mt-0.5">
                {data.project.jobAddress}
                {data.project.city && `, ${data.project.city}`}
                {data.project.state && ` ${data.project.state}`}
              </p>
            )}
          </div>
          <div className="sm:text-right">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
              isLocked || confirmed
                ? 'bg-green-100 text-green-700'
                : 'bg-[#E67E22]/10 text-[#E67E22]'
            }`}>
              {isLocked || confirmed ? 'CONFIRMED' : 'SELECTIONS OPEN'}
            </span>
            <p className="text-sm text-gray-500 mt-2">Welcome, {data.homeownerAccess.name}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">
              {data.progress.completedSelections} of {data.progress.totalSelections} selections made
            </span>
            <span className="text-xs font-bold text-[#1B4F72]">{progressPct}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-[#1B4F72] h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Selections */}
      <div className="space-y-3 mb-32 md:mb-36">
        <h3 className="text-base font-semibold text-gray-900">Your Door & Hardware Selections</h3>

        {selections.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-gray-400">No selections assigned to your project yet</p>
            <p className="text-xs text-gray-300 mt-1">Your builder will set up selections for you</p>
          </div>
        ) : (
          selections.map(selection => {
            const isExpanded = expandedSelection === selection.id
            const isUpgraded = selection.selectedProductId !== selection.baseProductId
            const selectionUpgrades = upgrades[selection.baseProductId] || []

            return (
              <div key={selection.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                {/* Selection Header with Product Preview */}
                <div className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    {/* Current Product Image */}
                    <div className="flex-shrink-0">
                      {selection.selectedProduct?.thumbnailUrl || selection.selectedProduct?.imageUrl ? (
                        <Image
                          src={selection.selectedProduct.thumbnailUrl || selection.selectedProduct.imageUrl || ''}
                          alt={selection.selectedProduct.name}
                          width={80}
                          height={80}
                          className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                        />
                      ) : (
                        <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-3xl">🚪</div>
                      )}
                    </div>

                    {/* Selection Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{selection.location}</span>
                        {isUpgraded && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E67E22]/10 text-[#E67E22]">
                            UPGRADED
                          </span>
                        )}
                        {selection.status === 'CONFIRMED' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                            CONFIRMED
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {selection.selectedProduct?.name || 'Standard'}
                      </p>
                      {selection.adderCost > 0 && (
                        <p className="text-xs text-[#E67E22] font-bold mt-1">
                          +${selection.adderCost.toLocaleString('en-US', { minimumFractionDigits: 2 })} upgrade cost
                        </p>
                      )}
                      {!isLocked && !isExpanded && (
                        <button
                          onClick={() => loadUpgrades(selection.id, selection.baseProductId)}
                          className="text-xs font-semibold text-[#E67E22] hover:text-[#d35400] mt-2 inline-flex items-center gap-1"
                        >
                          View Upgrades
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Expand/Collapse Button */}
                    {!isLocked && (
                      <button
                        onClick={() => loadUpgrades(selection.id, selection.baseProductId)}
                        className={`flex-shrink-0 p-2 rounded-lg transition-all ${
                          isExpanded
                            ? 'bg-[#E67E22]/10 text-[#E67E22]'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Upgrade Options */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gradient-to-br from-gray-50 to-white">
                    {loadingUpgrades === selection.id ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="w-5 h-5 border-2 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-gray-400 ml-2">Loading options...</span>
                      </div>
                    ) : selectionUpgrades.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-sm text-gray-400">No upgrade options available</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Base/Standard option */}
                        <div className="relative">
                          <button
                            onClick={() => selectUpgrade(selection.id, selection.baseProductId, 0)}
                            className={`w-full text-left px-4 py-4 rounded-lg border transition-all duration-200 ${
                              selection.selectedProductId === selection.baseProductId
                                ? 'border-[#1B4F72] bg-white ring-2 ring-[#1B4F72]/20 shadow-sm'
                                : 'border-gray-200 hover:border-gray-300 bg-white/50'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {selection.baseProduct?.thumbnailUrl || selection.baseProduct?.imageUrl ? (
                                <Image
                                  src={selection.baseProduct.thumbnailUrl || selection.baseProduct.imageUrl || ''}
                                  alt={selection.baseProduct.name || 'Standard'}
                                  width={80}
                                  height={80}
                                  className="w-20 h-20 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                                />
                              ) : (
                                <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-3xl flex-shrink-0">🚪</div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-sm font-semibold text-gray-900">
                                    {selection.baseProduct?.name || 'Standard'}
                                  </p>
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700 uppercase">Included</span>
                                </div>
                                <p className="text-xs text-gray-500">Your current selection • No additional cost</p>
                              </div>
                              {selection.selectedProductId === selection.baseProductId && (
                                <div className="flex-shrink-0 pt-1">
                                  <svg className="w-5 h-5 text-[#1B4F72]" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          </button>
                        </div>

                        {/* Separate builder and Abel upgrades */}
                        {(() => {
                          const builderUpgrades = selectionUpgrades.filter(u => u.category === 'BUILDER_OPTION')
                          const abelUpgrades = selectionUpgrades.filter(u => u.category === 'ABEL_PREMIUM')

                          return (
                            <>
                              {/* Builder upgrades */}
                              {builderUpgrades.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 px-1">Builder Options</p>
                                  <div className="space-y-2">
                                    {builderUpgrades.map((upgrade, index) => {
                                      const isSelected = selection.selectedProductId === upgrade.toProductId

                                      return (
                                        <div key={upgrade.id} className="relative group">
                                          <button
                                            onClick={() => selectUpgrade(selection.id, upgrade.toProductId, upgrade.priceDelta)}
                                            className={`w-full text-left px-4 py-3 rounded-lg border transition-all duration-200 ${
                                              isSelected
                                                ? 'border-blue-400 bg-white ring-2 ring-blue-100 shadow-md'
                                                : 'border-gray-200 hover:border-blue-300 bg-white hover:shadow-sm'
                                            }`}
                                          >
                                            <div className="flex items-start gap-3">
                                              {upgrade.product.thumbnailUrl || upgrade.product.imageUrl ? (
                                                <Image
                                                  src={upgrade.product.thumbnailUrl || upgrade.product.imageUrl || ''}
                                                  alt={upgrade.product.name}
                                                  width={70}
                                                  height={70}
                                                  className="w-[70px] h-[70px] object-cover rounded-lg border border-gray-200 flex-shrink-0 group-hover:border-blue-300 transition-colors"
                                                />
                                              ) : (
                                                <div className="w-[70px] h-[70px] bg-blue-50 rounded-lg flex items-center justify-center text-blue-400 text-2xl flex-shrink-0">🛠</div>
                                              )}
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                  <p className="text-sm font-semibold text-gray-900">{upgrade.product.name}</p>
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-[8px] font-bold bg-blue-100 text-blue-700 uppercase">Builder Option</span>
                                                </div>
                                                <p className="text-xs text-gray-500 line-clamp-1">{upgrade.description}</p>
                                              </div>
                                              <div className="flex-shrink-0 text-right">
                                                <p className="text-sm font-bold text-[#E67E22] whitespace-nowrap">
                                                  +${upgrade.priceDelta.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </p>
                                                {isSelected && (
                                                  <svg className="w-5 h-5 text-[#E67E22] ml-auto mt-1" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                  </svg>
                                                )}
                                              </div>
                                            </div>
                                          </button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Abel premium upgrades */}
                              {abelUpgrades.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 px-1">Abel Premium Upgrades</p>
                                  <div className="space-y-2">
                                    {abelUpgrades.map((upgrade, index) => {
                                      const isSelected = selection.selectedProductId === upgrade.toProductId
                                      const isPopular = index === 0 && abelUpgrades.length > 1

                                      return (
                                        <div key={upgrade.id} className="relative group">
                                          {isPopular && (
                                            <div className="absolute -top-2.5 left-4 z-10">
                                              <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#E67E22] text-white uppercase">Popular</span>
                                            </div>
                                          )}
                                          <button
                                            onClick={() => selectUpgrade(selection.id, upgrade.toProductId, upgrade.priceDelta)}
                                            className={`w-full text-left px-4 py-3 rounded-lg border transition-all duration-200 ${
                                              isSelected
                                                ? 'border-[#E67E22] bg-white ring-2 ring-[#E67E22]/20 shadow-md'
                                                : 'border-gray-200 hover:border-[#E67E22]/50 bg-white hover:shadow-sm'
                                            }`}
                                          >
                                            <div className="flex items-start gap-3">
                                              {upgrade.product.thumbnailUrl || upgrade.product.imageUrl ? (
                                                <Image
                                                  src={upgrade.product.thumbnailUrl || upgrade.product.imageUrl || ''}
                                                  alt={upgrade.product.name}
                                                  width={70}
                                                  height={70}
                                                  className="w-[70px] h-[70px] object-cover rounded-lg border border-gray-200 flex-shrink-0 group-hover:border-[#E67E22]/30 transition-colors"
                                                />
                                              ) : (
                                                <div className="w-[70px] h-[70px] bg-[#E67E22]/10 rounded-lg flex items-center justify-center text-[#E67E22] text-2xl flex-shrink-0">✨</div>
                                              )}
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                  <p className="text-sm font-semibold text-gray-900">{upgrade.product.name}</p>
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-[8px] font-bold bg-orange-100 text-orange-700 uppercase">Abel Premium</span>
                                                </div>
                                                <p className="text-xs text-gray-500 line-clamp-1">{upgrade.description}</p>
                                              </div>
                                              <div className="flex-shrink-0 text-right">
                                                <p className="text-sm font-bold text-[#E67E22] whitespace-nowrap">
                                                  +${upgrade.priceDelta.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </p>
                                                {isSelected && (
                                                  <svg className="w-5 h-5 text-[#E67E22] ml-auto mt-1" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                  </svg>
                                                )}
                                              </div>
                                            </div>
                                          </button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Summary & Confirm - Sticky Bottom */}
      {selections.length > 0 && (
        <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-white/95 border-t border-gray-200 p-4 sm:p-6 shadow-2xl">
          <div className="max-w-4xl mx-auto">
            {/* Upgrade Summary */}
            {totalUpgradeCost > 0 && (
              <div className="mb-4 p-4 bg-gradient-to-r from-[#E67E22]/10 to-[#E67E22]/5 rounded-lg border border-[#E67E22]/20">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Upgrade Summary</p>
                    <p className="text-lg font-bold text-[#E67E22]">
                      +${totalUpgradeCost.toLocaleString('en-US', { minimumFractionDigits: 2 })} total
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {selections.filter(s => s.selectedProductId !== s.baseProductId).length} location{selections.filter(s => s.selectedProductId !== s.baseProductId).length !== 1 ? 's' : ''} upgraded
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p className="font-medium">{selections.length} total selections</p>
                    <p className="mt-1">{progressPct}% complete</p>
                  </div>
                </div>
              </div>
            )}

            {/* Confirm Section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                {totalUpgradeCost === 0 ? (
                  <p className="text-sm text-gray-500">No upgrades selected — using standard options</p>
                ) : (
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold">{selections.filter(s => s.selectedProductId !== s.baseProductId).length}</span> upgrade{selections.filter(s => s.selectedProductId !== s.baseProductId).length !== 1 ? 's' : ''} ready to confirm
                  </p>
                )}
              </div>

              {isLocked || confirmed ? (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex-1 sm:flex-initial">
                  <p className="text-green-700 font-semibold text-sm">✓ Selections Confirmed</p>
                  <p className="text-xs text-green-600">Your builder has been notified</p>
                </div>
              ) : (
                <button
                  onClick={() => setShowConfirmDialog(true)}
                  className="px-6 py-3 bg-[#E67E22] text-white rounded-lg font-semibold text-sm hover:bg-[#d35400] transition-all duration-200 shadow-lg hover:shadow-xl active:scale-95 flex-1 sm:flex-initial"
                >
                  Confirm My Selections
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog (#25) */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-[#E67E22]/10 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-[#E67E22]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">Confirm Your Selections?</h3>
            </div>

            <p className="text-sm text-gray-600 mb-5">
              Once confirmed, your selections will be locked and sent to your builder. This action cannot be undone.
            </p>

            {/* Selection Summary */}
            <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 mb-5 space-y-3">
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-gray-600">Total selections:</span>
                <span className="text-lg font-bold text-[#1B4F72]">{selections.length}</span>
              </div>
              <div className="w-full h-px bg-gray-200"></div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-gray-600">Locations upgraded:</span>
                <span className="text-lg font-bold text-[#E67E22]">
                  {selections.filter(s => s.selectedProductId !== s.baseProductId).length}
                </span>
              </div>
              {totalUpgradeCost > 0 && (
                <>
                  <div className="w-full h-px bg-gray-200"></div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm font-medium text-gray-700">Additional upgrade cost:</span>
                    <span className="text-lg font-bold text-[#E67E22]">
                      +${totalUpgradeCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Upgraded Items List */}
            {selections.some(s => s.selectedProductId !== s.baseProductId) && (
              <div className="mb-5 p-3 bg-[#E67E22]/5 rounded-lg border border-[#E67E22]/20">
                <p className="text-xs font-semibold text-gray-700 mb-2 uppercase">Upgraded selections:</p>
                <div className="space-y-1.5">
                  {selections
                    .filter(s => s.selectedProductId !== s.baseProductId)
                    .map(s => (
                      <div key={s.id} className="text-xs text-gray-600">
                        <span className="font-medium">{s.location}:</span>
                        <span className="text-[#E67E22] font-semibold ml-1">
                          +${s.adderCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Review Again
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="flex-1 px-4 py-2.5 bg-[#E67E22] text-white rounded-lg text-sm font-semibold hover:bg-[#d35400] transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {confirming ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Confirming...
                  </>
                ) : (
                  'Yes, Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
