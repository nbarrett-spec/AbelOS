/**
 * Agent Workflows Dashboard
 * 'use client' ops page showing workflow status and quick actions
 */

'use client'

import { useEffect, useState } from 'react'
import { checkStaffAuth } from '@/lib/api-auth'

interface AgentAction {
  id: string
  type: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
  input: Record<string, any>
  output?: Record<string, any>
  error?: string
  executedAt?: string
}

interface AgentWorkflow {
  id: string
  name: string
  triggeredBy: string
  builderId: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED'
  actions: AgentAction[]
  createdAt: string
  completedAt?: string
}

export default function AgentWorkflowsPage() {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    active: 0,
    completedToday: 0,
    revenueGenerated: 0,
    successRate: 0,
  })
  const [selectedWorkflow, setSelectedWorkflow] = useState<AgentWorkflow | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const response = await fetch('/api/ops/agent/workflows')
        if (response.ok) {
          const data = await response.json()
          setWorkflows(data.workflows || [])

          // Calculate stats
          const active = data.workflows.filter((w: AgentWorkflow) => w.status === 'RUNNING').length
          const completedToday = data.workflows.filter((w: AgentWorkflow) => {
            const createdDate = new Date(w.createdAt).toDateString()
            return w.status === 'COMPLETED' && createdDate === new Date().toDateString()
          }).length
          const successful = data.workflows.filter((w: AgentWorkflow) => w.status === 'COMPLETED').length
          const total = data.workflows.length

          setStats({
            active,
            completedToday,
            revenueGenerated: completedToday * 500, // Placeholder estimate
            successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
          })
        }
      } catch (error) {
        console.error('Error fetching workflows:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchWorkflows()
    const interval = setInterval(fetchWorkflows, 30000) // Refresh every 30s

    return () => clearInterval(interval)
  }, [])

  const handlePause = async (workflowId: string) => {
    try {
      const response = await fetch(`/api/ops/agent/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      })

      if (response.ok) {
        const data = await response.json()
        setWorkflows(workflows.map((w) => (w.id === workflowId ? data.workflow : w)))
      }
    } catch (error) {
      console.error('Error pausing workflow:', error)
    }
  }

  const handleRunScan = async (scanType: string) => {
    try {
      const response = await fetch('/api/ops/agent/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: scanType,
          params: {},
        }),
      })

      if (response.ok) {
        // Refresh workflows
        const listResponse = await fetch('/api/ops/agent/workflows')
        if (listResponse.ok) {
          const data = await listResponse.json()
          setWorkflows(data.workflows || [])
        }
      }
    } catch (error) {
      console.error('Error running scan:', error)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return '#10B981' // Green
      case 'RUNNING':
        return '#F59E0B' // Amber
      case 'FAILED':
        return '#EF4444' // Red
      case 'PAUSED':
        return '#8B5CF6' // Purple
      default:
        return '#6B7280' // Gray
    }
  }

  const getWorkflowIcon = (type: string) => {
    switch (type) {
      case 'BLUEPRINT_UPLOAD':
        return '📐'
      case 'QUOTE_EXPIRING':
        return '⏰'
      case 'NEW_BUILDER':
        return '👤'
      case 'STALE_QUOTE':
        return '🔄'
      case 'REORDER_OPPORTUNITY':
        return '🛒'
      default:
        return '⚙️'
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <p>Loading workflows...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px', color: '#3E2A1E' }}>
          AI Agent Workflows
        </h1>
        <p style={{ color: '#6B7280', fontSize: '16px' }}>
          Monitor autonomous sales workflows and agent-driven opportunities
        </p>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        {[
          { label: 'Active Workflows', value: stats.active, icon: '▶️' },
          { label: 'Completed Today', value: stats.completedToday, icon: '✓' },
          { label: 'Revenue Generated', value: `$${stats.revenueGenerated.toLocaleString()}`, icon: '💰' },
          { label: 'Success Rate', value: `${stats.successRate}%`, icon: '📊' },
        ].map((stat, idx) => (
          <div
            key={idx}
            style={{
              background: 'white',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>{stat.icon}</div>
            <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '8px' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#3E2A1E' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div
        style={{
          background: 'white',
          border: '1px solid #E5E7EB',
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '32px',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#3E2A1E' }}>
          Quick Actions
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Run Stale Quote Scan', type: 'STALE_QUOTE_RECOVERY' },
            { label: 'Run Reorder Check', type: 'REORDER_OPPORTUNITY' },
            { label: 'Analyze Pending Blueprints', type: 'BLUEPRINT_TO_QUOTE' },
          ].map((action, idx) => (
            <button
              key={idx}
              onClick={() => handleRunScan(action.type)}
              style={{
                padding: '12px 16px',
                background: '#3E2A1E',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = '#143A52'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = '#3E2A1E'
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Workflows List */}
      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid #E5E7EB' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#3E2A1E', margin: '0' }}>
            Recent Workflows ({workflows.length})
          </h2>
        </div>

        {workflows.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>
            <p>No workflows found. Run a quick action to get started.</p>
          </div>
        ) : (
          <div>
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                style={{
                  borderBottom: '1px solid #E5E7EB',
                  padding: '16px 24px',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.background = '#F9FAFB'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.background = 'white'
                }}
              >
                {/* Workflow Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '20px' }}>{getWorkflowIcon(workflow.triggeredBy)}</span>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', color: '#1F2937', marginBottom: '4px' }}>
                      {workflow.name}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6B7280' }}>
                      Triggered by: {workflow.triggeredBy.replace(/_/g, ' ')}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        background: getStatusColor(workflow.status),
                        color: 'white',
                        fontSize: '12px',
                        fontWeight: '600',
                      }}
                    >
                      {workflow.status}
                    </div>

                    <div style={{ fontSize: '12px', color: '#6B7280' }}>
                      {workflow.actions.filter((a) => a.status === 'COMPLETED').length}/
                      {workflow.actions.length}
                    </div>

                    <button
                      onClick={() => setExpandedId(expandedId === workflow.id ? null : workflow.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '0',
                        fontSize: '20px',
                      }}
                    >
                      {expandedId === workflow.id ? '▼' : '▶'}
                    </button>
                  </div>
                </div>

                {/* Timeline / Action Details */}
                {expandedId === workflow.id && (
                  <div
                    style={{
                      marginTop: '16px',
                      paddingTop: '16px',
                      borderTop: '1px solid #E5E7EB',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>
                      Started: {new Date(workflow.createdAt).toLocaleString()}
                      {workflow.completedAt && ` • Completed: ${new Date(workflow.completedAt).toLocaleString()}`}
                    </div>

                    <div style={{ marginTop: '12px' }}>
                      {workflow.actions.map((action, idx) => (
                        <div
                          key={action.id}
                          style={{
                            display: 'flex',
                            gap: '12px',
                            marginBottom: '12px',
                            fontSize: '13px',
                          }}
                        >
                          <div
                            style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: getStatusColor(action.status),
                              color: 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              fontWeight: '600',
                              flexShrink: 0,
                            }}
                          >
                            {action.status === 'COMPLETED' ? '✓' : action.status === 'FAILED' ? '✕' : '•'}
                          </div>

                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '500', color: '#1F2937' }}>{action.type}</div>
                            {action.error && (
                              <div style={{ color: '#DC2626', marginTop: '4px' }}>Error: {action.error}</div>
                            )}
                            {action.output && Object.keys(action.output).length > 0 && (
                              <div style={{ color: '#059669', marginTop: '4px' }}>
                                ✓ {Object.entries(action.output)
                                  .map(([k, v]) => `${k}: ${JSON.stringify(v).substring(0, 20)}`)
                                  .join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {workflow.status === 'RUNNING' && (
                      <button
                        onClick={() => handlePause(workflow.id)}
                        style={{
                          marginTop: '12px',
                          padding: '8px 12px',
                          background: '#EF4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '500',
                        }}
                      >
                        Pause Workflow
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
