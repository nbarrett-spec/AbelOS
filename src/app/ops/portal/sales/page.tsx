'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Deal {
  id: string
  dealNumber: string
  companyName: string
  stage: string
  dealValue: number
  expectedCloseDate: string | null
}

interface FollowUp {
  dealId: string
  companyName: string
  stage: string
  daysSinceActivity: number
}

interface Activity {
  id: string
  subject: string
  type: string
  dealId: string
  createdAt: string
}

interface Builder {
  id: string
  companyName: string
}

export default function SalesPortal() {
  const router = useRouter()
  const [myDeals, setMyDeals] = useState<Deal[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [recentActivity, setRecentActivity] = useState<Activity[]>([])
  const [featuredBuilders, setFeaturedBuilders] = useState<Builder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [selectedFollowUpDealId, setSelectedFollowUpDealId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [activityType, setActivityType] = useState('Call')
  const [activityNotes, setActivityNotes] = useState('')
  const [submittingActivity, setSubmittingActivity] = useState(false)

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const briefingRes = await fetch('/api/ops/sales-briefing')
      const briefingData = briefingRes.ok ? await briefingRes.json() : {}

      // Extract deals and follow-ups from briefing data
      setMyDeals((briefingData.closingThisWeek || []).slice(0, 5))
      setFollowUps((briefingData.followUpsDue || []).slice(0, 5))

      // Fetch recent activity from activity-log endpoint
      try {
        const activityRes = await fetch('/api/ops/activity-log?limit=10&page=1')
        if (activityRes.ok) {
          const activityData = await activityRes.json()
          setRecentActivity(
            (activityData.items || []).map((item: any) => ({
              id: item.id,
              subject: item.subject || `${item.activityType} by ${item.staffName}`,
              type: item.activityType,
              dealId: item.jobId || '',
              createdAt: item.createdAt,
            }))
          )
        }
      } catch (error) {
        console.error('Failed to load activity:', error)
        setRecentActivity([])
      }

      // Fetch featured builders from /api/ops/builders
      try {
        const buildersRes = await fetch('/api/ops/builders?limit=4&page=1&sortBy=createdAt&sortDir=desc')
        if (buildersRes.ok) {
          const buildersData = await buildersRes.json()
          setFeaturedBuilders((buildersData.builders || []).slice(0, 4))
        }
      } catch (error) {
        console.error('Failed to load builders:', error)
        setFeaturedBuilders([])
      }
    } catch (error) {
      console.error('Failed to load sales data:', error)
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const formatCurrency = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const formatDate = (d: string | null) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const handleSubmitActivity = async () => {
    if (!selectedFollowUpDealId || !activityNotes.trim()) return

    setSubmittingActivity(true)
    try {
      const response = await fetch(`/api/ops/deals/${selectedFollowUpDealId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityType: activityType,
          notes: activityNotes,
        }),
      })

      if (response.ok) {
        setActivityType('Call')
        setActivityNotes('')
        setShowActivityModal(false)
        setSelectedFollowUpDealId(null)
        setToastMessage('Activity logged successfully!')
        setTimeout(() => setToastMessage(null), 3000)
      } else {
        setToastMessage('Failed to log activity')
        setTimeout(() => setToastMessage(null), 3000)
      }
    } catch (error) {
      console.error('Failed to submit activity:', error)
      setToastMessage('Error logging activity')
      setTimeout(() => setToastMessage(null), 3000)
    } finally {
      setSubmittingActivity(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-gray-600 font-medium">{error}</p>
        <button onClick={() => { setError(null); loadData() }} className="mt-4 px-4 py-2 bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] text-sm">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sales Portal</h1>
          <p className="text-gray-600 mt-1">Manage deals, track pipeline, and close business</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/ops/quotes/new')}
            className="px-4 py-2 bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] transition-colors text-sm font-medium"
          >
            + New Deal
          </button>
          <button
            onClick={() => router.push('/ops/accounts')}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            Import Leads
          </button>
        </div>
      </div>

      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 max-w-xs">
          {toastMessage}
        </div>
      )}

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Link href="/ops/portal/sales/briefing" className="bg-white rounded-xl border border-[#E67E22] bg-orange-50 hover:bg-orange-100 transition-all p-4 text-center">
          <p className="text-2xl mb-2">☀️</p>
          <p className="text-sm font-medium text-gray-900">Morning Briefing</p>
        </Link>
        <Link href="/deals" className="bg-white rounded-xl border border-gray-200 hover:bg-blue-50 hover:border-[#1B4F72] transition-all p-4 text-center">
          <p className="text-2xl mb-2">📊</p>
          <p className="text-sm font-medium text-gray-900">View Pipeline</p>
        </Link>
        <Link href="/deals/new" className="bg-white rounded-xl border border-gray-200 hover:bg-green-50 hover:border-[#27AE60] transition-all p-4 text-center">
          <p className="text-2xl mb-2">🆕</p>
          <p className="text-sm font-medium text-gray-900">Create Deal</p>
        </Link>
        <Link href="/quotes" className="bg-white rounded-xl border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all p-4 text-center">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm font-medium text-gray-900">My Quotes</p>
        </Link>
        <Link href="/ops/portal/sales/scorecard" className="bg-white rounded-xl border border-gray-200 hover:bg-indigo-50 hover:border-indigo-500 transition-all p-4 text-center">
          <p className="text-2xl mb-2">📈</p>
          <p className="text-sm font-medium text-gray-900">Sales Scorecard</p>
        </Link>
        <Link href="/reports" className="bg-white rounded-xl border border-gray-200 hover:bg-pink-50 hover:border-pink-500 transition-all p-4 text-center">
          <p className="text-2xl mb-2">📊</p>
          <p className="text-sm font-medium text-gray-900">View Reports</p>
        </Link>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Deals - spans 2 columns */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Active Deals</h2>
            <Link href="/deals" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View All →
            </Link>
          </div>

          {myDeals.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">🤝</p>
              <p>No active deals yet</p>
              <Link href="/deals/new" className="text-sm text-[#1B4F72] hover:underline mt-2 inline-block">
                Create your first deal →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {myDeals.map(deal => (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-[#1B4F72] hover:bg-blue-50 transition-all">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{deal.companyName}</p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {deal.dealNumber} • {deal.stage.replace(/_/g, ' ')}
                      </p>
                      {deal.expectedCloseDate && (
                        <p className="text-xs text-gray-500 mt-1">
                          📅 Close: {formatDate(deal.expectedCloseDate)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-[#1B4F72]">{formatCurrency(deal.dealValue)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Stats</h3>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500">Active Deals</p>
              <p className="text-2xl font-bold text-[#1B4F72]">{myDeals.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Follow-Ups Due</p>
              <p className="text-2xl font-bold text-[#E67E22]">{followUps.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Pipeline Value</p>
              <p className="text-2xl font-bold text-[#27AE60]">
                {formatCurrency(
                  myDeals.reduce((sum, deal) => sum + deal.dealValue, 0)
                )}
              </p>
            </div>
            <div className="pt-4 border-t">
              <Link href="/ops/reports" className="block w-full px-4 py-2 text-sm font-medium text-[#1B4F72] border border-[#1B4F72] rounded-lg hover:bg-blue-50 transition-colors text-center">
                View Detailed Analytics
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Follow-Ups */}
      {followUps.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Upcoming Follow-Ups</h2>
            <Link href="/ops/portal/sales/briefing" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View All →
            </Link>
          </div>

          <div className="space-y-2">
            {followUps.map(followUp => (
              <div key={followUp.dealId} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-orange-50 transition-colors">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{followUp.companyName}</p>
                  <p className="text-xs text-gray-500">{followUp.stage} • {followUp.daysSinceActivity}d inactive</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedFollowUpDealId(followUp.dealId)
                    setShowActivityModal(true)
                  }}
                  className="text-sm text-[#1B4F72] hover:underline font-medium"
                >
                  Log Activity →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity Feed */}
      {recentActivity.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {recentActivity.map(activity => (
              <div key={activity.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                <div className="w-2 h-2 bg-[#1B4F72] rounded-full mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{activity.subject}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {activity.type} • {new Date(activity.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Account Cards */}
      {featuredBuilders.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Featured Accounts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {featuredBuilders.map(builder => (
              <div key={builder.id} className="p-4 rounded-lg border border-gray-200 hover:border-[#1B4F72] transition-all">
                <p className="font-semibold text-gray-900 text-sm">{builder.companyName}</p>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Active Deals</span>
                    <span className="font-semibold">—</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Pipeline Value</span>
                    <span className="font-semibold">—</span>
                  </div>
                </div>
                <Link href={`/ops/accounts/${builder.id}`} className="block w-full mt-3 text-xs py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors text-center">
                  View Account
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Logging Modal */}
      {showActivityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Log Activity</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Activity Type</label>
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent">
                    <option value="Call">Call</option>
                    <option value="Email">Email</option>
                    <option value="Meeting">Meeting</option>
                    <option value="Note">Note</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={activityNotes}
                    onChange={(e) => setActivityNotes(e.target.value)}
                    placeholder="Enter activity details..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent resize-none"
                    rows={4}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setShowActivityModal(false)
                    setSelectedFollowUpDealId(null)
                    setActivityType('Call')
                    setActivityNotes('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmitActivity}
                  disabled={submittingActivity || !activityNotes.trim()}
                  className="flex-1 px-4 py-2 bg-[#1B4F72] text-white rounded-lg text-sm font-medium hover:bg-[#154360] transition-colors disabled:opacity-50">
                  {submittingActivity ? 'Logging...' : 'Log Activity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
