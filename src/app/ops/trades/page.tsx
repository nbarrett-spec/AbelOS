'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Star, MapPin, Phone, Mail, Globe, Shield, Users } from 'lucide-react'

interface Trade {
  id: string; companyName: string; tradeType: string; contactName: string;
  email: string; phone: string; website: string; city: string; state: string;
  rating: number; reviewCount: number; verified: boolean; description: string;
  serviceArea: string[]; addedByName: string; createdAt: string;
}

const TRADE_TYPES = [
  'FRAMING', 'PLUMBING', 'ELECTRICAL', 'HVAC', 'ROOFING', 'FLOORING',
  'PAINTING', 'DRYWALL', 'CONCRETE', 'INSULATION', 'SIDING', 'WINDOWS',
  'TRIM_CARPENTRY', 'CABINETRY', 'COUNTERTOPS', 'LANDSCAPING', 'FENCING',
  'GUTTERS', 'GARAGE_DOORS', 'APPLIANCES', 'LOW_VOLTAGE', 'CLEANING',
  'GENERAL_CONTRACTOR', 'OTHER',
]

const StarRating = ({ rating, size = 'sm' }: { rating: number; size?: string }) => {
  const s = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={`${s} ${n <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
      ))}
      <span className="text-xs text-gray-500 ml-1">{rating > 0 ? rating.toFixed(1) : 'No ratings'}</span>
    </div>
  )
}

export default function TradeFinderPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [tradeTypes, setTradeTypes] = useState<{ tradeType: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [total, setTotal] = useState(0)
  const [newTrade, setNewTrade] = useState({
    companyName: '', tradeType: '', contactName: '', email: '', phone: '',
    website: '', city: '', state: 'TX', description: '',
  })

  const fetchTrades = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchTerm) params.set('search', searchTerm)
      if (typeFilter) params.set('tradeType', typeFilter)
      if (verifiedOnly) params.set('verified', 'true')
      const res = await fetch(`/api/ops/trades?${params}`)
      const data = await res.json()
      setTrades(data.trades || [])
      setTotal(data.total || 0)
      setTradeTypes(data.tradeTypes || [])
    } catch (e) { console.error('Failed to fetch trades:', e) }
    finally { setLoading(false) }
  }, [searchTerm, typeFilter, verifiedOnly])

  useEffect(() => { fetchTrades() }, [fetchTrades])

  const createTrade = async () => {
    if (!newTrade.companyName || !newTrade.tradeType) return
    try {
      const res = await fetch('/api/ops/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTrade),
      })
      if (res.ok) { setShowCreate(false); setNewTrade({ companyName: '', tradeType: '', contactName: '', email: '', phone: '', website: '', city: '', state: 'TX', description: '' }); fetchTrades() }
    } catch (e) { console.error('Failed to create:', e) }
  }

  const formatType = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trade Finder</h1>
          <p className="text-sm text-gray-500 mt-1">Find and manage trusted subcontractors and trade partners in DFW</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#1B4F72] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#154360]">
          <Plus className="w-4 h-4" /> Add Trade
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search by company, contact, or trade type..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm">
          <option value="">All Trades</option>
          {tradeTypes.map(tt => (
            <option key={tt.tradeType} value={tt.tradeType}>{formatType(tt.tradeType)} ({tt.count})</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={verifiedOnly} onChange={e => setVerifiedOnly(e.target.checked)}
            className="rounded border-gray-300" />
          <Shield className="w-4 h-4 text-green-600" />
          Verified only
        </label>
        <span className="text-sm text-gray-400 ml-auto">{total} trades</span>
      </div>

      {/* Trade Cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading trades...</div>
      ) : trades.length === 0 ? (
        <div className="text-center py-16">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No trades found. Add your first trade partner to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trades.map(trade => (
            <div key={trade.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    {trade.companyName}
                    {trade.verified && <Shield className="w-4 h-4 text-green-500" />}
                  </h3>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-[#1B4F72]/10 text-[#1B4F72] rounded text-xs font-medium">
                    {formatType(trade.tradeType)}
                  </span>
                </div>
              </div>

              <StarRating rating={trade.rating} />
              <span className="text-xs text-gray-400 ml-1">({trade.reviewCount} reviews)</span>

              {trade.description && (
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{trade.description}</p>
              )}

              <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                {trade.contactName && (
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    {trade.contactName}
                  </div>
                )}
                {(trade.city || trade.state) && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                    {[trade.city, trade.state].filter(Boolean).join(', ')}
                  </div>
                )}
                {trade.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    <a href={`tel:${trade.phone}`} className="text-blue-600 hover:underline">{trade.phone}</a>
                  </div>
                )}
                {trade.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    <a href={`mailto:${trade.email}`} className="text-blue-600 hover:underline truncate">{trade.email}</a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Trade Partner</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                <input type="text" value={newTrade.companyName}
                  onChange={e => setNewTrade(p => ({ ...p, companyName: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Trade Type *</label>
                <select value={newTrade.tradeType}
                  onChange={e => setNewTrade(p => ({ ...p, tradeType: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select trade type...</option>
                  {TRADE_TYPES.map(t => <option key={t} value={t}>{formatType(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input type="text" value={newTrade.contactName}
                  onChange={e => setNewTrade(p => ({ ...p, contactName: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" value={newTrade.phone}
                  onChange={e => setNewTrade(p => ({ ...p, phone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={newTrade.email}
                  onChange={e => setNewTrade(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                <input type="url" value={newTrade.website}
                  onChange={e => setNewTrade(p => ({ ...p, website: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input type="text" value={newTrade.city}
                  onChange={e => setNewTrade(p => ({ ...p, city: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input type="text" value={newTrade.state}
                  onChange={e => setNewTrade(p => ({ ...p, state: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={newTrade.description}
                  onChange={e => setNewTrade(p => ({ ...p, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" rows={2}
                  placeholder="Brief description of services..." />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={createTrade} disabled={!newTrade.companyName || !newTrade.tradeType}
                className="px-4 py-2 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] disabled:opacity-50">
                Add Trade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
