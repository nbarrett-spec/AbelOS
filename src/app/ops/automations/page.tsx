'use client'

import { useState, useEffect, useCallback } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Automations Management Page — /ops/automations
// Create, manage, and monitor automated workflow rules by role.
// ──────────────────────────────────────────────────────────────────────────

interface AutomationRule {
  id: string
  name: string
  description: string | null
  trigger: string
  conditions: any
  actions: any[]
  roles: string[]
  frequency: string
  enabled: boolean
  lastRunAt: string | null
  runCount: number
  createdAt: string
}

interface AutomationLog {
  id: string
  ruleId: string
  ruleName: string
  trigger: string
  status: string
  actionsRun: number
  details: any
  error: string | null
  executedAt: string
}

interface SystemAutomationRow {
  id: string
  key: string
  name: string
  description: string | null
  category: string
  enabled: boolean
  triggerStatus: string | null
  updatedAt: string | null
  updatedBy: string | null
}

// Pre-built trigger types the system supports
const TRIGGER_OPTIONS = [
  { value: 'ORDER_CREATED', label: 'New Order Created', category: 'Orders' },
  { value: 'ORDER_STATUS_CHANGED', label: 'Order Status Changed', category: 'Orders' },
  { value: 'ORDER_SHIPPED', label: 'Order Shipped', category: 'Orders' },
  { value: 'ORDER_DELIVERED', label: 'Order Delivered', category: 'Orders' },
  { value: 'QUOTE_CREATED', label: 'New Quote Created', category: 'Quotes' },
  { value: 'QUOTE_SENT', label: 'Quote Sent to Builder', category: 'Quotes' },
  { value: 'QUOTE_APPROVED', label: 'Quote Approved', category: 'Quotes' },
  { value: 'QUOTE_EXPIRED', label: 'Quote Expired', category: 'Quotes' },
  { value: 'INVOICE_CREATED', label: 'Invoice Created', category: 'Finance' },
  { value: 'INVOICE_OVERDUE', label: 'Invoice Overdue', category: 'Finance' },
  { value: 'PAYMENT_RECEIVED', label: 'Payment Received', category: 'Finance' },
  { value: 'INVENTORY_LOW', label: 'Inventory Below Reorder Point', category: 'Inventory' },
  { value: 'INVENTORY_OUT', label: 'Inventory Out of Stock', category: 'Inventory' },
  { value: 'PO_CREATED', label: 'Purchase Order Created', category: 'Purchasing' },
  { value: 'PO_APPROVED', label: 'PO Approved', category: 'Purchasing' },
  { value: 'PO_RECEIVED', label: 'PO Items Received', category: 'Purchasing' },
  { value: 'PO_OVERDUE', label: 'PO Past Expected Date', category: 'Purchasing' },
  { value: 'DELIVERY_SCHEDULED', label: 'Delivery Scheduled', category: 'Logistics' },
  { value: 'DELIVERY_COMPLETE', label: 'Delivery Completed', category: 'Logistics' },
  { value: 'JOB_STATUS_CHANGED', label: 'Job Status Changed', category: 'Jobs' },
  { value: 'DAILY_MORNING', label: 'Daily Morning (8 AM)', category: 'Scheduled' },
  { value: 'DAILY_EVENING', label: 'Daily Evening (5 PM)', category: 'Scheduled' },
  { value: 'WEEKLY_MONDAY', label: 'Weekly Monday Morning', category: 'Scheduled' },
  { value: 'MONTHLY_FIRST', label: 'Monthly First Business Day', category: 'Scheduled' },
]

// Pre-built action types
const ACTION_OPTIONS = [
  { value: 'SEND_NOTIFICATION', label: 'Send In-App Notification', icon: '🔔' },
  { value: 'SEND_EMAIL', label: 'Send Email Alert', icon: '📧' },
  { value: 'CREATE_TASK', label: 'Create Task / Action Item', icon: '✅' },
  { value: 'UPDATE_STATUS', label: 'Update Record Status', icon: '🔄' },
  { value: 'ASSIGN_TO_ROLE', label: 'Assign to Role/Person', icon: '👤' },
  { value: 'AI_ANALYZE', label: 'Run AI Analysis', icon: '🤖' },
  { value: 'AI_GENERATE_PO', label: 'AI: Generate Purchase Order', icon: '📦' },
  { value: 'AI_DEMAND_FORECAST', label: 'AI: Run Demand Forecast', icon: '📊' },
  { value: 'AI_DAILY_BRIEFING', label: 'AI: Generate Daily Briefing', icon: '📋' },
  { value: 'AI_REORDER_CHECK', label: 'AI: Check Reorder Needs', icon: '🔍' },
  { value: 'LOG_AUDIT', label: 'Log to Audit Trail', icon: '📝' },
  { value: 'WEBHOOK', label: 'Call External Webhook', icon: '🌐' },
]

const ROLE_OPTIONS = [
  'ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP',
  'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER',
  'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING',
]

const FREQUENCY_OPTIONS = [
  { value: 'ON_TRIGGER', label: 'Every Time Triggered' },
  { value: 'ONCE_DAILY', label: 'Once Per Day' },
  { value: 'ONCE_WEEKLY', label: 'Once Per Week' },
  { value: 'ONCE_PER_ENTITY', label: 'Once Per Entity' },
]

// ──────────────────────────────────────────────────────────────────────────
// Role-specific automation templates
// ──────────────────────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    name: 'PM: Daily Job Status Briefing',
    description: 'Every morning at 8 AM, AI generates a briefing of all active jobs, upcoming deliveries, and action items for the day.',
    trigger: 'DAILY_MORNING',
    roles: ['PROJECT_MANAGER', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_DAILY_BRIEFING', config: { scope: 'jobs,deliveries,quotes' } }, { type: 'SEND_NOTIFICATION', config: { title: 'Your Daily Briefing is Ready' } }],
    frequency: 'ONCE_DAILY',
    category: 'Project Management',
  },
  {
    name: 'Purchasing: Auto-Reorder Alert',
    description: 'When inventory drops below reorder point, AI analyzes best supplier and drafts a PO recommendation.',
    trigger: 'INVENTORY_LOW',
    roles: ['PURCHASING', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_REORDER_CHECK', config: {} }, { type: 'AI_GENERATE_PO', config: { autoApprove: false } }, { type: 'SEND_NOTIFICATION', config: { title: 'Reorder Recommendation Ready' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Purchasing',
  },
  {
    name: 'Purchasing: Weekly Demand Forecast',
    description: 'Every Monday, AI runs demand forecast based on order history, open quotes, and seasonal trends.',
    trigger: 'WEEKLY_MONDAY',
    roles: ['PURCHASING', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_DEMAND_FORECAST', config: {} }, { type: 'SEND_NOTIFICATION', config: { title: 'Weekly Demand Forecast Ready' } }],
    frequency: 'ONCE_WEEKLY',
    category: 'Purchasing',
  },
  {
    name: 'Finance: Invoice Overdue Escalation',
    description: 'When an invoice becomes overdue, create a collection task and notify the assigned sales rep and accounting.',
    trigger: 'INVOICE_OVERDUE',
    roles: ['ACCOUNTING', 'SALES_REP', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'CREATE_TASK', config: { title: 'Follow up on overdue invoice', priority: 'HIGH' } }, { type: 'SEND_EMAIL', config: { template: 'overdue_reminder' } }, { type: 'SEND_NOTIFICATION', config: { title: 'Invoice Overdue — Action Required' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Finance',
  },
  {
    name: 'Finance: Payment Received Confirmation',
    description: 'When a payment is received, notify accounting and the assigned PM, update the order status.',
    trigger: 'PAYMENT_RECEIVED',
    roles: ['ACCOUNTING', 'PROJECT_MANAGER', 'ADMIN'],
    actions: [{ type: 'SEND_NOTIFICATION', config: { title: 'Payment Received' } }, { type: 'LOG_AUDIT', config: {} }],
    frequency: 'ON_TRIGGER',
    category: 'Finance',
  },
  {
    name: 'Warehouse: PO Received — Update Inventory',
    description: 'When a PO is received at the warehouse, automatically update inventory counts and notify purchasing.',
    trigger: 'PO_RECEIVED',
    roles: ['WAREHOUSE_LEAD', 'PURCHASING', 'ADMIN'],
    actions: [{ type: 'UPDATE_STATUS', config: { entity: 'inventory', action: 'add_received' } }, { type: 'SEND_NOTIFICATION', config: { title: 'PO Received — Inventory Updated' } }],
    frequency: 'ON_TRIGGER',
    category: 'Warehouse',
  },
  {
    name: 'Warehouse: Out of Stock Emergency',
    description: 'When any item hits zero stock, immediately alert purchasing and AI generates an emergency PO.',
    trigger: 'INVENTORY_OUT',
    roles: ['WAREHOUSE_LEAD', 'PURCHASING', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_GENERATE_PO', config: { priority: 'URGENT', autoApprove: false } }, { type: 'SEND_EMAIL', config: { template: 'emergency_stockout' } }, { type: 'SEND_NOTIFICATION', config: { title: 'CRITICAL: Item Out of Stock' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Warehouse',
  },
  {
    name: 'Sales: Quote Expiring Soon',
    description: 'When a quote is 3 days from expiry, notify the sales rep to follow up with the builder.',
    trigger: 'QUOTE_EXPIRED',
    roles: ['SALES_REP', 'ESTIMATOR', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'CREATE_TASK', config: { title: 'Follow up — quote expiring soon', priority: 'HIGH' } }, { type: 'SEND_NOTIFICATION', config: { title: 'Quote Expiring — Follow Up Needed' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Sales',
  },
  {
    name: 'Sales: New Order Kickoff',
    description: 'When a new order is created, notify the PM, warehouse lead, and create initial job tasks.',
    trigger: 'ORDER_CREATED',
    roles: ['PROJECT_MANAGER', 'WAREHOUSE_LEAD', 'ADMIN'],
    actions: [{ type: 'CREATE_TASK', config: { title: 'New order — schedule production & delivery' } }, { type: 'SEND_NOTIFICATION', config: { title: 'New Order Received' } }, { type: 'LOG_AUDIT', config: {} }],
    frequency: 'ON_TRIGGER',
    category: 'Sales',
  },
  {
    name: 'Logistics: Overdue PO Alert',
    description: 'When a PO passes its expected delivery date, alert purchasing and the PM with AI analysis of impact.',
    trigger: 'PO_OVERDUE',
    roles: ['PURCHASING', 'PROJECT_MANAGER', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_ANALYZE', config: { scope: 'impact_analysis' } }, { type: 'SEND_EMAIL', config: { template: 'po_overdue' } }, { type: 'CREATE_TASK', config: { title: 'Follow up on overdue PO', priority: 'URGENT' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Logistics',
  },
  {
    name: 'Monthly: Supplier Scorecard Review',
    description: 'On the first business day of each month, AI runs supplier scorecards and flags any performance issues.',
    trigger: 'MONTHLY_FIRST',
    roles: ['PURCHASING', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_ANALYZE', config: { scope: 'supplier_scorecard' } }, { type: 'SEND_NOTIFICATION', config: { title: 'Monthly Supplier Scorecard Ready' } }],
    frequency: 'ONCE_WEEKLY',
    category: 'Purchasing',
  },
  // ── Phase 4.2 quick-create templates (handoff §4.2) ─────────────────────
  {
    name: 'Alert me when any order is cancelled',
    description: 'When an order moves to CANCELLED, send an in-app notification to admins and managers so cleanup can start immediately.',
    trigger: 'ORDER_STATUS_CHANGED',
    roles: ['ADMIN', 'MANAGER'],
    actions: [{ type: 'SEND_NOTIFICATION', config: { title: 'Order cancelled', conditions: { to: 'CANCELLED' } } }],
    frequency: 'ON_TRIGGER',
    category: 'Sales',
  },
  {
    name: 'Create follow-up task when quote expires',
    description: 'When a quote hits expiry, create a HIGH-priority follow-up task for the assigned sales rep so the lead doesn’t go cold.',
    trigger: 'QUOTE_EXPIRED',
    roles: ['SALES_REP', 'ESTIMATOR', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'CREATE_TASK', config: { title: 'Quote expired — re-engage builder', priority: 'HIGH' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Sales',
  },
  {
    name: 'Notify ops when PO is overdue',
    description: 'When a purchase order passes its expected receipt date, ping purchasing + the PM with the impact.',
    trigger: 'PO_OVERDUE',
    roles: ['PURCHASING', 'PROJECT_MANAGER', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'SEND_NOTIFICATION', config: { title: 'PO overdue — vendor follow-up needed' } }],
    frequency: 'ONCE_PER_ENTITY',
    category: 'Logistics',
  },
  {
    name: 'Daily production stall report',
    description: 'Every morning, AI scans orders sitting in IN_PRODUCTION longer than expected and produces a stall briefing for the PM team.',
    trigger: 'DAILY_MORNING',
    roles: ['PROJECT_MANAGER', 'MANAGER', 'ADMIN'],
    actions: [{ type: 'AI_ANALYZE', config: { scope: 'production_stalls' } }, { type: 'SEND_NOTIFICATION', config: { title: 'Daily production stall report' } }],
    frequency: 'ONCE_DAILY',
    category: 'Project Management',
  },
]

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [logs, setLogs] = useState<AutomationLog[]>([])
  const [loading, setLoading] = useState(true)
  // 'system' is the default tab — these toggles control core platform
  // behavior (cascades, staff notifications, builder emails) and admins
  // are most likely landing here to flip one of those.
  const [activeTab, setActiveTab] = useState<'system' | 'rules' | 'templates' | 'logs'>('system')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filterRole, setFilterRole] = useState('')
  const [filterTrigger, setFilterTrigger] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')

  // System Automations state — Phase 2.5 of AUTOMATIONS-HANDOFF.md
  const [systemRows, setSystemRows] = useState<SystemAutomationRow[]>([])
  const [systemGrouped, setSystemGrouped] = useState<Record<string, SystemAutomationRow[]>>({})
  const [systemSeeded, setSystemSeeded] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [systemTogglingKey, setSystemTogglingKey] = useState<string | null>(null)

  // Phase 4.3: viewer role — drives tab visibility. Fetched from /api/ops/me
  // on mount. While unknown (initial load) we hide the privileged tabs and
  // default to the Logs tab which is visible to all staff.
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userRoleLoaded, setUserRoleLoaded] = useState(false)

  // Phase 4.1: log filters
  const [logStatusFilter, setLogStatusFilter] = useState<'' | 'SUCCESS' | 'ERROR'>('')
  const [logTriggerFilter, setLogTriggerFilter] = useState('')
  const [logTimeFilter, setLogTimeFilter] = useState<'24h' | '7d' | 'all'>('all')

  // Create form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formTrigger, setFormTrigger] = useState('')
  const [formRoles, setFormRoles] = useState<string[]>([])
  const [formActions, setFormActions] = useState<any[]>([])
  const [formFrequency, setFormFrequency] = useState('ON_TRIGGER')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-staff-id': 'admin',
    'x-staff-role': 'ADMIN',
  }

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterRole) params.set('role', filterRole)
      if (filterTrigger) params.set('trigger', filterTrigger)
      const res = await fetch(`/api/ops/automations?${params}`, { headers })
      if (res.ok) {
        const data = await res.json()
        setRules(data.rules || [])
        setLogs(data.logs || [])
      }
    } catch (e) {
      console.error('Failed to load automations:', e)
    } finally {
      setLoading(false)
    }
  }, [filterRole, filterTrigger])

  const loadSystem = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/system-automations', { headers })
      if (res.ok) {
        const data = await res.json()
        setSystemRows(data.rows || [])
        setSystemGrouped(data.grouped || {})
        setSystemSeeded(data.seeded !== false)
      }
    } catch (e) {
      console.error('Failed to load system automations:', e)
    }
  }, [])

  useEffect(() => { loadData(); loadSystem() }, [loadData, loadSystem])

  // Phase 4.3 — load viewer role once on mount
  useEffect(() => {
    let cancelled = false
    async function loadMe() {
      try {
        const res = await fetch('/api/ops/me')
        if (res.ok && !cancelled) {
          const data = await res.json()
          setUserRole(data.role || null)
        }
      } catch {
        // best-effort — fall through to userRoleLoaded with role=null
      } finally {
        if (!cancelled) setUserRoleLoaded(true)
      }
    }
    loadMe()
    return () => { cancelled = true }
  }, [])

  // Tab visibility per Phase 4.3:
  //   System Automations  → ADMIN, MANAGER
  //   Templates           → ADMIN, MANAGER, ACCOUNTING (they create rules)
  //   Custom Rules        → ADMIN, MANAGER, ACCOUNTING
  //   Logs                → all authenticated staff
  // While userRole is loading we render Logs only to avoid flashing the
  // privileged tabs at unauthorized viewers.
  const isAdmin = userRole === 'ADMIN'
  const isManager = userRole === 'MANAGER'
  const isAccounting = userRole === 'ACCOUNTING'
  const canSeeSystem = isAdmin || isManager
  const canManageRules = isAdmin || isManager || isAccounting

  // If activeTab points at a tab the viewer can't see (e.g. role just
  // resolved and they're not admin), fall back to Logs.
  useEffect(() => {
    if (!userRoleLoaded) return
    if (activeTab === 'system' && !canSeeSystem) setActiveTab('logs')
    if ((activeTab === 'rules' || activeTab === 'templates') && !canManageRules) setActiveTab('logs')
  }, [userRoleLoaded, canSeeSystem, canManageRules, activeTab])

  // Optimistic toggle — flip the row immediately, then refetch to confirm.
  async function toggleSystem(key: string, currentlyEnabled: boolean) {
    setSystemTogglingKey(key)
    try {
      const res = await fetch('/api/ops/system-automations', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ key, enabled: !currentlyEnabled }),
      })
      if (res.ok) await loadSystem()
    } finally {
      setSystemTogglingKey(null)
    }
  }

  async function runSystemSeed() {
    if (seeding) return
    setSeeding(true)
    try {
      const res = await fetch('/api/ops/system-automations/seed', {
        method: 'POST', headers,
      })
      if (res.ok) await loadSystem()
    } finally {
      setSeeding(false)
    }
  }

  const toggleRule = async (id: string, enabled: boolean) => {
    await fetch('/api/ops/automations', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ id, enabled: !enabled }),
    })
    loadData()
  }

  const createRule = async (data: { name: string; description: string; trigger: string; roles: string[]; actions: any[]; frequency: string }) => {
    setSaving(true)
    try {
      const res = await fetch('/api/ops/automations', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setShowCreateForm(false)
        resetForm()
        loadData()
      }
    } finally {
      setSaving(false)
    }
  }

  const installTemplate = async (template: typeof TEMPLATES[0]) => {
    setSaving(true)
    try {
      await fetch('/api/ops/automations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          trigger: template.trigger,
          roles: template.roles,
          actions: template.actions,
          frequency: template.frequency,
        }),
      })
      loadData()
      setActiveTab('rules')
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormTrigger('')
    setFormRoles([])
    setFormActions([])
    setFormFrequency('ON_TRIGGER')
  }

  const toggleFormRole = (role: string) => {
    setFormRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])
  }

  const toggleFormAction = (actionType: string) => {
    setFormActions(prev => {
      const exists = prev.find(a => a.type === actionType)
      if (exists) return prev.filter(a => a.type !== actionType)
      return [...prev, { type: actionType, config: {} }]
    })
  }

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const triggerLabel = (val: string) => TRIGGER_OPTIONS.find(t => t.value === val)?.label || val
  const actionLabel = (val: string) => ACTION_OPTIONS.find(a => a.value === val)?.label || val

  const templateCategories = Array.from(new Set(TEMPLATES.map(t => t.category)))
  const filteredTemplates = templateFilter ? TEMPLATES.filter(t => t.category === templateFilter) : TEMPLATES

  // Check if template is already installed
  const isInstalled = (template: typeof TEMPLATES[0]) => rules.some(r => r.name === template.name)

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#0f2a3e' }}>Loading automations...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: '#0f2a3e', margin: 0 }}>Automations & AI Tasks</h1>
          <p style={{ color: '#666', margin: '4px 0 0' }}>Create automated workflows, AI-powered tasks, and role-based actions</p>
        </div>
        <button
          onClick={() => { setShowCreateForm(true); setActiveTab('rules') }}
          style={{
            background: '#C6A24E', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
          }}
        >
          + Create Automation
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Rules', value: rules.length, color: '#0f2a3e' },
          { label: 'Active', value: rules.filter(r => r.enabled).length, color: '#27ae60' },
          { label: 'Disabled', value: rules.filter(r => !r.enabled).length, color: '#95a5a6' },
          { label: 'Total Executions', value: rules.reduce((s, r) => s + (r.runCount || 0), 0), color: '#C6A24E' },
        ].map((stat, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{stat.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600, color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs — role-gated per Phase 4.3 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #e0e0e0' }}>
        {[
          canSeeSystem && { key: 'system' as const, label: `System Automations (${systemRows.length})` },
          canManageRules && { key: 'rules' as const, label: `Active Rules (${rules.length})` },
          canManageRules && { key: 'templates' as const, label: `Templates (${TEMPLATES.length})` },
          { key: 'logs' as const, label: `Execution Log (${logs.length})` },
        ].filter(Boolean).map((tab: any) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 24px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: activeTab === tab.key ? '#0f2a3e' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#666',
              borderRadius: '8px 8px 0 0',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── SYSTEM AUTOMATIONS TAB ── */}
      {activeTab === 'system' && (
        <div>
          {/* Warning banner */}
          <div style={{
            background: '#FFF8E1', border: '1px solid #F4D67A', borderRadius: 10,
            padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#5C4815',
          }}>
            <strong>System automations control core platform behavior.</strong>{' '}
            Disabling a lifecycle automation (job creation, invoice creation,
            delivery scheduling) may cause downstream features to break.
            Toggle changes apply within ~60 seconds (cache TTL).
          </div>

          {/* Not seeded yet — show prompt */}
          {!systemSeeded && (
            <div style={{
              background: '#fff', border: '2px dashed #C6A24E', borderRadius: 10,
              padding: 24, textAlign: 'center', marginBottom: 16,
            }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#0f2a3e', marginBottom: 8 }}>
                System automations not initialized
              </div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 16, maxWidth: 600, margin: '0 auto 16px' }}>
                The SystemAutomation table doesn&apos;t exist yet on this database.
                Click below to create it and seed the canonical automation rows.
                This is idempotent — safe to run multiple times.
              </div>
              <button
                onClick={runSystemSeed}
                disabled={seeding}
                style={{
                  background: seeding ? '#ccc' : '#C6A24E',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '10px 24px', fontWeight: 600, cursor: seeding ? 'wait' : 'pointer',
                  fontSize: 14,
                }}
              >
                {seeding ? 'Seeding…' : 'Run Seed'}
              </button>
            </div>
          )}

          {/* Seeded — render grouped rows */}
          {systemSeeded && Object.keys(systemGrouped).length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
              <div style={{ fontSize: 14 }}>No system automations found.</div>
              <button
                onClick={runSystemSeed}
                disabled={seeding}
                style={{
                  marginTop: 12,
                  background: '#0f2a3e', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '6px 16px', fontSize: 12, cursor: 'pointer',
                }}
              >
                {seeding ? 'Re-seeding…' : 'Re-seed'}
              </button>
            </div>
          )}

          {systemSeeded && Object.entries(systemGrouped).map(([category, rows]) => {
            const isBuilderEmails = category === 'Builder Emails'
            return (
              <div key={category} style={{ marginBottom: 24 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase',
                  letterSpacing: 0.5, marginBottom: 8, padding: '0 4px',
                }}>
                  {category}
                  {isBuilderEmails && (
                    <span style={{ marginLeft: 8, color: '#C6A24E', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                      — master switch governed by BUILDER_INVOICE_EMAILS_ENABLED in Vercel env
                    </span>
                  )}
                </div>
                <div style={{
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
                  overflow: 'hidden',
                }}>
                  {rows.map((row, idx) => (
                    <div
                      key={row.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderBottom: idx < rows.length - 1 ? '1px solid #f0f0f0' : 'none',
                        opacity: row.enabled ? 1 : 0.6,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f2a3e' }}>
                            {row.name}
                          </span>
                          {row.triggerStatus && (
                            <span style={{
                              padding: '2px 6px', background: '#EBF5FB', color: '#0f2a3e',
                              borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: 'monospace',
                            }}>
                              {row.triggerStatus}
                            </span>
                          )}
                        </div>
                        {row.description && (
                          <div style={{ fontSize: 12, color: '#666' }}>{row.description}</div>
                        )}
                        <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, fontFamily: 'monospace' }}>
                          {row.key}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleSystem(row.key, row.enabled)}
                        disabled={systemTogglingKey === row.key}
                        style={{
                          padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          cursor: systemTogglingKey === row.key ? 'wait' : 'pointer',
                          border: 'none',
                          background: row.enabled ? '#e8f5e9' : '#f5f5f5',
                          color: row.enabled ? '#2e7d32' : '#999',
                          minWidth: 90, textAlign: 'center',
                        }}
                      >
                        {systemTogglingKey === row.key
                          ? '…'
                          : row.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── RULES TAB ── */}
      {activeTab === 'rules' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}>
              <option value="">All Roles</option>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterTrigger} onChange={e => setFilterTrigger(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}>
              <option value="">All Triggers</option>
              {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Create Form */}
          {showCreateForm && (
            <div style={{
              background: '#f8f9fa', border: '2px solid #0f2a3e', borderRadius: 12,
              padding: 24, marginBottom: 24,
            }}>
              <h3 style={{ margin: '0 0 16px', color: '#0f2a3e' }}>Create New Automation Rule</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#555' }}>Rule Name *</label>
                  <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Auto-reorder when stock is low"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#555' }}>Trigger Event *</label>
                  <select value={formTrigger} onChange={e => setFormTrigger(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}>
                    <option value="">Select trigger...</option>
                    {Object.entries(
                      TRIGGER_OPTIONS.reduce((groups: Record<string, typeof TRIGGER_OPTIONS>, t) => {
                        (groups[t.category] = groups[t.category] || []).push(t)
                        return groups
                      }, {})
                    ).map(([cat, triggers]) => (
                      <optgroup key={cat} label={cat}>
                        {triggers.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#555' }}>Description</label>
                <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2}
                  placeholder="Describe what this automation does..."
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#555' }}>Assign to Roles</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ROLE_OPTIONS.map(role => (
                    <button key={role} onClick={() => toggleFormRole(role)}
                      style={{
                        padding: '4px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer', fontWeight: 500,
                        border: formRoles.includes(role) ? '2px solid #0f2a3e' : '1px solid #ccc',
                        background: formRoles.includes(role) ? '#0f2a3e' : '#fff',
                        color: formRoles.includes(role) ? '#fff' : '#555',
                      }}
                    >
                      {role.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#555' }}>Actions to Perform</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {ACTION_OPTIONS.map(action => {
                    const selected = formActions.some(a => a.type === action.value)
                    return (
                      <button key={action.value} onClick={() => toggleFormAction(action.value)}
                        style={{
                          padding: '8px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                          textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                          border: selected ? '2px solid #C6A24E' : '1px solid #ddd',
                          background: selected ? '#FFF3E6' : '#fff',
                          color: '#333',
                        }}
                      >
                        <span>{action.icon}</span>
                        <span>{action.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#555' }}>Frequency</label>
                  <select value={formFrequency} onChange={e => setFormFrequency(e.target.value)}
                    style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}>
                    {FREQUENCY_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  disabled={!formName || !formTrigger || saving}
                  onClick={() => createRule({
                    name: formName, description: formDescription, trigger: formTrigger,
                    roles: formRoles, actions: formActions, frequency: formFrequency,
                  })}
                  style={{
                    background: (!formName || !formTrigger) ? '#ccc' : '#0f2a3e', color: '#fff',
                    border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {saving ? 'Creating...' : 'Create Rule'}
                </button>
                <button onClick={() => { setShowCreateForm(false); resetForm() }}
                  style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: '10px 24px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Rules List */}
          {rules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No automation rules yet</div>
              <div style={{ fontSize: 13 }}>Create one from scratch or install a pre-built template</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rules.map(rule => (
                <div key={rule.id} style={{
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
                  padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  opacity: rule.enabled ? 1 : 0.6,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: '#0f2a3e' }}>{rule.name}</span>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: rule.enabled ? '#e8f5e9' : '#f5f5f5',
                          color: rule.enabled ? '#2e7d32' : '#999',
                        }}>
                          {rule.enabled ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>
                      {rule.description && (
                        <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>{rule.description}</div>
                      )}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                        <span style={{ color: '#888' }}>
                          <strong>Trigger:</strong> {triggerLabel(rule.trigger)}
                        </span>
                        <span style={{ color: '#888' }}>
                          <strong>Frequency:</strong> {FREQUENCY_OPTIONS.find(f => f.value === rule.frequency)?.label || rule.frequency}
                        </span>
                        <span style={{ color: '#888' }}>
                          <strong>Runs:</strong> {rule.runCount || 0}
                        </span>
                        {rule.lastRunAt && (
                          <span style={{ color: '#888' }}>
                            <strong>Last Run:</strong> {formatDate(rule.lastRunAt)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                        {(rule.roles || []).map((r: string) => (
                          <span key={r} style={{
                            padding: '2px 8px', background: '#EBF5FB', color: '#0f2a3e',
                            borderRadius: 10, fontSize: 10, fontWeight: 500,
                          }}>
                            {r.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                      {rule.actions && (rule.actions as any[]).length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {(rule.actions as any[]).map((a: any, i: number) => {
                            const opt = ACTION_OPTIONS.find(o => o.value === a.type)
                            return (
                              <span key={i} style={{
                                padding: '2px 8px', background: '#FFF3E6', color: '#C6A24E',
                                borderRadius: 10, fontSize: 10, fontWeight: 500,
                              }}>
                                {opt?.icon} {opt?.label || a.type}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => toggleRule(rule.id, rule.enabled)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: 'none',
                        background: rule.enabled ? '#ffebee' : '#e8f5e9',
                        color: rule.enabled ? '#c62828' : '#2e7d32',
                      }}
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TEMPLATES TAB ── */}
      {activeTab === 'templates' && (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setTemplateFilter('')}
              style={{
                padding: '6px 14px', borderRadius: 16, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                border: !templateFilter ? '2px solid #0f2a3e' : '1px solid #ccc',
                background: !templateFilter ? '#0f2a3e' : '#fff',
                color: !templateFilter ? '#fff' : '#555',
              }}>
              All
            </button>
            {templateCategories.map(cat => (
              <button key={cat} onClick={() => setTemplateFilter(cat)}
                style={{
                  padding: '6px 14px', borderRadius: 16, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                  border: templateFilter === cat ? '2px solid #0f2a3e' : '1px solid #ccc',
                  background: templateFilter === cat ? '#0f2a3e' : '#fff',
                  color: templateFilter === cat ? '#fff' : '#555',
                }}>
                {cat}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {filteredTemplates.map((template, idx) => {
              const installed = isInstalled(template)
              return (
                <div key={idx} style={{
                  background: '#fff', border: installed ? '2px solid #27ae60' : '1px solid #e0e0e0',
                  borderRadius: 10, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <span style={{
                        padding: '2px 8px', background: '#f0f0f0', borderRadius: 10,
                        fontSize: 10, fontWeight: 600, color: '#888', marginBottom: 4, display: 'inline-block',
                      }}>
                        {template.category}
                      </span>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#0f2a3e', marginTop: 4 }}>{template.name}</div>
                    </div>
                    {installed ? (
                      <span style={{ padding: '4px 12px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                        Installed
                      </span>
                    ) : (
                      <button onClick={() => installTemplate(template)} disabled={saving}
                        style={{
                          padding: '6px 16px', background: '#C6A24E', color: '#fff', border: 'none',
                          borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                        {saving ? '...' : 'Install'}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 10, lineHeight: 1.4 }}>{template.description}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                    {template.roles.map(r => (
                      <span key={r} style={{
                        padding: '2px 6px', background: '#EBF5FB', color: '#0f2a3e',
                        borderRadius: 8, fontSize: 9, fontWeight: 500,
                      }}>
                        {r.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {template.actions.map((a, i) => {
                      const opt = ACTION_OPTIONS.find(o => o.value === a.type)
                      return (
                        <span key={i} style={{
                          padding: '2px 6px', background: '#FFF3E6', color: '#C6A24E',
                          borderRadius: 8, fontSize: 9, fontWeight: 500,
                        }}>
                          {opt?.icon} {opt?.label || a.type}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── LOGS TAB — Phase 4.1 filters + Recent Activity summary ── */}
      {activeTab === 'logs' && (() => {
        // Compute filtered set + summary stats. Client-side only since the
        // GET endpoint already caps at 50 rows. If logs grow we'll move
        // filtering server-side.
        const now = Date.now()
        const cutoffMs =
          logTimeFilter === '24h' ? 24 * 60 * 60 * 1000 :
          logTimeFilter === '7d' ? 7 * 24 * 60 * 60 * 1000 :
          Number.MAX_SAFE_INTEGER
        const filteredLogs = logs.filter(l => {
          if (logStatusFilter && l.status !== logStatusFilter) return false
          if (logTriggerFilter && l.trigger !== logTriggerFilter) return false
          if (logTimeFilter !== 'all') {
            const t = l.executedAt ? new Date(l.executedAt).getTime() : 0
            if (now - t > cutoffMs) return false
          }
          return true
        })
        // Summary always reflects last 24h (independent of filter selection)
        const last24h = logs.filter(l => {
          const t = l.executedAt ? new Date(l.executedAt).getTime() : 0
          return now - t < 24 * 60 * 60 * 1000
        })
        const errors24h = last24h.filter(l => l.status === 'ERROR').length

        return (
          <div>
            {/* Recent Activity summary */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
              marginBottom: 16,
            }}>
              {[
                { label: 'Fired (24h)', value: last24h.length, color: '#0f2a3e' },
                { label: 'Errors (24h)', value: errors24h, color: errors24h > 0 ? '#c62828' : '#27ae60' },
                { label: 'Total logged', value: logs.length, color: '#C6A24E' },
              ].map((stat, i) => (
                <div key={i} style={{
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
                  padding: '12px 16px',
                }}>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{stat.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 600, color: stat.color }}>{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <select value={logStatusFilter} onChange={e => setLogStatusFilter(e.target.value as any)}
                style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}>
                <option value="">All statuses</option>
                <option value="SUCCESS">Success</option>
                <option value="ERROR">Error</option>
              </select>
              <select value={logTriggerFilter} onChange={e => setLogTriggerFilter(e.target.value)}
                style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}>
                <option value="">All triggers</option>
                {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={logTimeFilter} onChange={e => setLogTimeFilter(e.target.value as any)}
                style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All time</option>
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7 days</option>
              </select>
              {(logStatusFilter || logTriggerFilter || logTimeFilter !== 'all') && (
                <button
                  onClick={() => { setLogStatusFilter(''); setLogTriggerFilter(''); setLogTimeFilter('all') }}
                  style={{
                    padding: '8px 12px', background: '#fff', border: '1px solid #ccc',
                    borderRadius: 6, fontSize: 12, color: '#666', cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
              <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: '#888' }}>
                Showing {filteredLogs.length} of {logs.length}
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {logs.length === 0 ? 'No execution logs yet' : 'No logs match the current filters'}
                </div>
                <div style={{ fontSize: 13 }}>
                  {logs.length === 0
                    ? 'Logs will appear here as automations run'
                    : 'Try clearing the filters above'}
                </div>
              </div>
            ) : (
              <div style={{
                background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Time</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Rule</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Trigger</th>
                      <th style={{ padding: '10px 16px', textAlign: 'center', color: '#555', fontWeight: 600 }}>Actions Run</th>
                      <th style={{ padding: '10px 16px', textAlign: 'center', color: '#555', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 16px', color: '#888' }}>{formatDate(log.executedAt)}</td>
                        <td style={{ padding: '10px 16px', fontWeight: 600, color: '#0f2a3e' }}>{log.ruleName || '—'}</td>
                        <td style={{ padding: '10px 16px' }}>{triggerLabel(log.trigger)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'center' }}>{log.actionsRun}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: log.status === 'SUCCESS' ? '#e8f5e9' : '#ffebee',
                            color: log.status === 'SUCCESS' ? '#2e7d32' : '#c62828',
                          }}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', color: '#c62828', fontSize: 12 }}>{log.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
