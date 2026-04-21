'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/formatting'

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
}

const PIPELINE_STAGES = [
  'PROSPECT',
  'DISCOVERY',
  'WALKTHROUGH',
  'BID_SUBMITTED',
  'BID_REVIEW',
  'NEGOTIATION',
  'WON',
  'LOST',
]

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
  PROSPECT: 'bg-gray-50 border-gray-200',
  DISCOVERY: 'bg-blue-50 border-blue-200',
  WALKTHROUGH: 'bg-indigo-50 border-indigo-200',
  BID_SUBMITTED: 'bg-yellow-50 border-yellow-200',
  BID_REVIEW: 'bg-orange-50 border-orange-200',
  NEGOTIATION: 'bg-purple-50 border-purple-200',
  WON: 'bg-green-50 border-green-200',
  LOST: 'bg-red-50 border-red-200',
}

const CARD_COLORS: Record<string, string> = {
  PROSPECT: 'border-l-gray-300',
  DISCOVERY: 'border-l-blue-300',
  WALKTHROUGH: 'border-l-indigo-300',
  BID_SUBMITTED: 'border-l-yellow-300',
  BID_REVIEW: 'border-l-orange-300',
  NEGOTIATION: 'border-l-purple-300',
  WON: 'border-l-green-300',
  LOST: 'border-l-red-300',
}

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showMyDealsOnly, setShowMyDealsOnly] = useState(false)
  const [pipelineSearch, setPipelineSearch] = useState('')

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

  // Filter deals based on My Deals toggle and search
  let filteredDeals = showMyDealsOnly && currentUserId
    ? deals.filter((d) => d.ownerId === currentUserId)
    : deals

  if (pipelineSearch.trim()) {
    const q = pipelineSearch.toLowerCase()
    filteredDeals = filteredDeals.filter(d =>
      d.companyName?.toLowerCase().includes(q) ||
      d.contactName?.toLowerCase().includes(q) ||
      (d.owner?.firstName + ' ' + d.owner?.lastName)?.toLowerCase().includes(q)
    )
  }

  const dealsByStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = filteredDeals.filter((d) => d.stage === stage)
      return acc
    },
    {} as Record<string, Deal[]>
  )

  const stageValues = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = dealsByStage[stage].reduce((sum, d) => sum + (d.dealValue || 0), 0)
      return acc
    },
    {} as Record<string, number>
  )

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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C6A24E]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-gray-500 mt-1">Track your deals through each stage</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={pipelineSearch}
            onChange={(e) => setPipelineSearch(e.target.value)}
            placeholder="Search deals..."
            className="px-3 py-2 border rounded-lg text-sm w-48 focus:ring-2 focus:ring-[#C6A24E]/20 focus:border-[#C6A24E]"
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

      {/* Kanban Board */}
      <div className="overflow-x-auto pb-4">
        <div className="inline-flex gap-6 min-w-full pr-6">
          {PIPELINE_STAGES.map((stage) => {
            const stageDeals = dealsByStage[stage]
            const stageValue = stageValues[stage]

            return (
              <div key={stage} className="flex-shrink-0 w-80">
                {/* Column Header */}
                <div
                  className={`p-4 rounded-t-lg border-b-2 ${
                    STAGE_COLORS[stage]
                  } border-gray-200`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-gray-900">
                      {STAGE_NAMES[stage]}
                    </h3>
                    <span className="text-sm font-semibold text-gray-600 bg-white px-2.5 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-2 font-semibold">
                    {formatCurrency(stageValue)}
                  </p>
                </div>

                {/* Cards Container */}
                <div className={`border-x border-b rounded-b-lg p-3 space-y-3 min-h-96 ${
                  STAGE_COLORS[stage]
                } border-gray-200`}>
                  {stageDeals.length > 0 ? (
                    stageDeals.map((deal) => (
                      <div
                        key={deal.id}
                        className="relative group"
                      >
                        <Link
                          href={`/sales/deals/${deal.id}`}
                          className={`block p-4 bg-white rounded-lg border-l-4 shadow-sm hover:shadow-md transition cursor-pointer border-b ${CARD_COLORS[stage]} border-gray-200 hover:border-[#C6A24E]`}
                        >
                          <h4 className="font-semibold text-gray-900 text-sm line-clamp-1">
                            {deal.companyName}
                          </h4>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                            {deal.contactName}
                          </p>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                            <p className="text-sm font-bold text-gray-900">
                              {formatCurrency(deal.dealValue)}
                            </p>
                            <span className="text-xs text-gray-500">
                              {new Date(deal.expectedCloseDate).toLocaleDateString(
                                'en-US',
                                { month: 'short', day: 'numeric' }
                              )}
                            </span>
                          </div>
                        </Link>
                        {/* Quick Action Buttons - appear on hover */}
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              handleMarkWon(deal.id)
                            }}
                            className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium transition"
                            title="Mark as Won"
                          >
                            ✓
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              handleMarkLost(deal.id)
                            }}
                            className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium transition"
                            title="Mark as Lost"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-center h-20 text-gray-400 text-sm">
                      No deals
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
