'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

// ──────────────────────────────────────────────────────────────────────────
// /ops/ai/insights — AI-powered intelligence dashboard
//
// Real-time insights from autonomous scans of Abel OS data:
//   - MARGIN alerts (low gross margin products)
//   - AR risk (builders with overdue invoices >$50K)
//   - Inventory stockouts
//   - Stale quotes (sent but not followed up)
//   - Growth signals (increasing order frequency)
//   - Collection needs (30+ days overdue)
//
// UI:
//   1. Header with subtitle
//   2. Summary bar (4 cards: critical, warning, info, total)
//   3. Filter bar (category, severity, search)
//   4. Insights feed (cards sorted by severity then recency)
//   5. Empty state if no insights
// ──────────────────────────────────────────────────────────────────────────

type InsightCategory = 'MARGIN' | 'AR' | 'INVENTORY' | 'SALES' | 'GROWTH' | 'COLLECTION'
type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO'

interface Insight {
  id: string
  category: InsightCategory
  severity: InsightSeverity
  title: string
  description: string
  impact: string
  entityType: string
  entityId: string | null
  entityLabel: string | null
  createdAt: string
  source: string
}

interface InsightSummary {
  total: number
  critical: number
  warning: number
  info: number
  categories: Record<InsightCategory, number>
}

interface ApiResponse {
  insights: Insight[]
  summary: InsightSummary
  generatedAt: string
}

// Color utilities
const SEVERITY_COLORS: Record<InsightSeverity, { bg: string; badge: string; icon: string }> = {
  CRITICAL: {
    bg: 'bg-red-50 border-red-200',
    badge: 'bg-red-100 text-red-700 border-red-300',
    icon: '🔴',
  },
  WARNING: {
    bg: 'bg-amber-50 border-amber-200',
    badge: 'bg-amber-100 text-amber-700 border-amber-300',
    icon: '🟡',
  },
  INFO: {
    bg: 'bg-blue-50 border-blue-200',
    badge: 'bg-blue-100 text-blue-700 border-blue-300',
    icon: '🔵',
  },
}

const CATEGORY_COLORS: Record<InsightCategory, string> = {
  MARGIN: 'bg-purple-100 text-purple-700',
  AR: 'bg-red-100 text-red-700',
  INVENTORY: 'bg-orange-100 text-orange-700',
  SALES: 'bg-green-100 text-green-700',
  GROWTH: 'bg-emerald-100 text-emerald-700',
  COLLECTION: 'bg-rose-100 text-rose-700',
}

const CATEGORY_LABELS: Record<InsightCategory, string> = {
  MARGIN: 'Margin Alert',
  AR: 'AR Risk',
  INVENTORY: 'Inventory',
  SALES: 'Sales',
  GROWTH: 'Growth',
  COLLECTION: 'Collections',
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [summary, setSummary] = useState<InsightSummary>({
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
    categories: { MARGIN: 0, AR: 0, INVENTORY: 0, SALES: 0, GROWTH: 0, COLLECTION: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<InsightCategory | 'ALL'>('ALL')
  const [filterSeverity, setFilterSeverity] = useState<InsightSeverity | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const fetchInsights = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/ops/ai/insights')
      if (!res.ok) throw new Error('Failed to fetch insights')
      const data: ApiResponse = await res.json()
      setInsights(data.insights)
      setSummary(data.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInsights()
    // Refresh every 5 minutes
    const interval = setInterval(fetchInsights, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchInsights])

  const handleDismiss = async (insightId: string) => {
    try {
      const res = await fetch('/api/ops/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId, action: 'dismiss' }),
      })
      if (res.ok) {
        setDismissedIds((prev) => new Set(prev).add(insightId))
      }
    } catch (err) {
      console.error('Error dismissing insight:', err)
    }
  }

  // Filter insights
  const filtered = insights.filter((insight) => {
    if (dismissedIds.has(insight.id)) return false
    if (filterCategory !== 'ALL' && insight.category !== filterCategory) return false
    if (filterSeverity !== 'ALL' && insight.severity !== filterSeverity) return false
    if (
      searchQuery &&
      !insight.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !insight.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !(insight.entityLabel && insight.entityLabel.toLowerCase().includes(searchQuery.toLowerCase()))
    ) {
      return false
    }
    return true
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-8 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-semibold text-brand">
            AI Insights
          </h1>
          <p className="text-slate-600 mt-1">Intelligence from autonomous scans</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {/* Critical */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition">
            <p className="text-slate-600 text-sm font-medium">Critical</p>
            <p className="text-3xl font-semibold text-red-600 mt-2">{summary.critical}</p>
            <p className="text-xs text-slate-500 mt-1">Immediate action</p>
          </div>

          {/* Warning */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition">
            <p className="text-slate-600 text-sm font-medium">Warning</p>
            <p className="text-3xl font-semibold text-signal mt-2">
              {summary.warning}
            </p>
            <p className="text-xs text-slate-500 mt-1">Attention needed</p>
          </div>

          {/* Info */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition">
            <p className="text-slate-600 text-sm font-medium">Info</p>
            <p className="text-3xl font-semibold text-blue-600 mt-2">{summary.info}</p>
            <p className="text-xs text-slate-500 mt-1">FYI</p>
          </div>

          {/* Total */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition">
            <p className="text-slate-600 text-sm font-medium">Total</p>
            <p className="text-3xl font-semibold text-slate-800 mt-2">{summary.total}</p>
            <p className="text-xs text-slate-500 mt-1">Active insights</p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 mb-8 shadow-sm">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Category Filter */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">Category</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as InsightCategory | 'ALL')}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">All categories</option>
                <option value="MARGIN">Margin Alerts</option>
                <option value="AR">AR Risk</option>
                <option value="INVENTORY">Inventory</option>
                <option value="SALES">Sales</option>
                <option value="GROWTH">Growth</option>
                <option value="COLLECTION">Collections</option>
              </select>
            </div>

            {/* Severity Filter */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">Severity</label>
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value as InsightSeverity | 'ALL')}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">All severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </select>
            </div>

            {/* Search */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">Search</label>
              <input
                type="text"
                placeholder="Search insights..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-600">Loading insights...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            <p className="font-medium">Error loading insights</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
            <EmptyState
              icon={<Sparkles className="w-8 h-8 text-fg-subtle" />}
              title="No insights yet"
              description="Insights update every 5 minutes from autonomous scans."
              action={{ label: 'Refresh', onClick: fetchInsights }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((insight) => {
              const colors = SEVERITY_COLORS[insight.severity]
              const categoryColor = CATEGORY_COLORS[insight.category]
              const entityLink =
                insight.entityId && insight.entityType === 'builder'
                  ? `/admin/builders/${insight.entityId}`
                  : insight.entityId && insight.entityType === 'product'
                    ? `/admin/products/${insight.entityId}`
                    : null

              return (
                <div
                  key={insight.id}
                  className={`rounded-lg border p-4 shadow-sm hover:shadow-md transition bg-white ${colors.bg}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {/* Header: Icon, Title, Category Pill, Severity Badge */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xl">{colors.icon}</span>
                        <h3 className="font-semibold text-slate-900">{insight.title}</h3>
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${categoryColor}`}>
                          {CATEGORY_LABELS[insight.category]}
                        </span>
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium border ${colors.badge}`}>
                          {insight.severity}
                        </span>
                      </div>

                      {/* Description */}
                      <p className="text-slate-700 text-sm mb-3">{insight.description}</p>

                      {/* Impact + Entity Link + Source + Timestamp */}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                        <div className="font-semibold text-signal">
                          {insight.impact}
                        </div>

                        {entityLink && insight.entityLabel ? (
                          <Link
                            href={entityLink}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            {insight.entityLabel}
                          </Link>
                        ) : insight.entityLabel ? (
                          <span className="text-slate-700 font-medium">{insight.entityLabel}</span>
                        ) : null}

                        <span className="text-slate-500">Source: {insight.source}</span>
                        <span className="text-slate-500">{formatDate(insight.createdAt)}</span>
                      </div>
                    </div>

                    {/* Dismiss Button */}
                    <button
                      onClick={() => handleDismiss(insight.id)}
                      className="px-3 py-1 rounded text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition flex-shrink-0"
                      title="Dismiss this insight"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
