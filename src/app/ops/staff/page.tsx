'use client'

import { useState, useEffect, useMemo } from 'react'

interface StaffMember {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  role: string
  department: string
  title?: string
  hourlyRate?: number
  active: boolean
  hireDate?: string
  status: 'Active' | 'Invited' | 'Needs Setup' | 'Deactivated'
  handbookSignedAt?: string
  handbookVersion?: string
  inviteTokenExpiry?: string
  portalOverrides?: Record<string, boolean>
  createdAt: string
}

const ROLES = [
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'ESTIMATOR', label: 'Estimator' },
  { value: 'SALES_REP', label: 'Sales Rep' },
  { value: 'PURCHASING', label: 'Purchasing' },
  { value: 'WAREHOUSE_LEAD', label: 'Warehouse Lead' },
  { value: 'WAREHOUSE_TECH', label: 'Warehouse Tech' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'INSTALLER', label: 'Installer' },
  { value: 'QC_INSPECTOR', label: 'QC Inspector' },
  { value: 'ACCOUNTING', label: 'Accounting' },
  { value: 'VIEWER', label: 'Viewer (Read-Only)' },
]

const DEPARTMENTS = [
  { value: 'EXECUTIVE', label: 'Executive' },
  { value: 'SALES', label: 'Sales' },
  { value: 'ESTIMATING', label: 'Estimating' },
  { value: 'OPERATIONS', label: 'Operations' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
  { value: 'WAREHOUSE', label: 'Warehouse' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'INSTALLATION', label: 'Installation' },
  { value: 'ACCOUNTING', label: 'Accounting' },
  { value: 'PURCHASING', label: 'Purchasing' },
]

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  Active: { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  Invited: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  'Needs Setup': { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  Deactivated: { bg: 'rgba(107,114,128,0.15)', color: '#6b7280' },
}

// ── Portal definitions grouped by category ──
// Each route matches a key in the ROUTE_ACCESS map from permissions.ts
const PORTAL_GROUPS: { label: string; portals: { route: string; label: string }[] }[] = [
  {
    label: 'Core',
    portals: [
      { route: '/ops', label: 'Dashboard' },
      { route: '/ops/executive', label: 'Executive Overview' },
      { route: '/ops/reports', label: 'Reports' },
      { route: '/ops/ai', label: 'AI Assistant' },
    ],
  },
  {
    label: 'Sales & Accounts',
    portals: [
      { route: '/ops/sales', label: 'Sales Pipeline' },
      { route: '/ops/accounts', label: 'Accounts' },
      { route: '/ops/quotes', label: 'Quotes' },
      { route: '/ops/orders', label: 'Orders' },
      { route: '/ops/contracts', label: 'Contracts' },
      { route: '/ops/organizations', label: 'Organizations' },
      { route: '/ops/communities', label: 'Communities' },
      { route: '/ops/growth', label: 'Growth Engine' },
      { route: '/ops/marketing', label: 'Marketing' },
      { route: '/ops/outreach', label: 'Outreach' },
    ],
  },
  {
    label: 'Jobs & Projects',
    portals: [
      { route: '/ops/jobs', label: 'Jobs' },
      { route: '/ops/schedule', label: 'Schedule' },
      { route: '/ops/crews', label: 'Crews' },
      { route: '/ops/floor-plans', label: 'Floor Plans' },
      { route: '/ops/takeoff-inquiries', label: 'Takeoff Inquiries' },
      { route: '/ops/takeoff-review', label: 'Takeoff Review' },
      { route: '/ops/quote-requests', label: 'Quote Requests' },
    ],
  },
  {
    label: 'Operations & Warehouse',
    portals: [
      { route: '/ops/manufacturing', label: 'Manufacturing' },
      { route: '/ops/inventory', label: 'Inventory' },
      { route: '/ops/warehouse', label: 'Warehouse' },
      { route: '/ops/receiving', label: 'Receiving' },
      { route: '/ops/returns', label: 'Returns' },
      { route: '/ops/delivery', label: 'Delivery' },
      { route: '/ops/fleet', label: 'Fleet Management' },
    ],
  },
  {
    label: 'Supply Chain & Purchasing',
    portals: [
      { route: '/ops/supply-chain', label: 'Supply Chain' },
      { route: '/ops/vendors', label: 'Vendors' },
      { route: '/ops/purchasing', label: 'Purchasing' },
      { route: '/ops/products', label: 'Products' },
      { route: '/ops/pricing', label: 'Pricing' },
      { route: '/ops/procurement-intelligence', label: 'Procurement Intel' },
    ],
  },
  {
    label: 'Finance',
    portals: [
      { route: '/ops/finance', label: 'Finance' },
      { route: '/ops/invoices', label: 'Invoices' },
      { route: '/ops/payments', label: 'Payments' },
      { route: '/ops/ar-aging', label: 'AR Aging' },
      { route: '/ops/financial-reports', label: 'Financial Reports' },
      { route: '/ops/collections', label: 'Collections' },
      { route: '/ops/cash-flow-optimizer', label: 'Cash Flow' },
    ],
  },
  {
    label: 'Communication & Warranty',
    portals: [
      { route: '/ops/messages', label: 'Messages' },
      { route: '/ops/email', label: 'Email Queue' },
      { route: '/ops/communication-log', label: 'Communication Log' },
      { route: '/ops/builder-messages', label: 'Builder Messages' },
      { route: '/ops/warranty', label: 'Warranty' },
    ],
  },
  {
    label: 'Department Portals',
    portals: [
      { route: '/ops/portal/pm', label: 'PM Portal' },
      { route: '/ops/portal/purchasing', label: 'Purchasing Portal' },
      { route: '/ops/portal/warehouse', label: 'Warehouse Portal' },
      { route: '/ops/portal/delivery', label: 'Delivery Portal' },
      { route: '/ops/portal/accounting', label: 'Accounting Portal' },
    ],
  },
  {
    label: 'Admin',
    portals: [
      { route: '/ops/staff', label: 'Staff Management' },
      { route: '/ops/audit', label: 'Audit Log' },
      { route: '/ops/settings', label: 'Settings' },
      { route: '/ops/integrations', label: 'Integrations' },
      { route: '/ops/imports', label: 'Imports' },
      { route: '/ops/automations', label: 'Automations' },
    ],
  },
]

// ── Role-based default access (mirrors ROUTE_ACCESS in permissions.ts) ──
const ALL_ROLES = ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP','PURCHASING','WAREHOUSE_LEAD','WAREHOUSE_TECH','DRIVER','INSTALLER','QC_INSPECTOR','ACCOUNTING','VIEWER']

const ROUTE_DEFAULTS: Record<string, string[]> = {
  '/ops': ALL_ROLES,
  '/ops/executive': ALL_ROLES,
  '/ops/reports': ALL_ROLES,
  '/ops/ai': ALL_ROLES,
  '/ops/jobs': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP','WAREHOUSE_LEAD'],
  '/ops/accounts': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP','ACCOUNTING'],
  '/ops/products': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP','PURCHASING','WAREHOUSE_LEAD'],
  '/ops/manufacturing': ['ADMIN','MANAGER','PROJECT_MANAGER','WAREHOUSE_LEAD','WAREHOUSE_TECH','QC_INSPECTOR'],
  '/ops/supply-chain': ['ADMIN','MANAGER','PROJECT_MANAGER','PURCHASING','WAREHOUSE_LEAD'],
  '/ops/inventory': ['ADMIN','MANAGER','PROJECT_MANAGER','PURCHASING','WAREHOUSE_LEAD','WAREHOUSE_TECH'],
  '/ops/vendors': ['ADMIN','MANAGER','PURCHASING','PROJECT_MANAGER'],
  '/ops/finance': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER','PURCHASING','SALES_REP','ESTIMATOR'],
  '/ops/invoices': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER','SALES_REP','ESTIMATOR'],
  '/ops/payments': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER'],
  '/ops/ar-aging': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER','SALES_REP'],
  '/ops/financial-reports': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER'],
  '/ops/warranty': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP','QC_INSPECTOR'],
  '/ops/messages': ALL_ROLES,
  '/ops/notifications': ALL_ROLES,
  '/ops/portal/pm': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP'],
  '/ops/portal/purchasing': ['ADMIN','MANAGER','PURCHASING'],
  '/ops/portal/warehouse': ['ADMIN','MANAGER','WAREHOUSE_LEAD','WAREHOUSE_TECH','QC_INSPECTOR'],
  '/ops/portal/delivery': ['ADMIN','MANAGER','DRIVER','INSTALLER','WAREHOUSE_LEAD','PROJECT_MANAGER'],
  '/ops/portal/accounting': ['ADMIN','MANAGER','ACCOUNTING'],
  '/ops/documents': ALL_ROLES,
  '/ops/sales': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP','ESTIMATOR'],
  '/ops/delegations': ['ADMIN','MANAGER','PROJECT_MANAGER'],
  '/ops/staff': ['ADMIN','MANAGER'],
  '/ops/audit': ['ADMIN','MANAGER'],
  '/ops/settings': ['ADMIN'],
  '/ops/email': ['ADMIN','MANAGER','SALES_REP','PROJECT_MANAGER'],
  '/ops/growth': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP'],
  '/ops/marketing': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP'],
  '/ops/outreach': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP'],
  '/ops/revenue-intelligence': ['ADMIN','MANAGER','PROJECT_MANAGER'],
  '/ops/integrations': ['ADMIN','MANAGER'],
  '/ops/imports': ['ADMIN','MANAGER'],
  '/ops/floor-plans': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP'],
  '/ops/collections': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER','SALES_REP'],
  '/ops/cash-flow-optimizer': ['ADMIN','MANAGER','ACCOUNTING','PROJECT_MANAGER'],
  '/ops/procurement-intelligence': ['ADMIN','MANAGER','PROJECT_MANAGER','PURCHASING'],
  '/ops/automations': ['ADMIN','MANAGER','PROJECT_MANAGER','PURCHASING','WAREHOUSE_LEAD','ACCOUNTING','SALES_REP'],
  '/ops/delivery': ['ADMIN','MANAGER','PROJECT_MANAGER','DRIVER','WAREHOUSE_LEAD'],
  '/ops/schedule': ['ADMIN','MANAGER','PROJECT_MANAGER','WAREHOUSE_LEAD'],
  '/ops/crews': ['ADMIN','MANAGER','PROJECT_MANAGER','WAREHOUSE_LEAD','WAREHOUSE_TECH'],
  '/ops/pricing': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP'],
  '/ops/quotes': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP'],
  '/ops/orders': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP','ACCOUNTING','WAREHOUSE_LEAD'],
  '/ops/quote-requests': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR','SALES_REP'],
  '/ops/takeoff-inquiries': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR'],
  '/ops/takeoff-review': ['ADMIN','MANAGER','PROJECT_MANAGER','ESTIMATOR'],
  '/ops/organizations': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP'],
  '/ops/communities': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP'],
  '/ops/purchasing': ['ADMIN','MANAGER','PROJECT_MANAGER','PURCHASING'],
  '/ops/communication-log': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP','ACCOUNTING'],
  '/ops/builder-messages': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP'],
  '/ops/contracts': ['ADMIN','MANAGER','PROJECT_MANAGER','SALES_REP','ESTIMATOR'],
  '/ops/receiving': ['ADMIN','MANAGER','PURCHASING','WAREHOUSE_LEAD','WAREHOUSE_TECH','PROJECT_MANAGER'],
  '/ops/returns': ['ADMIN','MANAGER','WAREHOUSE_LEAD','PROJECT_MANAGER','ACCOUNTING'],
  '/ops/warehouse': ['ADMIN','MANAGER','WAREHOUSE_LEAD','WAREHOUSE_TECH'],
  '/ops/fleet': ['ADMIN','MANAGER','PROJECT_MANAGER','DRIVER','WAREHOUSE_LEAD'],
}

function roleHasDefaultAccess(role: string, route: string): boolean {
  const allowedRoles = ROUTE_DEFAULTS[route]
  if (!allowedRoles) return false
  return allowedRoles.includes(role)
}

// Shared styles
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', backgroundColor: '#111827',
  border: '1px solid #374151', borderRadius: 8, color: '#fff',
  fontSize: 14, boxSizing: 'border-box' as const, outline: 'none',
}
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12, color: '#9ca3af', fontWeight: 500 }

export default function StaffManagementPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'setup' | 'deactivated'>('all')
  const [search, setSearch] = useState('')

  // Modals
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  // Add form
  const [addForm, setAddForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    staffRole: 'WAREHOUSE_TECH', department: 'WAREHOUSE', title: '', hireDate: '',
  })

  // Edit form
  const [editForm, setEditForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    role: '', department: '', title: '', active: true, hireDate: '',
  })

  // Portal overrides for the employee being edited
  const [portalOverrides, setPortalOverrides] = useState<Record<string, boolean>>({})

  // Tab in the edit modal
  const [editTab, setEditTab] = useState<'details' | 'access'>('details')

  useEffect(() => { fetchStaff() }, [])

  const fetchStaff = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/ops/staff')
      const data = await res.json()
      if (data.success) setStaff(data.data)
      else setError(data.error || 'Failed to fetch staff')
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  const showMessage = (msg: string) => {
    setActionMessage(msg)
    setTimeout(() => setActionMessage(''), 4000)
  }

  // ── Add Employee ──
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/ops/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const data = await res.json()
      if (data.success) {
        showMessage(`${addForm.firstName} ${addForm.lastName} added! Invite email will be sent to ${addForm.email}.`)
        try { await navigator.clipboard.writeText(data.data.inviteUrl) } catch {}
        setShowAddForm(false)
        setAddForm({ firstName: '', lastName: '', email: '', phone: '', staffRole: 'WAREHOUSE_TECH', department: 'WAREHOUSE', title: '', hireDate: '' })
        fetchStaff()
      } else {
        showMessage('Error: ' + (data.error || 'Failed to add staff'))
      }
    } catch { showMessage('Network error') }
    finally { setSaving(false) }
  }

  // ── Edit Employee ──
  const openEdit = (member: StaffMember) => {
    setEditingStaff(member)
    setEditForm({
      firstName: member.firstName, lastName: member.lastName,
      email: member.email, phone: member.phone || '',
      role: member.role, department: member.department,
      title: member.title || '', active: member.active,
      hireDate: member.hireDate ? member.hireDate.split('T')[0] : '',
    })
    setPortalOverrides(member.portalOverrides || {})
    setEditTab('details')
  }

  const handleEditStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingStaff) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ops/staff/${editingStaff.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, portalOverrides }),
      })
      const data = await res.json()
      if (data.staff) {
        showMessage(`${editForm.firstName} ${editForm.lastName} updated successfully.`)
        setEditingStaff(null)
        fetchStaff()
      } else {
        showMessage('Error: ' + (data.error || 'Failed to update'))
      }
    } catch { showMessage('Network error') }
    finally { setSaving(false) }
  }

  // ── Portal access toggle ──
  const togglePortalAccess = (route: string) => {
    const currentRole = editForm.role
    const roleDefault = roleHasDefaultAccess(currentRole, route)

    setPortalOverrides(prev => {
      const copy = { ...prev }
      if (route in copy) {
        // Has an override — if override matches what toggling would do, remove it (back to default)
        const currentOverride = copy[route]
        if (currentOverride === roleDefault) {
          // Override is same as default and user toggled — set to opposite
          copy[route] = !roleDefault
        } else {
          // Override differs from default — remove it to go back to default
          delete copy[route]
        }
      } else {
        // No override — toggle means opposite of default
        copy[route] = !roleDefault
      }
      return copy
    })
  }

  const getEffectiveAccess = (route: string): boolean => {
    if (route in portalOverrides) return portalOverrides[route]
    return roleHasDefaultAccess(editForm.role, route)
  }

  const getAccessState = (route: string): 'default-on' | 'default-off' | 'override-on' | 'override-off' => {
    const hasOverride = route in portalOverrides
    const effective = getEffectiveAccess(route)
    if (hasOverride) return effective ? 'override-on' : 'override-off'
    return effective ? 'default-on' : 'default-off'
  }

  // ── Actions ──
  const handleResendInvite = async (member: StaffMember) => {
    try {
      const res = await fetch(`/api/ops/staff/${member.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend-invite' }),
      })
      const data = await res.json()
      if (data.success) {
        try { await navigator.clipboard.writeText(data.data.inviteUrl) } catch {}
        showMessage(`Invite resent to ${member.email}. Link copied to clipboard.`)
        fetchStaff()
      } else showMessage('Error: ' + (data.error || 'Failed'))
    } catch { showMessage('Network error') }
  }

  const handleResetPassword = async (member: StaffMember) => {
    try {
      const res = await fetch(`/api/ops/staff/${member.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-password' }),
      })
      const data = await res.json()
      if (data.success) {
        try { await navigator.clipboard.writeText(data.data.resetUrl) } catch {}
        showMessage(`Reset link sent to ${member.email}. Link copied to clipboard.`)
      } else showMessage('Error: ' + (data.error || 'Failed'))
    } catch { showMessage('Network error') }
  }

  const handleToggleActive = async (member: StaffMember) => {
    const newActive = !member.active
    try {
      const res = await fetch(`/api/ops/staff/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive }),
      })
      const data = await res.json()
      if (data.staff) {
        showMessage(`${member.firstName} ${member.lastName} ${newActive ? 'activated' : 'deactivated'}.`)
        fetchStaff()
      }
    } catch { showMessage('Network error') }
  }

  // ── Filtering ──
  const filtered = staff.filter(s => {
    if (filter === 'active' && s.status !== 'Active') return false
    if (filter === 'setup' && s.status !== 'Needs Setup' && s.status !== 'Invited') return false
    if (filter === 'deactivated' && s.status !== 'Deactivated') return false
    if (search) {
      const q = search.toLowerCase()
      return (s.firstName + ' ' + s.lastName).toLowerCase().includes(q)
        || s.email.toLowerCase().includes(q)
        || (s.title || '').toLowerCase().includes(q)
    }
    return true
  })

  const counts = {
    all: staff.length,
    active: staff.filter(s => s.status === 'Active').length,
    setup: staff.filter(s => s.status === 'Needs Setup' || s.status === 'Invited').length,
    deactivated: staff.filter(s => s.status === 'Deactivated').length,
  }

  // Count overrides for a staff member
  const overrideCount = (member: StaffMember) => {
    return Object.keys(member.portalOverrides || {}).length
  }

  return (
    <div style={{ padding: 24, color: '#fff', minHeight: '100vh' }}>
      {/* Toast */}
      {actionMessage && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '14px 24px',
          backgroundColor: actionMessage.startsWith('Error') ? '#7f1d1d' : '#14532d',
          border: `1px solid ${actionMessage.startsWith('Error') ? '#991b1b' : '#166534'}`,
          borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 500,
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)', maxWidth: 500,
        }}>
          {actionMessage}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 28, fontWeight: 700 }}>Staff Management</h1>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: 14 }}>
            {staff.length} employees &middot; {counts.active} active &middot; {counts.setup} need setup
          </p>
        </div>
        <button onClick={() => setShowAddForm(true)} style={{
          padding: '10px 24px', backgroundColor: '#f59e0b', color: '#000', border: 'none',
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>
          + Add Employee
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'active', 'setup', 'deactivated'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 16px', borderRadius: 20, border: 'none', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', transition: 'all 0.2s',
            backgroundColor: filter === f ? '#f59e0b' : '#1f2937',
            color: filter === f ? '#000' : '#9ca3af',
          }}>
            {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'setup' ? 'Needs Setup' : 'Deactivated'}
            {' '}({counts[f]})
          </button>
        ))}
        <input
          type="text" placeholder="Search name or email..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 260, marginLeft: 'auto' }}
        />
      </div>

      {/* Staff Table */}
      {loading ? (
        <p style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Loading staff...</p>
      ) : error ? (
        <div style={{ padding: 20, backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#f87171' }}>{error}</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #1f2937', borderRadius: 12, backgroundColor: '#111827' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f2937' }}>
                {['Name', 'Email', 'Role', 'Department', 'Hourly Rate', 'Status', 'Access', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(member => {
                const statusStyle = STATUS_STYLES[member.status] || STATUS_STYLES.Active
                const oc = overrideCount(member)
                return (
                  <tr key={member.id} style={{ borderBottom: '1px solid #1f2937' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1f2937')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 500 }}>{member.firstName} {member.lastName}</div>
                      {member.title && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{member.title}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: 13 }}>{member.email}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, backgroundColor: '#0f2a3e', color: '#93c5fd' }}>
                        {ROLES.find(r => r.value === member.role)?.label || member.role}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>
                      {DEPARTMENTS.find(d => d.value === member.department)?.label || member.department}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#9ca3af' }}>
                      {member.hourlyRate ? `$${member.hourlyRate.toFixed(2)}/hr` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, backgroundColor: statusStyle.bg, color: statusStyle.color }}>
                        {member.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12 }}>
                      {oc > 0 ? (
                        <span style={{ padding: '3px 10px', borderRadius: 6, fontWeight: 500, backgroundColor: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>
                          {oc} custom
                        </span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>Role default</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => openEdit(member)} style={actionBtnStyle('#3b82f6')}>Edit</button>
                        <button onClick={() => { openEdit(member); setEditTab('access') }} style={actionBtnStyle('#8b5cf6')}>Access</button>
                        {(member.status === 'Needs Setup' || member.status === 'Invited') && (
                          <button onClick={() => handleResendInvite(member)} style={actionBtnStyle('#f59e0b')}>Invite</button>
                        )}
                        {member.status === 'Active' && (
                          <button onClick={() => handleResetPassword(member)} style={actionBtnStyle('#6b7280')}>Reset PW</button>
                        )}
                        <button onClick={() => handleToggleActive(member)}
                          style={actionBtnStyle(member.active ? '#ef4444' : '#10b981')}>
                          {member.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>No staff found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Employee Modal ── */}
      {showAddForm && (
        <Modal title="Add New Employee" onClose={() => setShowAddForm(false)}>
          <form onSubmit={handleAddStaff}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Field label="First Name *" value={addForm.firstName} onChange={v => setAddForm({ ...addForm, firstName: v })} required />
              <Field label="Last Name *" value={addForm.lastName} onChange={v => setAddForm({ ...addForm, lastName: v })} required />
            </div>
            <Field label="Email *" type="email" value={addForm.email} onChange={v => setAddForm({ ...addForm, email: v })} required />
            <Field label="Phone" type="tel" value={addForm.phone} onChange={v => setAddForm({ ...addForm, phone: v })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <SelectField label="Role *" value={addForm.staffRole} options={ROLES} onChange={v => setAddForm({ ...addForm, staffRole: v })} />
              <SelectField label="Department *" value={addForm.department} options={DEPARTMENTS} onChange={v => setAddForm({ ...addForm, department: v })} />
            </div>
            <Field label="Title" value={addForm.title} onChange={v => setAddForm({ ...addForm, title: v })} placeholder="e.g. Lead Technician" />
            <Field label="Hire Date" type="date" value={addForm.hireDate} onChange={v => setAddForm({ ...addForm, hireDate: v })} />
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <SubmitBtn label={saving ? 'Adding...' : 'Add Employee'} disabled={saving} />
              <CancelBtn onClick={() => setShowAddForm(false)} />
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit Employee Modal ── */}
      {editingStaff && (
        <Modal title={`Edit — ${editingStaff.firstName} ${editingStaff.lastName}`} onClose={() => setEditingStaff(null)} wide={editTab === 'access'}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #374151' }}>
            <button type="button" onClick={() => setEditTab('details')} style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
              color: editTab === 'details' ? '#f59e0b' : '#6b7280',
              borderBottom: editTab === 'details' ? '2px solid #f59e0b' : '2px solid transparent',
            }}>Details</button>
            <button type="button" onClick={() => setEditTab('access')} style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
              color: editTab === 'access' ? '#f59e0b' : '#6b7280',
              borderBottom: editTab === 'access' ? '2px solid #f59e0b' : '2px solid transparent',
            }}>
              Portal Access
              {Object.keys(portalOverrides).length > 0 && (
                <span style={{ marginLeft: 6, padding: '1px 7px', borderRadius: 10, backgroundColor: '#8b5cf6', color: '#fff', fontSize: 11 }}>
                  {Object.keys(portalOverrides).length}
                </span>
              )}
            </button>
          </div>

          <form onSubmit={handleEditStaff}>
            {/* ── Details Tab ── */}
            {editTab === 'details' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <Field label="First Name" value={editForm.firstName} onChange={v => setEditForm({ ...editForm, firstName: v })} required />
                  <Field label="Last Name" value={editForm.lastName} onChange={v => setEditForm({ ...editForm, lastName: v })} required />
                </div>
                <Field label="Email" type="email" value={editForm.email} onChange={v => setEditForm({ ...editForm, email: v })} required />
                <Field label="Phone" type="tel" value={editForm.phone} onChange={v => setEditForm({ ...editForm, phone: v })} />

                {/* Role & Department */}
                <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 12, padding: 20, margin: '20px 0' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#93c5fd' }}>Role &amp; Department</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <SelectField label="Role" value={editForm.role} options={ROLES} onChange={v => {
                      setEditForm({ ...editForm, role: v })
                      // Clear overrides that now match the new role's defaults
                      setPortalOverrides(prev => {
                        const cleaned: Record<string, boolean> = {}
                        for (const [route, val] of Object.entries(prev)) {
                          const newDefault = (ROUTE_DEFAULTS[route] || []).includes(v)
                          if (val !== newDefault) cleaned[route] = val
                        }
                        return cleaned
                      })
                    }} />
                    <SelectField label="Department" value={editForm.department} options={DEPARTMENTS} onChange={v => setEditForm({ ...editForm, department: v })} />
                  </div>
                  <p style={{ margin: '12px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                    The role sets default portal access. Use the <strong style={{ color: '#a78bfa' }}>Portal Access</strong> tab to customize individual portals.
                  </p>
                </div>

                <Field label="Title" value={editForm.title} onChange={v => setEditForm({ ...editForm, title: v })} placeholder="e.g. Lead Technician" />
                <Field label="Hire Date" type="date" value={editForm.hireDate} onChange={v => setEditForm({ ...editForm, hireDate: v })} />

                {/* Active toggle */}
                <div style={{ marginTop: 16, padding: '12px 16px', backgroundColor: editForm.active ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${editForm.active ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: editForm.active ? '#10b981' : '#ef4444' }}>
                      {editForm.active ? 'Active' : 'Deactivated'}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {editForm.active ? 'Employee can log in and access the portal.' : 'Employee cannot log in.'}
                    </div>
                  </div>
                  <button type="button" onClick={() => setEditForm({ ...editForm, active: !editForm.active })}
                    style={{ padding: '6px 16px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', backgroundColor: editForm.active ? '#ef4444' : '#10b981', color: '#fff' }}>
                    {editForm.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>

                {editingStaff.handbookSignedAt && (
                  <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>
                    Handbook signed: {new Date(editingStaff.handbookSignedAt).toLocaleDateString()}
                    {editingStaff.handbookVersion && ` (${editingStaff.handbookVersion})`}
                  </div>
                )}
              </>
            )}

            {/* ── Portal Access Tab ── */}
            {editTab === 'access' && (
              <div>
                <div style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#93c5fd' }}>
                        Role: {ROLES.find(r => r.value === editForm.role)?.label || editForm.role}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Toggle switches to grant or revoke access beyond the role default. Changes highlighted in purple are custom overrides.
                      </div>
                    </div>
                    {Object.keys(portalOverrides).length > 0 && (
                      <button type="button" onClick={() => setPortalOverrides({})} style={{
                        padding: '5px 12px', borderRadius: 6, border: '1px solid #374151',
                        backgroundColor: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer',
                      }}>
                        Reset All to Default
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
                  {PORTAL_GROUPS.map(group => (
                    <div key={group.label} style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, paddingLeft: 4 }}>
                        {group.label}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {group.portals.map(portal => {
                          const state = getAccessState(portal.route)
                          const isOn = state === 'default-on' || state === 'override-on'
                          const isOverride = state === 'override-on' || state === 'override-off'

                          return (
                            <div key={portal.route}
                              onClick={() => togglePortalAccess(portal.route)}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                                backgroundColor: isOverride ? 'rgba(139,92,246,0.08)' : '#111827',
                                border: `1px solid ${isOverride ? 'rgba(139,92,246,0.3)' : '#1f2937'}`,
                                transition: 'all 0.15s',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, color: isOn ? '#fff' : '#6b7280', fontWeight: isOverride ? 600 : 400 }}>
                                  {portal.label}
                                </span>
                                {isOverride && (
                                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, backgroundColor: '#8b5cf6', color: '#fff', fontWeight: 700 }}>
                                    CUSTOM
                                  </span>
                                )}
                              </div>
                              {/* Toggle switch */}
                              <div style={{
                                width: 36, height: 20, borderRadius: 10, position: 'relative',
                                backgroundColor: isOn ? (isOverride ? '#8b5cf6' : '#10b981') : '#374151',
                                transition: 'background-color 0.2s',
                              }}>
                                <div style={{
                                  width: 16, height: 16, borderRadius: 8, position: 'absolute',
                                  top: 2, left: isOn ? 18 : 2,
                                  backgroundColor: '#fff', transition: 'left 0.2s',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div style={{ marginTop: 16, padding: '10px 14px', backgroundColor: '#111827', borderRadius: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#6b7280' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#10b981' }} /> Role default (on)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#374151' }} /> Role default (off)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#8b5cf6' }} /> Custom override
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <SubmitBtn label={saving ? 'Saving...' : 'Save Changes'} disabled={saving} />
              <CancelBtn onClick={() => setEditingStaff(null)} />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Reusable Components ──

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#1f2937', borderRadius: 16, padding: 32, maxWidth: wide ? 740 : 560, width: '100%', border: '1px solid #374151', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#fff' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        placeholder={placeholder} style={inputStyle} />
    </div>
  )
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, appearance: 'auto' as const }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function SubmitBtn({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled} style={{
      flex: 1, padding: '10px 20px', backgroundColor: disabled ? '#374151' : '#f59e0b',
      color: disabled ? '#6b7280' : '#000', border: 'none', borderRadius: 8,
      fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{label}</button>
  )
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, padding: '10px 20px', backgroundColor: '#374151', color: '#fff',
      border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer',
    }}>Cancel</button>
  )
}

function actionBtnStyle(bg: string): React.CSSProperties {
  return {
    padding: '4px 10px', backgroundColor: bg, color: '#fff', border: 'none',
    borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  }
}
