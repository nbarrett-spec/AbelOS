'use client'

import { useState } from 'react'

interface TakeoffItem {
  id: string
  category: string
  description: string
  location: string | null
  quantity: number
  confidence: number | null
  aiNotes: string | null
  product?: {
    id: string
    sku: string
    name: string
    basePrice: number
  } | null
}

interface TakeoffSummary {
  totalItems: number
  interiorDoors: number
  exteriorDoors: number
  hardware: number
  trimLinearFeet: number
  closetComponents: number
  windowTrimPieces: number
  specialtyItems: number
  rooms: number
}

interface TakeoffViewerProps {
  items: TakeoffItem[]
  confidence: number
  notes: string[]
  summary?: TakeoffSummary
  onGenerateQuote: () => void
  loading?: boolean
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  'Interior Door': { bg: 'bg-blue-100', text: 'text-blue-800', icon: '🚪' },
  'Exterior Door': { bg: 'bg-indigo-100', text: 'text-indigo-800', icon: '🏠' },
  'Hardware': { bg: 'bg-amber-100', text: 'text-amber-800', icon: '🔩' },
  'Trim': { bg: 'bg-green-100', text: 'text-green-800', icon: '📏' },
  'Window Trim': { bg: 'bg-teal-100', text: 'text-teal-800', icon: '🪟' },
  'Closet Component': { bg: 'bg-purple-100', text: 'text-purple-800', icon: '👔' },
  'Specialty': { bg: 'bg-orange-100', text: 'text-orange-800', icon: '🔨' },
  'Miscellaneous': { bg: 'bg-gray-100', text: 'text-gray-800', icon: '📦' },
}

function getCategoryStyle(category: string) {
  return CATEGORY_COLORS[category] || { bg: 'bg-gray-100', text: 'text-gray-700', icon: '📋' }
}

function getUnit(aiNotes: string | null): string {
  if (!aiNotes) return 'ea'
  const unitMatch = aiNotes.match(/Unit:\s*(ea|lf|set|pair|pc)/)
  return unitMatch ? unitMatch[1] : 'ea'
}

export default function TakeoffViewer({
  items,
  confidence,
  notes,
  summary,
  onGenerateQuote,
  loading,
}: TakeoffViewerProps) {
  const [filter, setFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'room' | 'category'>('room')

  const categories = Array.from(new Set(items.map((i) => i.category)))
  const filteredItems = filter === 'all' ? items : items.filter((i) => i.category === filter)

  // Group by location or category
  const grouped = filteredItems.reduce((acc, item) => {
    const key = viewMode === 'room'
      ? (item.location || 'General')
      : item.category
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, TakeoffItem[]>)

  const matchedCount = items.filter(i => i.product).length
  const unmatchedCount = items.length - matchedCount

  const confidenceColor = confidence >= 0.92
    ? 'text-green-600 bg-green-50'
    : confidence >= 0.85
      ? 'text-yellow-600 bg-yellow-50'
      : 'text-red-600 bg-red-50'

  // Calculate estimated total if products are matched
  const estimatedTotal = items.reduce((sum, item) => {
    if (item.product) {
      return sum + (item.product.basePrice * item.quantity)
    }
    return sum
  }, 0)

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            AI Takeoff Results
          </h2>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${confidenceColor}`}>
            {Math.round(confidence * 100)}% Confidence
          </span>
        </div>

        {/* Summary Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          <StatBox
            label="Total Items"
            value={summary?.totalItems || items.length}
            icon="📋"
          />
          <StatBox
            label="Int. Doors"
            value={summary?.interiorDoors || items.filter(i => i.category === 'Interior Door').length}
            icon="🚪"
          />
          <StatBox
            label="Ext. Doors"
            value={summary?.exteriorDoors || items.filter(i => i.category === 'Exterior Door').length}
            icon="🏠"
          />
          <StatBox
            label="Hardware"
            value={summary?.hardware || items.filter(i => i.category === 'Hardware').length}
            icon="🔩"
          />
          <StatBox
            label="Trim (LF)"
            value={summary?.trimLinearFeet || items.filter(i => i.category === 'Trim' || i.category === 'Window Trim').reduce((s, i) => s + i.quantity, 0)}
            icon="📏"
          />
          <StatBox
            label="Closet"
            value={summary?.closetComponents || items.filter(i => i.category === 'Closet Component').length}
            icon="👔"
          />
          <StatBox
            label="Window Trim"
            value={summary?.windowTrimPieces || items.filter(i => i.category === 'Window Trim').length}
            icon="🪟"
          />
          <StatBox
            label="Specialty"
            value={summary?.specialtyItems || items.filter(i => i.category === 'Specialty' || i.category === 'Miscellaneous').length}
            icon="🔨"
          />
        </div>

        {/* Product Match Status */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1 bg-green-50 rounded-lg p-3">
            <p className="text-sm font-medium text-green-800">
              {matchedCount} items matched to Abel products
            </p>
            {estimatedTotal > 0 && (
              <p className="text-xs text-green-600 mt-1">
                Estimated total: ${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            )}
          </div>
          {unmatchedCount > 0 && (
            <div className="flex-1 bg-yellow-50 rounded-lg p-3">
              <p className="text-sm font-medium text-yellow-800">
                {unmatchedCount} items need manual product assignment
              </p>
            </div>
          )}
        </div>

        {/* AI Notes */}
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-sm font-medium text-blue-800 mb-1">AI Notes</p>
          <ul className="text-sm text-blue-700 space-y-0.5">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* View Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Category Filters */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'all' ? 'bg-[#3E2A1E] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({items.length})
          </button>
          {categories.map((cat) => {
            const style = getCategoryStyle(cat)
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  filter === cat ? 'bg-[#3E2A1E] text-white' : `${style.bg} ${style.text} hover:opacity-80`
                }`}
              >
                {style.icon} {cat} ({items.filter((i) => i.category === cat).length})
              </button>
            )
          })}
        </div>

        {/* Group By Toggle */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('room')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              viewMode === 'room' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            By Room
          </button>
          <button
            onClick={() => setViewMode('category')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              viewMode === 'category' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            By Category
          </button>
        </div>
      </div>

      {/* Items grouped by room or category */}
      <div className="space-y-4">
        {Object.entries(grouped).map(([groupName, groupItems]) => (
          <div key={groupName} className="bg-white rounded-xl border overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-medium text-gray-900">{groupName}</h3>
              <span className="text-xs text-gray-500">{groupItems.length} items</span>
            </div>
            <div className="divide-y">
              {groupItems.map((item) => {
                const style = getCategoryStyle(item.category)
                const unit = getUnit(item.aiNotes)
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${style.bg} ${style.text}`}>
                          {style.icon} {item.category}
                        </span>
                        {item.product && (
                          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                            ✓ {item.product.sku}
                          </span>
                        )}
                        {!item.product && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                            Unmatched
                          </span>
                        )}
                        {item.confidence && item.confidence < 0.88 && (
                          <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">
                            Low confidence
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-800 mt-1">{item.description}</p>
                      {item.product && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          → {item.product.name} @ ${item.product.basePrice.toFixed(2)}/{unit}
                        </p>
                      )}
                      {item.aiNotes && !item.aiNotes.startsWith('Unit:') && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {item.aiNotes.split(' | ')[0]}
                        </p>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-lg font-semibold text-gray-900">{item.quantity}</p>
                      <p className="text-xs text-gray-500">{unit}</p>
                      {item.product && (
                        <p className="text-xs text-green-600 font-medium">
                          ${(item.product.basePrice * item.quantity).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Generate Quote Button */}
      <div className="flex justify-between items-center">
        {estimatedTotal > 0 && (
          <div className="text-lg font-semibold text-gray-900">
            Estimated Total: <span className="text-[#27AE60]">${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
        )}
        <button
          onClick={onGenerateQuote}
          disabled={loading}
          className="px-8 py-3 bg-[#C9822B] hover:bg-[#A86B1F] text-white font-semibold rounded-xl shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Generating Quote...' : 'Generate Quote →'}
        </button>
      </div>
    </div>
  )
}

function StatBox({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-xs text-gray-500 mb-1">{icon}</p>
      <p className="text-xl font-bold text-[#3E2A1E]">{value.toLocaleString()}</p>
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
    </div>
  )
}
