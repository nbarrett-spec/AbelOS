'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/formatting'

interface Deal {
  id: string
  companyName: string
  contactName: string
  dealValue: number
  stage: string
  expectedCloseDate: string
  ownerId: string
  owner: {
    id: string
    firstName?: string
    lastName?: string
    name?: string
    email?: string
  }
  createdAt?: string
  updatedAt?: string
}

const STAGE_NAMES: Record<string, string> = {
  PROSPECT: 'Prospect',
  DISCOVERY: 'Discovery',
  WALKTHROUGH: 'Walkthrough',
  BID_SUBMITTED: 'Bid Submitted',
  BID_REVIEW: 'Bid Review',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
}

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: 'bg-gray-100 text-gray-800',
  DISCOVERY: 'bg-blue-100 text-blue-800',
  WALKTHROUGH: 'bg-indigo-100 text-indigo-800',
  BID_SUBMITTED: 'bg-yellow-100 text-yellow-800',
  BID_REVIEW: 'bg-orange-100 text-orange-800',
  NEGOTIATION: 'bg-purple-100 text-purple-800',
  WON: 'bg-green-100 text-green-800',
  LOST: 'bg-red-100 text-red-800',
}

type SortField = 'company' | 'stage' | 'value' | 'closeDate' | 'activity'
type SortOrder = 'asc' | 'desc'

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStage, setSelectedStage] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('closeDate')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showMyDealsOnly, setShowMyDealsOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const loadData = async () => {
      try {
        // Fetch current user
        const userRes = await fetch('/api/ops/auth/me')
        if (userRes.ok) {
          const userData = await userRes.json()
          setCurrentUserId(userData.staff.id)
        }

        // Fetch deals
        const res = await fetch('/api/ops/sales/deals')
        if (res.ok) {
          const json = await res.json()
          setDeals(json.deals || json || [])
        }
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  // Filter deals
  let filteredDeals = deals

  // Filter by owner if "My Deals" is toggled
  if (showMyDealsOnly && currentUserId) {
    filteredDeals = filteredDeals.filter((d) => d.ownerId === currentUserId)
  }

  // Filter by stage
  if (selectedStage) {
    filteredDeals = filteredDeals.filter((d) => d.stage === selectedStage)
  }

  // Filter by company name search
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase()
    filteredDeals = filteredDeals.filter((d) =>
      d.companyName.toLowerCase().includes(query)
    )
  }

  // Sort deals
  filteredDeals = [...filteredDeals].sort((a, b) => {
    let aVal: any
    let bVal: any

    switch (sortField) {
      case 'company':
        aVal = a.companyName.toLowerCase()
        bVal = b.companyName.toLowerCase()
        break
      case 'stage':
        aVal = a.stage
        bVal = b.stage
        break
      case 'value':
        aVal = a.dealValue
        bVal = b.dealValue
        break
      case 'closeDate':
        aVal = new Date(a.expectedCloseDate).getTime()
        bVal = new Date(b.expectedCloseDate).getTime()
        break
      case 'activity':
        aVal = new Date(a.updatedAt || a.createdAt || 0).getTime()
        bVal = new Date(b.updatedAt || b.createdAt || 0).getTime()
        break
    }

    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  const stages = Array.from(new Set(deals.map((d) => d.stage)))

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const handleMarkWon = async (dealId: string) => {
    try {
      const res = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'WON',
          actualCloseDate: new Date().toISOString(),
        }),
      })
      if (res.ok) {
        // Refresh deals
        const dealsRes = await fetch('/api/ops/sales/deals')
        if (dealsRes.ok) {
          const json = await dealsRes.json()
          setDeals(json.deals || json || [])
        }
      }
    } catch (error) {
      console.error('Failed to mark deal as won:', error)
    }
  }

  const handleMarkLost = async (dealId: string) => {
    try {
      const res = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'LOST',
          lostReason: 'Marked lost by user',
        }),
      })
      if (res.ok) {
        // Refresh deals
        const dealsRes = await fetch('/api/ops/sales/deals')
        if (dealsRes.ok) {
          const json = await dealsRes.json()
          setDeals(json.deals || json || [])
        }
      }
    } catch (error) {
      console.error('Failed to mark deal as lost:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C9822B]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Deals</h1>
            <p className="text-gray-500 mt-1">
              {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => window.open('/api/ops/export?type=deals', '_blank')}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition"
            >
              Export CSV
            </button>
            <Link
              href="/sales/deals/new"
              className="px-4 py-2 bg-[#C9822B] text-white rounded-lg font-semibold hover:bg-[#A86B1F] transition"
            >
              + New Deal
            </Link>
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex gap-4 items-center flex-wrap">
          <input
            type="text"
            placeholder="Search by company name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-64 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
          />
          <button
            onClick={() => setShowMyDealsOnly(!showMyDealsOnly)}
            className={`px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
              showMyDealsOnly
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {showMyDealsOnly ? 'My Deals' : 'All Deals'}
          </button>
        </div>
      </div>

      {/* Stage Filter */}
      {stages.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedStage(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              selectedStage === null
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All ({deals.length})
          </button>
          {stages.map((stage) => {
            const count = deals.filter((d) => d.stage === stage).length
            return (
              <button
                key={stage}
                onClick={() => setSelectedStage(stage)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  selectedStage === stage
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {STAGE_NAMES[stage] || stage} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left">
                  <button
                    onClick={() => handleSort('company')}
                    className="text-sm font-semibold text-gray-900 hover:text-[#C9822B] transition flex items-center gap-1"
                  >
                    Company
                    {sortField === 'company' && (
                      <span className="text-xs">
                        {sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left">
                  <button
                    onClick={() => handleSort('stage')}
                    className="text-sm font-semibold text-gray-900 hover:text-[#C9822B] transition flex items-center gap-1"
                  >
                    Stage
                    {sortField === 'stage' && (
                      <span className="text-xs">
                        {sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left">
                  <button
                    onClick={() => handleSort('value')}
                    className="text-sm font-semibold text-gray-900 hover:text-[#C9822B] transition flex items-center gap-1"
                  >
                    Value
                    {sortField === 'value' && (
                      <span className="text-xs">
                        {sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left">
                  <button
                    onClick={() => handleSort('closeDate')}
                    className="text-sm font-semibold text-gray-900 hover:text-[#C9822B] transition flex items-center gap-1"
                  >
                    Expected Close
                    {sortField === 'closeDate' && (
                      <span className="text-xs">
                        {sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left">
                  <button
                    onClick={() => handleSort('activity')}
                    className="text-sm font-semibold text-gray-900 hover:text-[#C9822B] transition flex items-center gap-1"
                  >
                    Last Activity
                    {sortField === 'activity' && (
                      <span className="text-xs">
                        {sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left">
                  <span className="text-sm font-semibold text-gray-900">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredDeals.length > 0 ? (
                filteredDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="border-b border-gray-200 hover:bg-gray-50 transition"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/sales/deals/${deal.id}`}
                        className="text-gray-900 font-semibold hover:text-[#C9822B] transition"
                      >
                        {deal.companyName}
                      </Link>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {deal.contactName}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${
                          STAGE_COLORS[deal.stage] ||
                          'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {STAGE_NAMES[deal.stage] || deal.stage}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(deal.dealValue)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {formatDate(new Date(deal.expectedCloseDate))}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-sm">
                      {deal.updatedAt
                        ? formatDate(new Date(deal.updatedAt))
                        : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleMarkWon(deal.id)}
                          className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded text-xs font-medium transition flex items-center gap-1"
                          title="Mark as Won"
                        >
                          ✓ Won
                        </button>
                        <button
                          onClick={() => handleMarkLost(deal.id)}
                          className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium transition flex items-center gap-1"
                          title="Mark as Lost"
                        >
                          ✕ Lost
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    No deals found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
