'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import AICopilot from '@/app/ops/components/AICopilot'

interface OperatorBriefing {
  timestamp: string
  dailySummary: {
    paymentsToday: number
    paymentsThisMonth: number
    newOrdersToday: number
    newOrderValueToday: number
    overdueInvoices: number
    overdueAmount: number
    deliveriesToday: {
      scheduledToday: number
      completedToday: number
      inTransit: number
    }
    tasksCompleted: number
    pendingApprovals: number
  }
  actionQueue: {
    total: number
    high: number
    medium: number
    low: number
    items: Array<{ id: string; priority: string; type: string }>
  }
  agentFleet: {
    total: number
    active: number
    idle: number
    offline: number
    agents: Array<{
      role: string
      status: string
      currentTask: string | null
      lastActivity: string | null
      tasksCompleted: number
      errors: number
    }>
  }
  recommendations: Array<{
    id: string
    type: string
    title: string
    description: string
    impact: string
    priority: string
  }>
  recentActivity: Array<{
    id: string
    agentRole: string
    taskType: string
    title: string
    status: string
    completedAt: string
  }>
}

const COLORS = {
  navy: '#3E2A1E',
  walnut: '#3E2A1E',
  amber: '#C9822B',
  green: '#27AE60',
  cream: '#F3EAD8',
  red: '#E74C3C',
  gray: '#6b7280',
  lightGray: '#f3f4f6',
}

const AGENT_EMOJIS: Record<string, string> = {
  SALES: '💼',
  MARKETING: '📢',
  OPS: '⚙️',
  CUSTOMER_SUCCESS: '🤝',
  COORDINATOR: '🎯',
  INTEL: '🧠',
}

const CATEGORY_ICONS: Record<string, string> = {
  FOLLOW_UP: '📧',
  REORDER: '📦',
  PRICING: '💰',
  COLLECTION: '💵',
  OUTREACH: '🤝',
  SCHEDULE: '📅',
}

export default function AIOperatorPage() {
  const [briefing, setBriefing] = useState<OperatorBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('')
  const [sortBy, setSortBy] = useState('impact') // 'impact' or 'confidence'
  const [approvedActions, setApprovedActions] = useState<Set<string>>(new Set())
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set())
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchBriefing = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/ai/operator')
      if (res.ok) {
        const data = await res.json()
        setBriefing(data.briefing)
      }
    } catch (error) {
      console.error('Failed to fetch operator briefing:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBriefing()
    // Auto-refresh every 60 seconds
    pollingRef.current = setInterval(fetchBriefing, 60000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [fetchBriefing])

  const handleApprove = async (actionId: string) => {
    setApprovedActions(prev => new Set([...prev, actionId]))
    // In production: POST to /api/ops/ai/recommendations/{actionId}/approve
  }

  const handleDismiss = (actionId: string) => {
    setDismissedActions(prev => new Set([...prev, actionId]))
  }

  const formatCurrency = (amount: number) => {
    return '$' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const filteredRecommendations = briefing?.recommendations.filter(
    r => !filterCategory || r.type === filterCategory
  ) || []

  const sortedRecommendations = [...filteredRecommendations].sort((a, b) => {
    if (sortBy === 'impact') {
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      return (priorityOrder[a.priority as keyof typeof priorityOrder] || 999) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] || 999)
    }
    return 0
  })

  const visibleRecommendations = sortedRecommendations.filter(
    r => !approvedActions.has(r.id) && !dismissedActions.has(r.id)
  )

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto' }}>
        <div style={{ fontSize: '16px', color: COLORS.gray }}>Loading AI Operator Dashboard...</div>
      </div>
    )
  }

  if (!briefing) {
    return (
      <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto' }}>
        <div style={{ fontSize: '16px', color: COLORS.red }}>Failed to load operator briefing</div>
      </div>
    )
  }

  const briefTime = new Date(briefing.timestamp)
  const briefDate = briefTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', background: COLORS.lightGray, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '700', color: COLORS.navy, margin: 0 }}>
            Good morning, Nate
          </h1>
          <button
            onClick={fetchBriefing}
            style={{
              padding: '8px 16px',
              background: COLORS.navy,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
            }}
          >
            ↻ Refresh
          </button>
        </div>
        <p style={{ fontSize: '14px', color: COLORS.gray, margin: '0' }}>
          {briefDate} • AI Operations Dashboard
        </p>
      </div>

      {/* Morning Briefing Panel */}
      <div style={{
        background: 'white',
        border: `2px solid ${COLORS.amber}`,
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.navy, margin: '0 0 16px' }}>
          📋 What needs your attention
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {/* Revenue */}
          <div style={{ background: COLORS.lightGray, padding: '16px', borderRadius: '8px', borderLeft: `4px solid ${COLORS.green}` }}>
            <div style={{ fontSize: '12px', color: COLORS.gray, fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>
              💰 Revenue Today
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: COLORS.green }}>
              {formatCurrency(briefing.dailySummary.paymentsToday)}
            </div>
            <div style={{ fontSize: '12px', color: COLORS.gray, marginTop: '6px' }}>
              {briefing.dailySummary.newOrdersToday} new orders
            </div>
          </div>

          {/* Collections */}
          {briefing.dailySummary.overdueInvoices > 0 && (
            <div style={{ background: COLORS.lightGray, padding: '16px', borderRadius: '8px', borderLeft: `4px solid ${COLORS.red}` }}>
              <div style={{ fontSize: '12px', color: COLORS.gray, fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>
                ⚠️ Overdue Invoices
              </div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: COLORS.red }}>
                {briefing.dailySummary.overdueInvoices}
              </div>
              <div style={{ fontSize: '12px', color: COLORS.gray, marginTop: '6px' }}>
                {formatCurrency(briefing.dailySummary.overdueAmount)} outstanding
              </div>
            </div>
          )}

          {/* Deliveries */}
          <div style={{ background: COLORS.lightGray, padding: '16px', borderRadius: '8px', borderLeft: `4px solid ${COLORS.amber}` }}>
            <div style={{ fontSize: '12px', color: COLORS.gray, fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>
              🚚 Deliveries Today
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: COLORS.amber }}>
              {briefing.dailySummary.deliveriesToday.completedToday}/{briefing.dailySummary.deliveriesToday.scheduledToday}
            </div>
            <div style={{ fontSize: '12px', color: COLORS.gray, marginTop: '6px' }}>
              {briefing.dailySummary.deliveriesToday.inTransit} in transit
            </div>
          </div>

          {/* Pending Approvals */}
          {briefing.dailySummary.pendingApprovals > 0 && (
            <div style={{ background: COLORS.lightGray, padding: '16px', borderRadius: '8px', borderLeft: `4px solid ${COLORS.amber}` }}>
              <div style={{ fontSize: '12px', color: COLORS.gray, fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>
                ✅ Actions Pending Approval
              </div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: COLORS.amber }}>
                {briefing.dailySummary.pendingApprovals}
              </div>
              <div style={{ fontSize: '12px', color: COLORS.gray, marginTop: '6px' }}>
                Awaiting your decision
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Grid: Action Queue (60%) + Agent Fleet (40%) */}
      <div style={{ display: 'grid', gridTemplateColumns: '60% 40%', gap: '24px', marginBottom: '24px' }}>
        {/* Action Queue */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.navy, margin: 0 }}>
              🎯 AI Recommendations ({visibleRecommendations.length})
            </h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${COLORS.lightGray}`,
                  fontSize: '12px',
                  background: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="">All Categories</option>
                <option value="FOLLOW_UP">Follow-ups</option>
                <option value="REORDER">Reorders</option>
                <option value="PRICING">Pricing</option>
                <option value="COLLECTION">Collections</option>
                <option value="OUTREACH">Outreach</option>
                <option value="SCHEDULE">Scheduling</option>
              </select>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${COLORS.lightGray}`,
                  fontSize: '12px',
                  background: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="impact">Sort: Impact</option>
                <option value="confidence">Sort: Confidence</option>
              </select>
            </div>
          </div>

          {visibleRecommendations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.gray }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>✨</div>
              <p style={{ fontSize: '14px', margin: 0 }}>All caught up! No pending recommendations.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '12px' }}>
              {visibleRecommendations.map(rec => {
                const priorityColor = rec.priority === 'HIGH' ? '#E74C3C' : rec.priority === 'MEDIUM' ? COLORS.amber : '#3498DB'
                const isApproved = approvedActions.has(rec.id)

                return (
                  <div
                    key={rec.id}
                    style={{
                      background: COLORS.lightGray,
                      border: `1px solid #e5e7eb`,
                      borderRadius: '10px',
                      padding: '16px',
                      marginBottom: '12px',
                      transition: 'all 0.2s',
                      opacity: isApproved ? 0.7 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '20px', marginTop: '4px' }}>
                        {CATEGORY_ICONS[rec.type] || '💡'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <span style={{
                            background: priorityColor,
                            color: 'white',
                            padding: '2px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                          }}>
                            {rec.priority}
                          </span>
                          <h3 style={{ fontSize: '14px', fontWeight: '600', color: COLORS.navy, margin: 0 }}>
                            {rec.title}
                          </h3>
                        </div>
                        <p style={{ fontSize: '13px', color: COLORS.gray, margin: '4px 0' }}>
                          {rec.description}
                        </p>
                        <p style={{ fontSize: '12px', color: '#666', fontWeight: '500', margin: '6px 0 0' }}>
                          Impact: {rec.impact}
                        </p>
                      </div>
                      {!isApproved && (
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <button
                            onClick={() => handleApprove(rec.id)}
                            style={{
                              padding: '6px 14px',
                              background: COLORS.green,
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => handleDismiss(rec.id)}
                            style={{
                              padding: '6px 14px',
                              background: '#f3f4f6',
                              color: COLORS.gray,
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            ✕ Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Agent Fleet Status */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.navy, margin: '0 0 16px' }}>
            🤖 Agent Fleet
          </h2>

          {/* Status Summary */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginBottom: '16px',
          }}>
            <div style={{
              background: '#E8F5E9',
              padding: '12px',
              borderRadius: '8px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: COLORS.green }}>
                {briefing.agentFleet.active}
              </div>
              <div style={{ fontSize: '11px', color: COLORS.gray, marginTop: '4px' }}>Active</div>
            </div>
            <div style={{
              background: '#FFF3E0',
              padding: '12px',
              borderRadius: '8px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: COLORS.amber }}>
                {briefing.agentFleet.idle}
              </div>
              <div style={{ fontSize: '11px', color: COLORS.gray, marginTop: '4px' }}>Idle</div>
            </div>
          </div>

          {/* Agent Cards */}
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
            {briefing.agentFleet.agents.map(agent => {
              const statusColor = agent.status === 'ONLINE' ? COLORS.green : agent.status === 'IDLE' ? COLORS.amber : '#ccc'
              return (
                <div
                  key={agent.role}
                  style={{
                    background: COLORS.lightGray,
                    padding: '12px',
                    borderRadius: '8px',
                    marginBottom: '10px',
                    borderLeft: `4px solid ${statusColor}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: COLORS.navy }}>
                      {AGENT_EMOJIS[agent.role] || '🤖'} {agent.role}
                    </div>
                    <span style={{
                      background: statusColor,
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: '600',
                    }}>
                      {agent.status}
                    </span>
                  </div>
                  {agent.currentTask && (
                    <div style={{ fontSize: '12px', color: COLORS.gray, marginBottom: '6px' }}>
                      📌 {agent.currentTask}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                    <div>
                      <span style={{ color: COLORS.green, fontWeight: '600' }}>
                        {agent.tasksCompleted}
                      </span>
                      <span style={{ color: COLORS.gray }}> done</span>
                    </div>
                    <div>
                      <span style={{ color: agent.errors > 0 ? COLORS.red : COLORS.gray, fontWeight: agent.errors > 0 ? '600' : '400' }}>
                        {agent.errors}
                      </span>
                      <span style={{ color: COLORS.gray }}> errors</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: '#999', marginTop: '6px' }}>
                    Last activity: {formatDate(agent.lastActivity || '')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Intelligence Feed */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        marginBottom: '24px',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.navy, margin: '0 0 16px' }}>
          📊 Intelligence Feed
        </h2>

        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {briefing.recentActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.gray }}>
              <p style={{ fontSize: '14px', margin: 0 }}>No recent agent activity</p>
            </div>
          ) : (
            briefing.recentActivity.map((activity, idx) => (
              <div
                key={activity.id}
                style={{
                  paddingBottom: '12px',
                  marginBottom: '12px',
                  borderBottom: idx < briefing.recentActivity.length - 1 ? `1px solid ${COLORS.lightGray}` : 'none',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ fontSize: '18px', flexShrink: 0 }}>
                  {AGENT_EMOJIS[activity.agentRole] || '🤖'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: COLORS.navy }}>
                    {activity.taskType}
                  </div>
                  <div style={{ fontSize: '12px', color: COLORS.gray, marginTop: '2px' }}>
                    {activity.title}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#999',
                    marginTop: '4px',
                    display: 'flex',
                    gap: '8px',
                  }}>
                    <span style={{ fontWeight: '500' }}>
                      {activity.status === 'COMPLETED' ? '✅' : '⏳'} {activity.status}
                    </span>
                    <span>•</span>
                    <span>{formatDate(activity.completedAt)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* AI Chat Copilot (floating) */}
      <AICopilot />
    </div>
  )
}
