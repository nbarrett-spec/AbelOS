'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface BuilderScore {
  builderId: string
  builderName: string
  compositeScore: number
  grade: string
  paymentScore: number
  paymentGrade: string
  activityScore: number
  activityGrade: string
  marginScore: number
  marginGrade: string
  relationshipScore: number
  relationshipGrade: string
  arOutstanding: number
  overdueAmount: number
  last90dOrders: number
  riskLevel: string
  trend: string
}

interface Summary {
  totalBuilders: number
  gradeDistribution: Record<string, number>
  avgScore: number
  atRiskCount: number
}

function GradeBadge({ grade }: { grade: string }) {
  const gradeColors: Record<string, string> = {
    A: 'bg-green-100 text-green-800',
    B: 'bg-blue-100 text-blue-800',
    C: 'bg-amber-100 text-amber-800',
    D: 'bg-orange-100 text-orange-800',
    F: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${gradeColors[grade] || 'bg-gray-100'}`}>
      {grade}
    </span>
  )
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    LOW: 'bg-green-100 text-green-800',
    MEDIUM: 'bg-amber-100 text-amber-800',
    HIGH: 'bg-orange-100 text-orange-800',
    CRITICAL: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-block px-2 py-1 text-xs rounded-md ${colors[level] || 'bg-gray-100'}`}>
      {level}
    </span>
  )
}

function GradeDistributionBar({ distribution }: { distribution: Record<string, number> }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0) || 1
  const colors = { A: 'bg-green-500', B: 'bg-blue-500', C: 'bg-signal', D: 'bg-orange-500', F: 'bg-red-500' }
  const grades: Array<keyof typeof colors> = ['A', 'B', 'C', 'D', 'F']
  return (
    <div className="flex gap-1 h-8 rounded-md overflow-hidden border border-gray-300">
      {grades.map(g => (
        <div
          key={g}
          className={`flex items-center justify-center text-white text-xs font-bold ${colors[g]}`}
          style={{ width: `${((distribution[g] || 0) / total) * 100}%` }}
        >
          {(distribution[g] || 0) > 0 ? distribution[g] : ''}
        </div>
      ))}
    </div>
  )
}

export default function BuilderHealthPage() {
  const [builders, setBuilders] = useState<BuilderScore[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterRisk, setFilterRisk] = useState<string>('ALL')
  const [filterGrade, setFilterGrade] = useState<string>('ALL')
  const [searchName, setSearchName] = useState('')
  const [sortBy, setSortBy] = useState<string>('compositeScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadHealthScores()
  }, [])

  async function loadHealthScores() {
    setLoading(true)
    try {
      const resp = await fetch('/api/ops/customers/health')
      const data = await resp.json()
      if (resp.ok) {
        setBuilders(data.builders || [])
        setSummary(data.summary)
      }
    } catch (err) {
      console.error('Failed to load health scores:', err)
    } finally {
      setLoading(false)
    }
  }

  function getFilteredAndSorted() {
    let filtered = builders.filter(b => {
      if (filterRisk !== 'ALL' && b.riskLevel !== filterRisk) return false
      if (filterGrade !== 'ALL' && b.grade !== filterGrade) return false
      if (searchName && !b.builderName.toLowerCase().includes(searchName.toLowerCase())) return false
      return true
    })

    filtered.sort((a, b) => {
      let aVal: any = a[sortBy as keyof BuilderScore]
      let bVal: any = b[sortBy as keyof BuilderScore]
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      return sortDir === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1)
    })

    return filtered
  }

  const filtered = getFilteredAndSorted()

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Builder Health Scores</h1>
          <p className="text-gray-600 mt-1">A-F grades across payment, activity, margin, and relationship</p>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gray-400">
              <div className="text-sm font-semibold text-gray-600">Total Builders</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{summary.totalBuilders}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
              <div className="text-sm font-semibold text-gray-600">Average Score</div>
              <div className="text-3xl font-bold text-blue-600 mt-2">{summary.avgScore}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="text-sm font-semibold text-gray-600">At Risk (D/F)</div>
              <div className="text-3xl font-bold text-red-600 mt-2">{summary.atRiskCount}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
              <div className="text-sm font-semibold text-gray-600">Grade A Count</div>
              <div className="text-3xl font-bold text-green-600 mt-2">{summary.gradeDistribution.A || 0}</div>
            </div>
          </div>
        )}

        {/* Grade Distribution */}
        {summary && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Grade Distribution</h2>
            <GradeDistributionBar distribution={summary.gradeDistribution} />
            <div className="flex gap-6 mt-4 text-sm">
              {Object.entries(summary.gradeDistribution).map(([grade, count]) => (
                <div key={grade}>
                  <span className="font-semibold text-gray-700">Grade {grade}:</span> {count} builders
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters & Controls */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Search by Name</label>
              <input
                type="text"
                placeholder="Filter builders..."
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Filter by Risk</label>
              <select
                value={filterRisk}
                onChange={e => setFilterRisk(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="ALL">All Risk Levels</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Filter by Grade</label>
              <select
                value={filterGrade}
                onChange={e => setFilterGrade(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="ALL">All Grades</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="F">F</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={loadHealthScores}
                className="w-full px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-semibold hover:bg-gray-800"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Main Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-white">
                <tr>
                  <th
                    className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-gray-800"
                    onClick={() => {
                      setSortBy('builderName')
                      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
                    }}
                  >
                    Builder {sortBy === 'builderName' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th
                    className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-800"
                    onClick={() => {
                      setSortBy('compositeScore')
                      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
                    }}
                  >
                    Score {sortBy === 'compositeScore' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold">Payment</th>
                  <th className="px-4 py-3 text-center font-semibold">Activity</th>
                  <th className="px-4 py-3 text-center font-semibold">Margin</th>
                  <th className="px-4 py-3 text-center font-semibold">Relationship</th>
                  <th className="px-4 py-3 text-right font-semibold">AR Outstanding</th>
                  <th className="px-4 py-3 text-center font-semibold">Risk</th>
                  <th className="px-4 py-3 text-center font-semibold">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                      Loading health scores...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                      No builders match your filters
                    </td>
                  </tr>
                ) : (
                  filtered.map(builder => (
                    <tbody key={builder.builderId}>
                      <tr
                        className="hover:bg-row-hover cursor-pointer"
                        onClick={() => setExpandedId(expandedId === builder.builderId ? null : builder.builderId)}
                      >
                        <td className="px-4 py-3 font-semibold text-gray-900">{builder.builderName}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="font-bold">{builder.compositeScore}</span>
                            <GradeBadge grade={builder.grade} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs">{builder.paymentScore}</span>
                          <br />
                          <GradeBadge grade={builder.paymentGrade} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs">{builder.activityScore}</span>
                          <br />
                          <GradeBadge grade={builder.activityGrade} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs">{builder.marginScore}</span>
                          <br />
                          <GradeBadge grade={builder.marginGrade} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs">{builder.relationshipScore}</span>
                          <br />
                          <GradeBadge grade={builder.relationshipGrade} />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          ${builder.arOutstanding.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <RiskBadge level={builder.riskLevel} />
                        </td>
                        <td className="px-4 py-3 text-center text-lg">{builder.trend}</td>
                      </tr>
                      {expandedId === builder.builderId && (
                        <tr className="bg-gray-50">
                          <td colSpan={9} className="px-4 py-4">
                            <div className="grid grid-cols-3 gap-6">
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-2">Payment Health</h4>
                                <div className="space-y-1 text-sm">
                                  <div>Score: <span className="font-bold">{builder.paymentScore}</span></div>
                                  <div>Grade: <span className="font-bold">{builder.paymentGrade}</span></div>
                                  <div>Overdue: <span className="font-bold text-red-600">${builder.overdueAmount.toLocaleString()}</span></div>
                                </div>
                              </div>
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-2">Order Activity</h4>
                                <div className="space-y-1 text-sm">
                                  <div>Score: <span className="font-bold">{builder.activityScore}</span></div>
                                  <div>Grade: <span className="font-bold">{builder.activityGrade}</span></div>
                                  <div>Last 90d Orders: <span className="font-bold">{builder.last90dOrders}</span></div>
                                </div>
                              </div>
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-2">Relationship Depth</h4>
                                <div className="space-y-1 text-sm">
                                  <div>Score: <span className="font-bold">{builder.relationshipScore}</span></div>
                                  <div>Grade: <span className="font-bold">{builder.relationshipGrade}</span></div>
                                  <div>Risk Level: <span className="font-bold">{builder.riskLevel}</span></div>
                                </div>
                              </div>
                            </div>
                            <div className="mt-4">
                              <Link
                                href={`/ops/customers/${builder.builderId}`}
                                className="text-sm text-blue-600 hover:text-blue-800 font-semibold"
                              >
                                View Full Account →
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-xs text-gray-500 text-center">
          Showing {filtered.length} of {builders.length} builders
          {filterRisk !== 'ALL' && ` • Risk: ${filterRisk}`}
          {filterGrade !== 'ALL' && ` • Grade: ${filterGrade}`}
        </div>
      </div>
    </div>
  )
}
