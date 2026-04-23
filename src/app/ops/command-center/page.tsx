'use client'

import { useEffect, useState, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

const NAVY = '#0f2a3e'
const ORANGE = '#C6A24E'

interface AgentSession {
  agentRole: string
  status: string
  currentTaskId: string | null
  currentTaskTitle: string | null
  currentTaskType: string | null
  lastHeartbeat: string | null
  tasksCompletedToday: number
  tasksFailedToday: number
  errorsToday: number
  unreadMessages: number
  isStale: boolean
}

interface AgentTask {
  id: string
  agentRole: string
  taskType: string
  title: string
  priority: string
  status: string
  createdBy: string
  createdAt: string
  completedAt?: string
  failedAt?: string
  failReason?: string
  result?: any
}

interface TaskQueueSummary {
  summary: { status: string; count: number }[]
  pendingByPriority: { priority: string; count: number }[]
  awaitingApproval: AgentTask[]
  awaitingApprovalCount: number
  totalCompletedToday: number
}

interface StatusData {
  agents: AgentSession[]
  taskQueue: TaskQueueSummary
  recentActivity: {
    completed: AgentTask[]
    failures: AgentTask[]
  }
  serverTime: string
}

interface DailyBrief {
  revenue: { paymentsToday: number; paymentsThisMonth: number; newOrdersToday: number; newOrderValueToday: number }
  collections: { totalOverdue: number; totalOverdueAmount: number; critical60Plus: number }
  operations: { deliveriesToday: { scheduledToday: number; completedToday: number; inTransit: number } }
  sales: { stalledDealCount: number; stalledDealValue: number }
  customerHealth: { atRiskCount: number }
  pendingApprovalCount: number
}

const AGENT_LABELS: Record<string, { name: string; emoji: string; color: string }> = {
  COORDINATOR: { name: 'Coordinator', emoji: '🎯', color: '#8E44AD' },
  SALES: { name: 'Sales Agent', emoji: '💼', color: '#27AE60' },
  MARKETING: { name: 'Marketing & SEO', emoji: '📢', color: '#C6A24E' },
  OPS: { name: 'Operations', emoji: '⚙️', color: '#2980B9' },
  CUSTOMER_SUCCESS: { name: 'Customer Success', emoji: '🤝', color: '#16A085' },
  INTEL: { name: 'Intelligence', emoji: '🧠', color: '#C0392B' },
}

const STATUS_COLORS: Record<string, string> = {
  ONLINE: '#27AE60',
  BUSY: '#C6A24E',
  IDLE: '#3498DB',
  OFFLINE: '#95A5A6',
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: '#E74C3C',
  HIGH: '#C6A24E',
  NORMAL: '#3498DB',
  LOW: '#95A5A6',
}

export default function CommandCenterPage() {
  const { addToast } = useToast()
  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [brief, setBrief] = useState<DailyBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'approvals' | 'activity'>('overview')
  const [taskFilter, setTaskFilter] = useState({ status: '', role: '', priority: '' })
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [tasksTotal, setTasksTotal] = useState(0)
  const [taskPage, setTaskPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-hub/status')
      if (res.ok) {
        const data = await res.json()
        setStatusData(data)
      }
    } catch (err) { console.error('Failed to fetch status:', err) }
  }, [])

  const fetchBrief = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-hub/context/daily-brief')
      if (res.ok) {
        const data = await res.json()
        setBrief(data)
      }
    } catch (err) { console.error('Failed to fetch brief:', err) }
  }, [])

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(taskPage), limit: '20' })
      if (taskFilter.status) params.set('status', taskFilter.status)
      if (taskFilter.role) params.set('role', taskFilter.role)
      if (taskFilter.priority) params.set('priority', taskFilter.priority)
      const res = await fetch(`/api/agent-hub/tasks?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTasks(data.data || [])
        setTasksTotal(data.pagination?.total || 0)
      }
    } catch (err) { console.error('Failed to fetch tasks:', err) }
  }, [taskPage, taskFilter])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchStatus(), fetchBrief()])
    setLoading(false)
    setLastRefresh(new Date())
  }, [fetchStatus, fetchBrief])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { if (activeTab === 'tasks') fetchTasks() }, [activeTab, fetchTasks])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus()
      setLastRefresh(new Date())
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleApprove = async (taskId: string) => {
    try {
      const res = await fetch(`/api/agent-hub/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', approvedBy: 'ADMIN' })
      })
      if (res.ok) {
        fetchStatus()
      }
    } catch (err) { console.error('Failed to approve:', err) }
  }

  const handleCancel = async (taskId: string) => {
    try {
      const res = await fetch(`/api/agent-hub/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      })
      if (res.ok) {
        fetchStatus()
        if (activeTab === 'tasks') fetchTasks()
      }
    } catch (err) { console.error('Failed to cancel:', err) }
  }

  const handleRefreshIntel = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/agent-hub/intelligence/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      if (res.ok) {
        const data = await res.json()
        addToast({ type: 'success', title: 'Refresh Complete', message: `Intelligence refresh complete: ${data.successes}/${data.processed} builders updated` })
      }
    } catch (err) { console.error('Failed to refresh:', err) }
    setRefreshing(false)
  }

  const formatCurrency = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const formatTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Never'

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <div style={{ width: 220, background: NAVY, padding: '20px 0' }} />
        <div style={{ flex: 1, padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 18, color: '#666' }}>Loading Command Center...</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f6fa' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: NAVY, padding: '20px 0', color: 'white', flexShrink: 0 }}>
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>🎛️ Command</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Center</div>
        </div>
        <nav style={{ padding: '12px 0' }}>
          {[
            { key: 'overview', label: '📊 Overview' },
            { key: 'tasks', label: '📋 Task Queue' },
            { key: 'approvals', label: '✅ Approvals' },
            { key: 'activity', label: '📜 Activity Log' },
          ].map(item => (
            <div
              key={item.key}
              onClick={() => setActiveTab(item.key as any)}
              style={{
                padding: '10px 20px', cursor: 'pointer', fontSize: 14,
                background: activeTab === item.key ? 'rgba(255,255,255,0.1)' : 'transparent',
                borderLeft: activeTab === item.key ? `3px solid ${ORANGE}` : '3px solid transparent',
              }}
            >
              {item.label}
            </div>
          ))}
        </nav>
        <div style={{ padding: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 'auto' }}>
          <div style={{ fontSize: 11, opacity: 0.5 }}>Last refresh</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{lastRefresh.toLocaleTimeString()}</div>
          <button
            onClick={loadAll}
            style={{
              marginTop: 8, padding: '6px 12px', background: ORANGE, color: 'white',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, width: '100%'
            }}
          >
            Refresh Now
          </button>
        </div>
        {/* Nav links to other ops pages */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8 }}>OPS PORTAL</div>
          {[
            { href: '/ops', label: 'Dashboard' },
            { href: '/ops/orders', label: 'Orders' },
            { href: '/ops/collections', label: 'Collections' },
            { href: '/ops/schedule', label: 'Schedule' },
            { href: '/ops/delivery', label: 'Delivery' },
          ].map(link => (
            <a key={link.href} href={link.href} style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, padding: '4px 0', textDecoration: 'none' }}>
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, margin: 0 }}>Abel AI Command Center</h1>
            <p style={{ color: '#666', margin: '4px 0 0', fontSize: 14 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button
            onClick={handleRefreshIntel}
            disabled={refreshing}
            style={{
              padding: '8px 16px', background: refreshing ? '#ccc' : NAVY, color: 'white',
              border: 'none', borderRadius: 6, cursor: refreshing ? 'default' : 'pointer', fontSize: 13
            }}
          >
            {refreshing ? 'Refreshing...' : '🧠 Refresh Intelligence'}
          </button>
        </div>

        {activeTab === 'overview' && (
          <>
            {/* KPI Cards */}
            {brief && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
                {[
                  { label: 'Payments Today', value: formatCurrency(brief.revenue.paymentsToday), color: '#27AE60' },
                  { label: 'New Orders Today', value: brief.revenue.newOrdersToday.toString(), sub: formatCurrency(brief.revenue.newOrderValueToday), color: '#2980B9' },
                  { label: 'Overdue Invoices', value: brief.collections.totalOverdue.toString(), sub: formatCurrency(brief.collections.totalOverdueAmount), color: '#E74C3C' },
                  { label: 'Deliveries Today', value: brief.operations.deliveriesToday.scheduledToday.toString(), sub: `${brief.operations.deliveriesToday.completedToday} completed`, color: '#8E44AD' },
                  { label: 'Stalled Deals', value: brief.sales.stalledDealCount.toString(), sub: formatCurrency(brief.sales.stalledDealValue), color: '#C6A24E' },
                  { label: 'At-Risk Builders', value: brief.customerHealth.atRiskCount.toString(), color: '#C0392B' },
                  { label: 'Tasks Completed', value: String(statusData?.taskQueue.totalCompletedToday || 0), color: '#27AE60' },
                  { label: 'Pending Approvals', value: String(statusData?.taskQueue.awaitingApprovalCount || 0), color: brief.pendingApprovalCount > 0 ? '#E74C3C' : '#95A5A6' },
                ].map((card, i) => (
                  <div key={i} style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderTop: `3px solid ${card.color}` }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{card.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: NAVY }}>{card.value}</div>
                    {card.sub && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{card.sub}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Agent Status Cards */}
            <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Agent Fleet</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
              {(statusData?.agents || []).map(agent => {
                const info = AGENT_LABELS[agent.agentRole] || { name: agent.agentRole, emoji: '🤖', color: '#666' }
                return (
                  <div key={agent.agentRole} style={{
                    background: 'white', borderRadius: 8, padding: 16,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    borderLeft: `4px solid ${info.color}`,
                    opacity: agent.status === 'OFFLINE' ? 0.6 : 1,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{info.emoji} {info.name}</div>
                      <div style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: STATUS_COLORS[agent.status] || '#ccc', color: 'white',
                      }}>
                        {agent.status}
                      </div>
                    </div>
                    {agent.currentTaskTitle && (
                      <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>
                        📌 <strong>{agent.currentTaskType}</strong>: {agent.currentTaskTitle}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#27AE60' }}>{agent.tasksCompletedToday}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Done</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: agent.errorsToday > 0 ? '#E74C3C' : '#888' }}>{agent.errorsToday}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Errors</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: agent.unreadMessages > 0 ? '#C6A24E' : '#888' }}>{agent.unreadMessages}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Messages</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 8, textAlign: 'right' }}>
                      Last heartbeat: {formatTime(agent.lastHeartbeat)}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Approvals Queue (inline preview) */}
            {(statusData?.taskQueue.awaitingApproval || []).length > 0 && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 12 }}>⚡ Pending Approvals</h2>
                <div style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 24 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #eee' }}>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#888' }}>Agent</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#888' }}>Task</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#888' }}>Priority</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#888' }}>Created</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 12, color: '#888' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusData!.taskQueue.awaitingApproval.map(task => (
                        <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '8px 12px', fontSize: 13 }}>{AGENT_LABELS[task.agentRole]?.emoji} {AGENT_LABELS[task.agentRole]?.name || task.agentRole}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13 }}>
                            <strong>{task.taskType}</strong><br />
                            <span style={{ color: '#666' }}>{task.title}</span>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: PRIORITY_COLORS[task.priority] || '#ccc', color: 'white' }}>
                              {task.priority}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: '#888' }}>{new Date(task.createdAt).toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <button onClick={() => handleApprove(task.id)} style={{ padding: '4px 12px', background: '#27AE60', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 }}>Approve</button>
                            <button onClick={() => handleCancel(task.id)} style={{ padding: '4px 12px', background: '#E74C3C', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Reject</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Recent Activity */}
            <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Recent Activity</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Completed */}
              <div style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#27AE60', marginBottom: 12, margin: '0 0 12px' }}>✅ Completed</h3>
                {(statusData?.recentActivity.completed || []).length === 0 ? (
                  <div style={{ color: '#888', fontSize: 13 }}>No completed tasks yet today</div>
                ) : (
                  (statusData?.recentActivity.completed || []).slice(0, 8).map(task => (
                    <div key={task.id} style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
                      <span style={{ color: '#888', marginRight: 6 }}>{AGENT_LABELS[task.agentRole]?.emoji}</span>
                      <strong>{task.taskType}</strong>: {task.title}
                      <span style={{ float: 'right', fontSize: 11, color: '#aaa' }}>{task.completedAt ? formatTime(task.completedAt) : ''}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Failures */}
              <div style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#E74C3C', marginBottom: 12, margin: '0 0 12px' }}>❌ Failures</h3>
                {(statusData?.recentActivity.failures || []).length === 0 ? (
                  <div style={{ color: '#888', fontSize: 13 }}>No failures today — clean run!</div>
                ) : (
                  (statusData?.recentActivity.failures || []).slice(0, 8).map(task => (
                    <div key={task.id} style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
                      <span style={{ color: '#888', marginRight: 6 }}>{AGENT_LABELS[task.agentRole]?.emoji}</span>
                      <strong>{task.taskType}</strong>: {task.title}
                      {task.failReason && <div style={{ fontSize: 11, color: '#E74C3C', marginTop: 2 }}>{task.failReason}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'tasks' && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Task Queue</h2>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <select value={taskFilter.status} onChange={e => { setTaskFilter(f => ({ ...f, status: e.target.value })); setTaskPage(1) }}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 13 }}>
                <option value="">All Statuses</option>
                {['PENDING', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={taskFilter.role} onChange={e => { setTaskFilter(f => ({ ...f, role: e.target.value })); setTaskPage(1) }}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 13 }}>
                <option value="">All Agents</option>
                {Object.keys(AGENT_LABELS).map(r => <option key={r} value={r}>{AGENT_LABELS[r].name}</option>)}
              </select>
              <select value={taskFilter.priority} onChange={e => { setTaskFilter(f => ({ ...f, priority: e.target.value })); setTaskPage(1) }}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 13 }}>
                <option value="">All Priorities</option>
                {['URGENT', 'HIGH', 'NORMAL', 'LOW'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div style={{ marginLeft: 'auto', fontSize: 13, color: '#888', lineHeight: '32px' }}>
                {tasksTotal} tasks
              </div>
            </div>

            {/* Task Table */}
            <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888' }}>Agent</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888' }}>Title</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 12, color: '#888' }}>Priority</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 12, color: '#888' }}>Status</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: '#888' }}>Created</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: '#888' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(task => (
                    <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>{AGENT_LABELS[task.agentRole]?.emoji} {AGENT_LABELS[task.agentRole]?.name || task.agentRole}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: '#555' }}>{task.taskType}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>{task.title}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: PRIORITY_COLORS[task.priority], color: 'white' }}>{task.priority}</span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: task.status === 'COMPLETED' ? '#27AE60' : task.status === 'FAILED' ? '#E74C3C' : task.status === 'IN_PROGRESS' ? '#3498DB' : '#95A5A6', color: 'white' }}>{task.status}</span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: '#888' }}>{new Date(task.createdAt).toLocaleString()}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {task.status === 'PENDING' && (
                          <button onClick={() => handleCancel(task.id)} style={{ padding: '3px 8px', background: '#E74C3C', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tasks.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No tasks match the current filters</td></tr>
                  )}
                </tbody>
              </table>
              {/* Task pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', fontSize: 13, color: '#6B7280' }}>
                <span>Page {taskPage} {tasksTotal > 0 && `of ${Math.ceil(tasksTotal / 20)}`} ({tasksTotal} total)</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setTaskPage(p => Math.max(1, p - 1))}
                    disabled={taskPage <= 1}
                    style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: taskPage <= 1 ? '#f3f4f6' : '#fff', cursor: taskPage <= 1 ? 'not-allowed' : 'pointer', opacity: taskPage <= 1 ? 0.5 : 1 }}
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setTaskPage(p => p + 1)}
                    disabled={taskPage >= Math.ceil(tasksTotal / 20)}
                    style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: taskPage >= Math.ceil(tasksTotal / 20) ? '#f3f4f6' : '#fff', cursor: taskPage >= Math.ceil(tasksTotal / 20) ? 'not-allowed' : 'pointer', opacity: taskPage >= Math.ceil(tasksTotal / 20) ? 0.5 : 1 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'approvals' && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Action Approval Queue</h2>
            <p style={{ color: '#666', fontSize: 14, marginBottom: 16 }}>High-stakes actions that need your approval before agents can execute them.</p>
            <div style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              {(statusData?.taskQueue.awaitingApproval || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                  <div style={{ fontSize: 16 }}>All clear — no pending approvals</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #eee' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888' }}>Agent</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888' }}>Task Type</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888' }}>Details</th>
                      <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 12, color: '#888' }}>Priority</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: '#888' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusData!.taskQueue.awaitingApproval.map(task => (
                      <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>{AGENT_LABELS[task.agentRole]?.emoji} {AGENT_LABELS[task.agentRole]?.name}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600 }}>{task.taskType}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#555' }}>{task.title}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: PRIORITY_COLORS[task.priority], color: 'white' }}>{task.priority}</span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button onClick={() => handleApprove(task.id)} style={{ padding: '6px 16px', background: '#27AE60', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, marginRight: 8 }}>✅ Approve</button>
                          <button onClick={() => handleCancel(task.id)} style={{ padding: '6px 16px', background: '#E74C3C', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>❌ Reject</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {activeTab === 'activity' && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Agent Activity Log</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#27AE60', margin: '0 0 12px' }}>✅ Recently Completed</h3>
                {(statusData?.recentActivity.completed || []).map(task => (
                  <div key={task.id} style={{ padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ marginRight: 6 }}>{AGENT_LABELS[task.agentRole]?.emoji}</span>
                      <strong>{task.taskType}</strong>: {task.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                      Completed at {task.completedAt ? new Date(task.completedAt).toLocaleString() : 'unknown'}
                    </div>
                  </div>
                ))}
                {(statusData?.recentActivity.completed || []).length === 0 && (
                  <div style={{ color: '#888', fontSize: 13 }}>No completed tasks yet</div>
                )}
              </div>
              <div style={{ background: 'white', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#E74C3C', margin: '0 0 12px' }}>❌ Failures Today</h3>
                {(statusData?.recentActivity.failures || []).map(task => (
                  <div key={task.id} style={{ padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ marginRight: 6 }}>{AGENT_LABELS[task.agentRole]?.emoji}</span>
                      <strong>{task.taskType}</strong>: {task.title}
                    </div>
                    {task.failReason && (
                      <div style={{ fontSize: 12, color: '#E74C3C', marginTop: 2, background: '#FDE8E8', padding: '4px 8px', borderRadius: 4 }}>
                        {task.failReason}
                      </div>
                    )}
                  </div>
                ))}
                {(statusData?.recentActivity.failures || []).length === 0 && (
                  <div style={{ color: '#888', fontSize: 13 }}>No failures today</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
