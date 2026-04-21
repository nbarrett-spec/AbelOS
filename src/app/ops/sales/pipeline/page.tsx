'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/formatting'

interface DealCardData {
  id: string
  dealNumber: string
  companyName: string
  contactName: string
  dealValue: number
  probability: number
  expectedCloseDate: string
  ownerId: string
  owner: {
    id: string
    firstName: string
    lastName: string
    email: string
    initials: string
  }
  updatedAt: string
}

interface StageData {
  stage: string
  deals: DealCardData[]
  stats: {
    count: number
    totalValue: number
  }
}

interface PipelineData {
  [key: string]: StageData
}

interface ActivityModalState {
  isOpen: boolean
  dealId: string | null
  dealName: string | null
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
  'ONBOARDED',
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
  ONBOARDED: 'Onboarded',
}

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: 'bg-slate-50 border-slate-300',
  DISCOVERY: 'bg-blue-50 border-blue-300',
  WALKTHROUGH: 'bg-indigo-50 border-indigo-300',
  BID_SUBMITTED: 'bg-yellow-50 border-yellow-300',
  BID_REVIEW: 'bg-orange-50 border-orange-300',
  NEGOTIATION: 'bg-purple-50 border-purple-300',
  WON: 'bg-green-50 border-green-300',
  LOST: 'bg-red-50 border-red-300',
  ONBOARDED: 'bg-emerald-50 border-emerald-300',
}

const STAGE_HEADER_COLORS: Record<string, string> = {
  PROSPECT: 'bg-slate-200',
  DISCOVERY: 'bg-blue-200',
  WALKTHROUGH: 'bg-indigo-200',
  BID_SUBMITTED: 'bg-yellow-200',
  BID_REVIEW: 'bg-orange-200',
  NEGOTIATION: 'bg-purple-200',
  WON: 'bg-green-200',
  LOST: 'bg-red-200',
  ONBOARDED: 'bg-emerald-200',
}

const SPECIAL_STAGE_ICONS: Record<string, string> = {
  WON: '✅',
  LOST: '❌',
  ONBOARDED: '🎉',
}

function getProbabilityColor(probability: number): string {
  if (probability < 25) return 'bg-red-100 text-red-800'
  if (probability < 50) return 'bg-amber-100 text-amber-800'
  if (probability < 75) return 'bg-blue-100 text-blue-800'
  return 'bg-green-100 text-green-800'
}

function ActivityLogModal({ isOpen, dealId, dealName, onClose }: { isOpen: boolean; dealId: string | null; dealName: string | null; onClose: () => void }) {
  const [activityType, setActivityType] = useState('CALL')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dealId || !subject.trim()) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/ops/sales/deals/${dealId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activityType,
          subject,
          notes: notes || null,
          followUpDate: followUpDate || null,
        }),
      })

      if (res.ok) {
        setActivityType('CALL')
        setSubject('')
        setNotes('')
        setFollowUpDate('')
        onClose()
      }
    } catch (error) {
      console.error('Failed to log activity:', error)
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md mx-4">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Log Activity</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-1">{dealName}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Activity Type</label>
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]">
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
              <option value="MEETING">Meeting</option>
              <option value="SITE_VISIT">Site Visit</option>
              <option value="TEXT">Text</option>
              <option value="NOTE">Note</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g., Discussed pricing options"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E] resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Follow-up Date</label>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !subject.trim()}
              className="flex-1 px-4 py-2 bg-[#C6A24E] text-white rounded-lg text-sm font-medium hover:bg-[#d46711] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Logging...' : 'Log Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SalesPipelinePage() {
  const [pipeline, setPipeline] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOwner, setFilterOwner] = useState('')
  const [dateRangeStart, setDateRangeStart] = useState('')
  const [dateRangeEnd, setDateRangeEnd] = useState('')
  const [activityModal, setActivityModal] = useState<ActivityModalState>({ isOpen: false, dealId: null, dealName: null })
  const [owners, setOwners] = useState<Record<string, string>>({})

  useEffect(() => {
    const fetchPipeline = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/ops/sales/pipeline')
        if (res.ok) {
          const data = await res.json()
          setPipeline(data.pipeline)

          // Collect unique owners for filter dropdown
          const ownerMap: Record<string, string> = {}
          for (const stage of Object.values(data.pipeline) as any[]) {
            for (const deal of (stage.deals || [])) {
              if (deal.owner) {
                const key = deal.owner.id
                const name = `${deal.owner.firstName} ${deal.owner.lastName}`.trim()
                if (name && key) ownerMap[key] = name
              }
            }
          }
          setOwners(ownerMap)
        }
      } catch (error) {
        console.error('Failed to fetch pipeline:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPipeline()
  }, [])

  const handleMoveStage = async (dealId: string, newStage: string) => {
    try {
      const res = await fetch('/api/ops/sales/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, newStage }),
      })

      if (res.ok) {
        // Refresh pipeline
        const res2 = await fetch('/api/ops/sales/pipeline')
        if (res2.ok) {
          const data = await res2.json()
          setPipeline(data.pipeline)
        }
      }
    } catch (error) {
      console.error('Failed to move deal:', error)
    }
  }

  const getFilteredDeals = (deals: DealCardData[]): DealCardData[] => {
    return deals.filter((deal) => {
      // Search filter
      if (searchQuery && !deal.companyName.toLowerCase().includes(searchQuery.toLowerCase()) && !deal.contactName.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }

      // Owner filter
      if (filterOwner && deal.ownerId !== filterOwner) {
        return false
      }

      // Date range filter
      if ((dateRangeStart || dateRangeEnd) && deal.expectedCloseDate) {
        const dealDate = new Date(deal.expectedCloseDate)
        if (dateRangeStart && dealDate < new Date(dateRangeStart)) return false
        if (dateRangeEnd && dealDate > new Date(dateRangeEnd)) return false
      }

      return true
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading pipeline...</div>
      </div>
    )
  }

  if (!pipeline) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Failed to load pipeline</div>
      </div>
    )
  }

  // Calculate totals
  const totalDeals = Object.values(pipeline).reduce((sum, stage) => sum + stage.stats.count, 0)
  const totalValue = Object.values(pipeline).reduce((sum, stage) => sum + stage.stats.totalValue, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#0f2a3e] text-white px-8 py-8">
        <div className="max-w-full">
          <h1 className="text-3xl font-bold">Sales Pipeline</h1>
          <p className="text-amber-100 mt-2">Kanban view of all deals in progress</p>
        </div>
      </div>

      <div className="max-w-full px-8 py-8">
        {/* Summary Stats */}
        <div className="bg-gradient-to-r from-[#0f2a3e] to-[#5a3f2a] text-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex gap-12">
              <div>
                <p className="text-sm font-medium text-amber-100 mb-1">Total Deals</p>
                <p className="text-3xl font-bold">{totalDeals}</p>
              </div>
              <div className="border-l border-amber-400"></div>
              <div>
                <p className="text-sm font-medium text-amber-100 mb-1">Pipeline Value</p>
                <p className="text-3xl font-bold">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Company or contact..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Owner</label>
              <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]">
                <option value="">All owners</option>
                {Object.entries(owners).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">From</label>
              <input
                type="date"
                value={dateRangeStart}
                onChange={(e) => setDateRangeStart(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">To</label>
              <input
                type="date"
                value={dateRangeEnd}
                onChange={(e) => setDateRangeEnd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
              />
            </div>
          </div>
          {(searchQuery || filterOwner || dateRangeStart || dateRangeEnd) && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setSearchQuery('')
                  setFilterOwner('')
                  setDateRangeStart('')
                  setDateRangeEnd('')
                }}
                className="text-sm text-[#C6A24E] hover:underline font-medium"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Kanban Board */}
        <div className="overflow-x-auto pb-8">
          <div className="flex gap-4" style={{ minWidth: 'fit-content' }}>
            {PIPELINE_STAGES.map((stage) => {
              const stageData = pipeline[stage]
              const filteredDeals = getFilteredDeals(stageData.deals)
              const hasIcon = SPECIAL_STAGE_ICONS[stage]

              return (
                <div key={stage} className="flex-shrink-0 w-[320px] flex flex-col">
                  {/* Stage Header */}
                  <div className={`${STAGE_HEADER_COLORS[stage]} rounded-t-lg p-4 border-b border-gray-300`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {hasIcon && <span className="text-lg">{hasIcon}</span>}
                        <h3 className="font-bold text-gray-900">{STAGE_NAMES[stage]}</h3>
                      </div>
                      <span className="bg-white bg-opacity-70 px-2.5 py-1 rounded-full text-sm font-semibold text-gray-700">{filteredDeals.length}</span>
                    </div>
                    <div className="text-sm font-semibold text-gray-700">
                      {filteredDeals.length > 0 ? formatCurrency(filteredDeals.reduce((sum, d) => sum + d.dealValue, 0)) : '—'}
                    </div>
                  </div>

                  {/* Stage Cards Container */}
                  <div className={`flex-1 p-3 space-y-3 rounded-b-lg border-l border-r border-b ${STAGE_COLORS[stage]}`} style={{ minHeight: '500px' }}>
                    {filteredDeals.length === 0 ? (
                      <div className="text-gray-400 text-xs py-8 text-center">No deals</div>
                    ) : (
                      filteredDeals.map((deal) => (
                        <div key={deal.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
                          {/* Card Header with Actions */}
                          <div className="flex items-start justify-between mb-2 gap-2">
                            <Link href={`/ops/sales/deals/${deal.id}`}>
                              <div className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                                <p className="font-bold text-sm text-gray-900 truncate">{deal.companyName}</p>
                                <p className="text-xs text-gray-600 truncate">{deal.contactName}</p>
                              </div>
                            </Link>
                            <div className="flex-shrink-0 relative group">
                              <button className="text-gray-400 hover:text-gray-600 text-lg">⋯</button>
                              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg hidden group-hover:block z-10">
                                <button
                                  onClick={() => setActivityModal({ isOpen: true, dealId: deal.id, dealName: deal.companyName })}
                                  className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                                >
                                  Log Activity
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Deal Value */}
                          <p className="font-bold text-base text-[#C6A24E] mb-2">{formatCurrency(deal.dealValue)}</p>

                          {/* Probability Badge + Expected Close */}
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${getProbabilityColor(deal.probability)}`}>{deal.probability}%</span>
                            <p className="text-xs text-gray-500">
                              {deal.expectedCloseDate
                                ? new Date(deal.expectedCloseDate).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  })
                                : 'No date'}
                            </p>
                          </div>

                          {/* Owner Initials */}
                          <div className="flex items-center gap-1 pt-2 border-t border-gray-100">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#0f2a3e] text-white text-xs font-bold">{deal.owner?.initials || 'U'}</div>
                            <p className="text-xs text-gray-500">{deal.owner?.firstName || 'Unknown'}</p>
                          </div>

                          {/* Move to Stage Buttons (Mini) */}
                          <div className="mt-3 pt-2 border-t border-gray-100">
                            <p className="text-xs text-gray-500 mb-1.5">Move to:</p>
                            <div className="flex flex-wrap gap-1">
                              {PIPELINE_STAGES.filter((s) => s !== stage)
                                .slice(0, 3)
                                .map((nextStage) => (
                                  <button
                                    key={nextStage}
                                    onClick={() => handleMoveStage(deal.id, nextStage)}
                                    className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-[#C6A24E] hover:text-white transition-colors font-medium"
                                  >
                                    {STAGE_NAMES[nextStage].split(' ')[0]}
                                  </button>
                                ))}
                              {PIPELINE_STAGES.filter((s) => s !== stage).length > 3 && (
                                <div className="relative group">
                                  <button className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors font-medium">...</button>
                                  <div className="absolute left-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg hidden group-hover:block z-10">
                                    {PIPELINE_STAGES.filter((s) => s !== stage)
                                      .slice(3)
                                      .map((nextStage) => (
                                        <button
                                          key={nextStage}
                                          onClick={() => handleMoveStage(deal.id, nextStage)}
                                          className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                                        >
                                          {STAGE_NAMES[nextStage]}
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Activity Log Modal */}
      <ActivityLogModal isOpen={activityModal.isOpen} dealId={activityModal.dealId} dealName={activityModal.dealName} onClose={() => setActivityModal({ isOpen: false, dealId: null, dealName: null })} />
    </div>
  )
}
