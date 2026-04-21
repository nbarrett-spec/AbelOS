'use client'

import { useEffect, useState } from 'react'

interface DataQualityDashboard {
  summary: {
    totalRules: number
    criticalIssues: number
    warningIssues: number
    infoIssues: number
    autoFixedLast7d: number
    healthScore: number
  }
  rules: any[]
  issues: any[]
  pagination: any
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'CRITICAL': return 'bg-red-100 text-red-800'
    case 'WARNING': return 'bg-amber-100 text-amber-800'
    case 'INFO': return 'bg-blue-100 text-blue-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function getHealthColor(score: number) {
  if (score > 80) return 'text-green-600'
  if (score >= 50) return 'text-signal'
  return 'text-red-600'
}

export default function DataQualityPage() {
  const [data, setData] = useState<DataQualityDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set())
  const [runningCheck, setRunningCheck] = useState(false)
  const [entityFilter, setEntityFilter] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      const url = entityFilter ? `/api/ops/admin/data-quality?entity=${entityFilter}` : '/api/ops/admin/data-quality'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch dashboard data')
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [entityFilter])

  const runNow = async () => {
    try {
      setRunningCheck(true)
      // Route through the admin API — never expose CRON_SECRET to the browser
      const res = await fetch('/api/ops/admin/data-quality/run', {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to run check')
      await new Promise((r) => setTimeout(r, 1000))
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRunningCheck(false)
    }
  }

  const toggleRule = (ruleId: string) => {
    setExpandedRules((prev) => {
      const next = new Set(prev)
      next.has(ruleId) ? next.delete(ruleId) : next.add(ruleId)
      return next
    })
  }

  if (loading && !data) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-40 bg-gray-200 rounded"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Quality Watchdog</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor and fix data integrity issues</p>
        </div>
        <button
          onClick={runNow}
          disabled={runningCheck}
          className="px-4 py-2 bg-brand text-white rounded hover:bg-brand/90 text-sm font-medium disabled:opacity-50"
        >
          {runningCheck ? 'Running...' : 'Run Now'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Active Rules</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{data.summary.totalRules}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-red-600 font-semibold">Critical</div>
          <div className="text-3xl font-bold text-red-600 mt-1">{data.summary.criticalIssues}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-signal font-semibold">Warnings</div>
          <div className="text-3xl font-bold text-signal mt-1">{data.summary.warningIssues}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Auto-Fixed (7d)</div>
          <div className="text-3xl font-bold text-green-600 mt-1">{data.summary.autoFixedLast7d}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Health Score</div>
          <div className={`text-3xl font-bold mt-1 ${getHealthColor(data.summary.healthScore)}`}>
            {data.summary.healthScore}
          </div>
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Rules ({data.rules.length})</h2>
          <p className="text-xs text-gray-500 mt-0.5">Click to expand and view violating entities</p>
        </div>
        <div className="divide-y divide-gray-200">
          {data.rules.map((rule: any) => (
            <div key={rule.id}>
              <button
                onClick={() => toggleRule(rule.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3 flex-1 text-left">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${getSeverityColor(rule.severity)}`}>
                    {rule.severity}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{rule.name}</p>
                    <p className="text-xs text-gray-500">{rule.entity}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700">
                    {rule.openIssuesCount} issues
                  </span>
                  <span className="text-gray-400 text-xs">{expandedRules.has(rule.id) ? '▲' : '▼'}</span>
                </div>
              </button>

              {expandedRules.has(rule.id) && (
                <div className="border-t bg-gray-50 p-4 space-y-2 max-h-64 overflow-y-auto">
                  {data.issues
                    .filter((i: any) => i.ruleId === rule.id)
                    .slice(0, 10)
                    .map((issue: any) => (
                      <div key={issue.id} className="p-3 bg-white border rounded flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{issue.entityLabel || issue.entityId}</p>
                          <p className="text-xs text-gray-500">{issue.entityType}</p>
                        </div>
                        {rule.fixUrl && (
                          <a
                            href={rule.fixUrl.replace('{id}', issue.entityId)}
                            className="text-blue-600 hover:text-blue-700 text-xs"
                          >
                            Fix →
                          </a>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Issues */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Issues</h2>
          <select
            value={entityFilter || ''}
            onChange={(e) => setEntityFilter(e.target.value || null)}
            className="px-2 py-1 border rounded text-sm"
          >
            <option value="">All Entities</option>
            <option value="Job">Jobs</option>
            <option value="Product">Products</option>
            <option value="Builder">Builders</option>
            <option value="Invoice">Invoices</option>
            <option value="PurchaseOrder">POs</option>
          </select>
        </div>
        <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
          {data.issues.map((issue: any) => (
            <div key={issue.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${getSeverityColor(issue.ruleSeverity || issue.rule?.severity)}`}>
                    {issue.ruleSeverity || issue.rule?.severity}
                  </span>
                  <p className="font-medium text-gray-900 text-sm">{issue.ruleName || issue.rule?.name}</p>
                </div>
                <p className="text-xs text-gray-600">
                  {issue.entityLabel || issue.entityId} • {issue.entityType}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(issue.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
        {data.pagination && (
          <div className="px-4 py-2 bg-gray-50 border-t text-center text-xs text-gray-500">
            Showing {data.issues.length} of {data.pagination.total} issues
            {data.pagination.pages > 1 && ` (page ${data.pagination.page}/${data.pagination.pages})`}
          </div>
        )}
      </div>
    </div>
  )
}
