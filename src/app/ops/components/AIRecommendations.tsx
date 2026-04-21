'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Recommendation {
  id: string
  type: 'FOLLOW_UP' | 'REORDER' | 'PRICING' | 'COLLECTION' | 'OUTREACH' | 'SCHEDULE'
  title: string
  description: string
  impact: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  actionLabel: string
  actionUrl?: string
  data?: Record<string, any>
}

const PRIORITY_COLORS = {
  HIGH: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  MEDIUM: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  LOW: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
}

const TYPE_ICONS: Record<string, string> = {
  FOLLOW_UP: '📧',
  REORDER: '📦',
  PRICING: '💰',
  COLLECTION: '💵',
  OUTREACH: '🤝',
  SCHEDULE: '📅',
}

export function AIRecommendations() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchRecommendations()
  }, [])

  const fetchRecommendations = async () => {
    try {
      // Fetch from multiple sources in parallel
      const [quotesRes, inventoryRes, cashFlowRes] = await Promise.all([
        fetch('/api/ops/ai/predictive?report=dashboard').catch(() => null),
        fetch('/api/ops/inventory/intelligence?report=reorder-alerts').catch(() => null),
        fetch('/api/ops/cash-flow-optimizer/working-capital').catch(() => null),
      ])

      const recs: Recommendation[] = []

      // Process quote follow-up recommendations
      if (quotesRes?.ok) {
        try {
          const data = await quotesRes.json()
          const staleQuotes = data?.staleQuotes || data?.dashboard?.staleQuotes || []
          if (Array.isArray(staleQuotes)) {
            staleQuotes.slice(0, 3).forEach((q: any, i: number) => {
              recs.push({
                id: `quote-${q.id || i}`,
                type: 'FOLLOW_UP',
                title: `Follow up: ${q.builderName || q.companyName || 'Builder'}`,
                description: q.quoteNumber ? `Quote ${q.quoteNumber} sent ${q.daysSinceSent || '?'} days ago — no response` : 'Stale quote needs follow-up',
                impact: q.total ? `$${Number(q.total).toLocaleString()} at risk` : 'Revenue at risk',
                priority: 'HIGH',
                actionLabel: 'Send Follow-up',
                actionUrl: q.id ? `/ops/quotes/${q.id}` : '/ops/quotes',
              })
            })
          }
        } catch {}
      }

      // Process reorder recommendations
      if (inventoryRes?.ok) {
        try {
          const data = await inventoryRes.json()
          const alerts = data?.alerts || data || []
          if (Array.isArray(alerts)) {
            alerts.slice(0, 3).forEach((a: any, i: number) => {
              recs.push({
                id: `reorder-${a.id || i}`,
                type: 'REORDER',
                title: `Reorder: ${a.productName || a.name || 'Product'}`,
                description: `${a.quantityOnHand || a.onHand || 0} on hand, below reorder point of ${a.reorderPoint || '?'}`,
                impact: `${a.daysOfSupply || '?'} days of supply remaining`,
                priority: (a.quantityOnHand || a.onHand || 0) === 0 ? 'HIGH' : 'MEDIUM',
                actionLabel: 'Create PO',
                actionUrl: a.id ? `/ops/purchasing/new?product=${a.id}` : '/ops/purchasing',
              })
            })
          }
        } catch {}
      }

      // Process cash flow recommendations
      if (cashFlowRes?.ok) {
        try {
          const data = await cashFlowRes.json()
          const cfRecs = data?.recommendations || []
          if (Array.isArray(cfRecs)) {
            cfRecs.slice(0, 2).forEach((r: any, i: number) => {
              recs.push({
                id: `cf-${i}`,
                type: 'COLLECTION',
                title: r.title || 'Cash Flow Optimization',
                description: r.description?.slice(0, 120) || 'Improve working capital',
                impact: r.impact || 'Improve cash position',
                priority: r.priority === 'CRITICAL' ? 'HIGH' : r.priority === 'HIGH' ? 'MEDIUM' : 'LOW',
                actionLabel: 'Take Action',
                actionUrl: '/ops/cash-flow-optimizer',
              })
            })
          }
        } catch {}
      }

      // Sort by priority
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

      setRecommendations(recs)
    } catch (err) {
      console.error('Failed to fetch recommendations:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (rec: Recommendation) => {
    setApproving(rec.id)
    // Simulate approval action — in production this would call the actual API
    await new Promise(resolve => setTimeout(resolve, 800))
    setDismissed(prev => new Set([...prev, rec.id]))
    setApproving(null)
  }

  const handleDismiss = (id: string) => {
    setDismissed(prev => new Set([...prev, id]))
  }

  const visibleRecs = recommendations.filter(r => !dismissed.has(r.id))

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-gray-100 rounded-lg" />
        ))}
      </div>
    )
  }

  if (visibleRecs.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        <p className="text-2xl mb-2">✅</p>
        <p className="text-sm">All caught up! No pending recommendations.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {visibleRecs.slice(0, 5).map(rec => {
        const colors = PRIORITY_COLORS[rec.priority]
        const isApproving = approving === rec.id
        return (
          <div key={rec.id} className={`${colors.bg} ${colors.border} border rounded-lg p-4 transition-all hover:shadow-sm`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{TYPE_ICONS[rec.type] || '💡'}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>{rec.priority}</span>
                  <span className="text-sm font-semibold text-gray-900 truncate">{rec.title}</span>
                </div>
                <p className="text-xs text-gray-600 mb-1">{rec.description}</p>
                <p className="text-xs font-medium text-gray-500">{rec.impact}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {rec.actionUrl ? (
                  <Link
                    href={rec.actionUrl}
                    className="px-3 py-1.5 text-xs font-semibold bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors whitespace-nowrap"
                  >
                    {rec.actionLabel} →
                  </Link>
                ) : (
                  <button
                    onClick={() => handleApprove(rec)}
                    disabled={isApproving}
                    className="px-3 py-1.5 text-xs font-semibold bg-[#27AE60] text-white rounded-lg hover:bg-[#1E8449] transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {isApproving ? '...' : `✓ ${rec.actionLabel}`}
                  </button>
                )}
                <button
                  onClick={() => handleDismiss(rec.id)}
                  className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
