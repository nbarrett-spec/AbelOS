'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, formatPercent } from '@/lib/formatting'

interface Summary {
  totalDeals: number
  totalPipelineValue: number
  wonDeals: number
  wonValue: number
  lostDeals: number
  avgDealSize: number
  winRate: number
  avgDaysToClose: number
}

interface PipelineStage {
  stage: string
  count: number
  value: number
}

interface DealSource {
  source: string
  count: number
  value: number
  wonCount: number
}

interface RepPerformance {
  repId: string
  repName: string
  totalDeals: number
  wonDeals: number
  pipelineValue: number
  wonValue: number
  winRate: number
}

interface MonthlyTrendData {
  month: string
  newDeals: number
  wonDeals: number
  lostDeals: number
  wonValue: number
}

interface RecentWin {
  id: string
  companyName: string
  dealValue: number
  actualCloseDate: string
}

interface ReportsData {
  summary: Summary
  pipeline: PipelineStage[]
  bySource: DealSource[]
  byRep: RepPerformance[]
  monthlyTrend: MonthlyTrendData[]
  recentWins: RecentWin[]
}

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: '#3B82F6',
  DISCOVERY: '#8B5CF6',
  WALKTHROUGH: '#EC4899',
  BID_SUBMITTED: '#F59E0B',
  BID_REVIEW: '#C9822B',
  NEGOTIATION: '#6366F1',
  WON: '#10B981',
  LOST: '#EF4444',
  ONBOARDED: '#14B8A6',
}

const STAGE_DISPLAY_NAMES: Record<string, string> = {
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

export default function SalesReportsPage() {
  const [period, setPeriod] = useState<'this_month' | 'this_quarter' | 'this_year' | 'all_time'>('this_month')
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/ops/sales/reports?period=${period}`)
        if (response.ok) {
          const json = await response.json()
          setData(json)
        }
      } catch (error) {
        console.error('Failed to fetch reports:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchReports()
  }, [period])

  const getPeriodLabel = () => {
    const labels = {
      this_month: 'This Month',
      this_quarter: 'This Quarter',
      this_year: 'This Year',
      all_time: 'All Time',
    }
    return labels[period]
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading reports...</div>
      </div>
    )
  }

  // Find top performer
  const topPerformer =
    data.byRep.length > 0
      ? data.byRep.reduce((max, rep) => (rep.wonValue > max.wonValue ? rep : max))
      : null

  // Calculate max value for pipeline chart scaling
  const maxPipelineValue = Math.max(...data.pipeline.map((p) => p.value), 1)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">Sales Reports</h1>
            <p className="text-blue-100 mt-2">Comprehensive sales analytics and insights</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Period Selector */}
        <div className="mb-8 flex gap-2">
          {(['this_month', 'this_quarter', 'this_year', 'all_time'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                period === p
                  ? 'bg-[#C9822B] text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:border-[#C9822B]'
              }`}
            >
              {p === 'this_month'
                ? 'This Month'
                : p === 'this_quarter'
                  ? 'This Quarter'
                  : p === 'this_year'
                    ? 'This Year'
                    : 'All Time'}
            </button>
          ))}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {/* Total Pipeline Value */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Pipeline Value</p>
            <p className="text-2xl font-bold text-[#1e3a5f]">
              {formatCurrency(data.summary.totalPipelineValue)}
            </p>
            <p className="text-gray-400 text-xs mt-2">{data.summary.totalDeals} deals</p>
          </div>

          {/* Won Deals */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Won Deals</p>
            <p className="text-2xl font-bold text-green-600">{data.summary.wonDeals}</p>
            <p className="text-gray-400 text-xs mt-2">{formatCurrency(data.summary.wonValue)}</p>
          </div>

          {/* Win Rate */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Win Rate</p>
            <p className="text-2xl font-bold text-[#C9822B]">{data.summary.winRate}%</p>
            <p className="text-gray-400 text-xs mt-2">of closed deals</p>
          </div>

          {/* Avg Deal Size */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Avg Deal Size</p>
            <p className="text-2xl font-bold text-[#1e3a5f]">
              {formatCurrency(data.summary.avgDealSize)}
            </p>
            <p className="text-gray-400 text-xs mt-2">per deal</p>
          </div>

          {/* Lost Deals */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Lost Deals</p>
            <p className="text-2xl font-bold text-red-600">{data.summary.lostDeals}</p>
            <p className="text-gray-400 text-xs mt-2">closed</p>
          </div>

          {/* Avg Days to Close */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Avg Days to Close</p>
            <p className="text-2xl font-bold text-[#1e3a5f]">{data.summary.avgDaysToClose}</p>
            <p className="text-gray-400 text-xs mt-2">days</p>
          </div>
        </div>

        {/* Pipeline Funnel */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-bold text-[#1e3a5f] mb-6">Pipeline Funnel</h2>
          <div className="space-y-4">
            {data.pipeline
              .sort((a, b) => {
                const order = ['PROSPECT', 'DISCOVERY', 'WALKTHROUGH', 'BID_SUBMITTED', 'BID_REVIEW', 'NEGOTIATION', 'WON', 'LOST', 'ONBOARDED']
                return order.indexOf(a.stage) - order.indexOf(b.stage)
              })
              .map((stage) => {
                const percentage = (stage.value / maxPipelineValue) * 100
                const widthPercentage = Math.max(percentage, 5)
                return (
                  <div key={stage.stage} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        {STAGE_DISPLAY_NAMES[stage.stage]}
                      </span>
                      <span className="text-sm text-gray-600">
                        {stage.count} deals • {formatCurrency(stage.value)}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-8 overflow-hidden">
                      <div
                        className="h-full rounded-full flex items-center justify-start pl-2 transition-all"
                        style={{
                          width: `${widthPercentage}%`,
                          backgroundColor: STAGE_COLORS[stage.stage],
                        }}
                      >
                        {widthPercentage > 10 && (
                          <span className="text-xs font-bold text-white">
                            {Math.round(percentage)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Two-column section: Sources and Monthly Trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Deals by Source */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-[#1e3a5f] mb-4">Deals by Source</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Source</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Count</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Value</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySource.map((source) => (
                    <tr key={source.source} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-900">{source.source}</td>
                      <td className="text-right py-3 px-4 text-gray-600">{source.count}</td>
                      <td className="text-right py-3 px-4 text-gray-900 font-medium">
                        {formatCurrency(source.value)}
                      </td>
                      <td className="text-right py-3 px-4 text-green-600 font-medium">{source.wonCount}</td>
                    </tr>
                  ))}
                  {data.bySource.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 px-4 text-center text-gray-400 text-sm">
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly Trend */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-[#1e3a5f] mb-4">Monthly Trend</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Month</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">New</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Won</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Lost</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Won Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthlyTrend.map((month) => (
                    <tr key={month.month} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-900">{month.month}</td>
                      <td className="text-right py-3 px-4 text-gray-600">{month.newDeals}</td>
                      <td className="text-right py-3 px-4 text-green-600 font-medium">{month.wonDeals}</td>
                      <td className="text-right py-3 px-4 text-red-600 font-medium">{month.lostDeals}</td>
                      <td className="text-right py-3 px-4 text-gray-900 font-medium">
                        {formatCurrency(month.wonValue)}
                      </td>
                    </tr>
                  ))}
                  {data.monthlyTrend.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 px-4 text-center text-gray-400 text-sm">
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Rep Performance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-bold text-[#1e3a5f] mb-4">Rep Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Rep Name</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Total Deals</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Won Deals</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Pipeline Value</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Won Value</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.byRep.map((rep) => (
                  <tr
                    key={rep.repId}
                    className={`border-b border-gray-100 hover:bg-gray-50 ${
                      topPerformer && rep.repId === topPerformer.repId ? 'bg-yellow-50' : ''
                    }`}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{rep.repName}</span>
                        {topPerformer && rep.repId === topPerformer.repId && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#C9822B] text-white text-xs font-semibold">
                            ⭐ Top
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right py-3 px-4 text-gray-600">{rep.totalDeals}</td>
                    <td className="text-right py-3 px-4 text-green-600 font-medium">{rep.wonDeals}</td>
                    <td className="text-right py-3 px-4 text-gray-900 font-medium">
                      {formatCurrency(rep.pipelineValue)}
                    </td>
                    <td className="text-right py-3 px-4 text-gray-900 font-medium">
                      {formatCurrency(rep.wonValue)}
                    </td>
                    <td className="text-right py-3 px-4 text-[#C9822B] font-bold">{rep.winRate}%</td>
                  </tr>
                ))}
                {data.byRep.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 px-4 text-center text-gray-400 text-sm">
                      No data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Wins */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-[#1e3a5f] mb-4">Recent Wins</h2>
          {data.recentWins.length === 0 ? (
            <p className="text-gray-400 text-sm">No recent wins</p>
          ) : (
            <div className="space-y-3">
              {data.recentWins.map((win) => (
                <div
                  key={win.id}
                  className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{win.companyName}</p>
                    <p className="text-sm text-gray-500">
                      Closed {win.actualCloseDate}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-600">
                      {formatCurrency(win.dealValue)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
