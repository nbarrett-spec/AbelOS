'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, getTimeAgo } from '@/lib/formatting'

interface StaffUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  department: string
}

interface Deal {
  id: string
  companyName: string
  contactName: string
  dealValue: number
  stage: string
  expectedCloseDate: string
  owner: {
    id: string
    name: string
  }
  createdAt?: string
  updatedAt?: string
}

interface Activity {
  id: string
  type: string
  description: string
  timestamp: string
  icon: string
}

interface FollowUp {
  id: string
  dealId: string
  companyName: string
  dueDate: string
  type: string
  notes: string
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

export default function SalesDashboard() {
  const router = useRouter()
  const [staff, setStaff] = useState<StaffUser | null>(null)
  const [stats, setStats] = useState({
    activeDeals: 0,
    pipelineValue: 0,
    winRate: 0,
    followUpsDue: 0,
  })
  const [myDeals, setMyDeals] = useState<Deal[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLoading(true)

        // Fetch current user
        const meRes = await fetch('/api/ops/auth/me')
        if (meRes.ok) {
          const meData = await meRes.json()
          setStaff(meData.staff)
        }

        // Fetch deals (will be filtered by current user on the backend)
        const dealsRes = await fetch('/api/ops/sales/deals')
        if (dealsRes.ok) {
          const dealsData = await dealsRes.json()
          setMyDeals(dealsData)

          // Calculate stats from deals
          const activeDeals = dealsData.filter(
            (d: Deal) => !['WON', 'LOST'].includes(d.stage)
          ).length
          const pipelineValue = dealsData
            .filter((d: Deal) => !['WON', 'LOST'].includes(d.stage))
            .reduce((sum: number, d: Deal) => sum + (d.dealValue || 0), 0)

          // Calculate win rate
          const closedDeals = dealsData.filter((d: Deal) => ['WON', 'LOST'].includes(d.stage))
          const wonDeals = dealsData.filter((d: Deal) => d.stage === 'WON')
          const winRate = closedDeals.length > 0 ? Math.round((wonDeals.length / closedDeals.length) * 100) : 0

          setStats((prev) => ({
            ...prev,
            activeDeals,
            pipelineValue,
            winRate,
          }))

          // Generate recent activities
          const generatedActivities: Activity[] = dealsData
            .slice(0, 10)
            .map((deal: Deal, index: number) => ({
              id: `activity-${index}`,
              type: 'deal_update',
              description: `${deal.companyName} moved to ${STAGE_NAMES[deal.stage] || deal.stage}`,
              timestamp: deal.updatedAt || deal.createdAt || new Date().toISOString(),
              icon: '📊',
            }))
          setActivities(generatedActivities)
        }

        // Fetch real follow-ups from deals with upcoming follow-up dates
        try {
          const remindersRes = await fetch('/api/ops/sales/reminders')
          if (remindersRes.ok) {
            const remindersData = await remindersRes.json()
            const realFollowUps: FollowUp[] = (remindersData.reminders || remindersData || []).map((r: any) => ({
              id: r.id || r.dealId,
              dealId: r.dealId || r.id,
              companyName: r.companyName || r.builderName || 'Unknown',
              dueDate: r.followUpDate || r.dueDate || new Date().toISOString(),
              type: r.type || 'Follow-up',
              notes: r.notes || r.description || '',
            }))
            setFollowUps(realFollowUps)
            setStats((prev) => ({
              ...prev,
              followUpsDue: realFollowUps.filter(
                (f: FollowUp) => new Date(f.dueDate) <= new Date(Date.now() + 86400000)
              ).length,
            }))
          }
        } catch {
          // Follow-ups API may not have data yet
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Failed to load dashboard data:', error)
        }
      } finally {
        setLoading(false)
      }
    }

    loadDashboardData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#e67e22]" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {staff?.firstName}
        </h1>
        <p className="text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Active Deals */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">My Active Deals</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {stats.activeDeals}
              </p>
            </div>
            <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center text-2xl">
              💼
            </div>
          </div>
        </div>

        {/* Pipeline Value */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">My Pipeline Value</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {formatCurrency(stats.pipelineValue)}
              </p>
            </div>
            <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center text-2xl">
              📈
            </div>
          </div>
        </div>

        {/* Win Rate */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">My Win Rate</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.winRate}%</p>
              <p className="text-xs text-gray-500 mt-1">Won / (Won + Lost)</p>
            </div>
            <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center text-2xl">
              🎯
            </div>
          </div>
        </div>

        {/* Follow-ups Due */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">Follow-ups Due Today</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {stats.followUpsDue}
              </p>
            </div>
            <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center text-2xl">
              🔔
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Pipeline */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900">My Pipeline</h2>
            <Link
              href="/sales/pipeline"
              className="text-sm text-[#e67e22] hover:text-[#d35400] font-medium"
            >
              View All →
            </Link>
          </div>

          {myDeals.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {myDeals.slice(0, 5).map((deal) => (
                <Link
                  key={deal.id}
                  href={`/sales/deals/${deal.id}`}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-[#e67e22] hover:bg-gray-50 transition"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {deal.companyName}
                    </p>
                    <p className="text-sm text-gray-500">{deal.contactName}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span
                      className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${
                        STAGE_COLORS[deal.stage] || 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {STAGE_NAMES[deal.stage] || deal.stage}
                    </span>
                    <span className="text-right min-w-[80px]">
                      <p className="font-semibold text-gray-900">
                        {formatCurrency(deal.dealValue)}
                      </p>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No deals yet</p>
              <Link
                href="/sales/deals"
                className="text-sm text-[#e67e22] hover:text-[#d35400] font-medium mt-2 inline-block"
              >
                Create your first deal →
              </Link>
            </div>
          )}
        </div>

        {/* Follow-ups */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">My Follow-ups</h2>

          {followUps.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {followUps.map((followUp) => (
                <div
                  key={followUp.id}
                  className="p-3 border border-gray-200 rounded-lg hover:border-[#e67e22] transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-gray-900 text-sm">
                      {followUp.companyName}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800 font-medium">
                      {followUp.type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{followUp.notes}</p>
                  <p className="text-xs text-gray-400">
                    Due: {new Date(followUp.dueDate).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">No follow-ups scheduled</p>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-6">Recent Activity</h2>

        {activities.length > 0 ? (
          <div className="space-y-4">
            {activities.map((activity, index) => (
              <div key={activity.id} className="flex gap-4 pb-4 border-b border-gray-200 last:border-0">
                <div className="text-2xl flex-shrink-0">{activity.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 font-medium text-sm">
                    {activity.description}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {getTimeAgo(new Date(activity.timestamp))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-500 py-8">No activities yet</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-4 justify-center">
        <Link
          href="/sales/deals"
          className="px-6 py-3 bg-[#1e3a5f] text-white rounded-lg font-semibold hover:bg-[#1a2f4e] transition"
        >
          + New Deal
        </Link>
        <button onClick={() => router.push('/ops/communication-log')} className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition">
          📞 Log Call
        </button>
        <button onClick={() => router.push('/sales/documents')} className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition">
          📄 Request Document
        </button>
      </div>
    </div>
  )
}
