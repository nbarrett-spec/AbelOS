'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { ListChecks } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'

const REASONS = [
  { value: 'VACATION', label: 'Vacation', icon: '🏖️' },
  { value: 'SICK_LEAVE', label: 'Sick Leave', icon: '🤒' },
  { value: 'PARENTAL_LEAVE', label: 'Parental Leave', icon: '👶' },
  { value: 'TRAINING', label: 'Training', icon: '📚' },
  { value: 'BUSINESS_TRIP', label: 'Business Trip', icon: '✈️' },
  { value: 'OTHER', label: 'Other', icon: '📋' },
]

const SCOPES = [
  { value: 'ALL', label: 'All Responsibilities' },
  { value: 'JOBS_ONLY', label: 'Jobs & Projects Only' },
  { value: 'APPROVALS_ONLY', label: 'Approvals Only' },
  { value: 'COMMUNICATIONS_ONLY', label: 'Communications Only' },
]

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: 'bg-green-100', text: 'text-green-700' },
  SCHEDULED: { bg: 'bg-blue-100', text: 'text-blue-700' },
  COMPLETED: { bg: 'bg-gray-100', text: 'text-gray-600' },
  CANCELLED: { bg: 'bg-red-100', text: 'text-red-600' },
}

interface Staff {
  id: string; firstName: string; lastName: string; role: string; department: string; email: string; title: string | null; active: boolean
}

interface Delegation {
  id: string; delegatorId: string; delegateId: string; startDate: string; endDate: string
  reason: string; scope: string; notes: string | null; status: string
  delegatorName: string; delegatorRole: string; delegatorDepartment: string; delegatorEmail: string
  delegateName: string; delegateRole: string; delegateDepartment: string; delegateEmail: string
  createdByName: string; createdAt: string
}

export default function DelegationsPage() {
  const { addToast } = useToast()
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  // Create form
  const [delegatorId, setDelegatorId] = useState('')
  const [delegateId, setDelegateId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('VACATION')
  const [scope, setScope] = useState('ALL')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/delegations')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setDelegations(data.delegations || [])
      setStaffList(data.staffList || [])
      setStats(data.stats || {})
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function createDelegation() {
    if (!delegatorId || !delegateId || !startDate || !endDate) return
    setSaving(true)
    try {
      const res = await fetch('/api/ops/delegations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegatorId, delegateId, startDate, endDate, reason, scope, notes: notes || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setShowCreate(false)
      resetForm()
      loadData()
    } catch (e: any) {
      addToast({ type: 'error', title: 'Creation Failed', message: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function cancelDelegation(id: string) {
    if (!confirm('Cancel this delegation?')) return
    try {
      await fetch(`/api/ops/delegations/${id}`, { method: 'DELETE' })
      loadData()
    } catch (e) { console.error(e) }
  }

  function resetForm() {
    setDelegatorId(''); setDelegateId(''); setStartDate(''); setEndDate('')
    setReason('VACATION'); setScope('ALL'); setNotes('')
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function daysRemaining(endDate: string) {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return diff
  }

  const filtered = delegations.filter(d => {
    if (filter === 'all') return true
    return d.status === filter
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-surface-elev border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workload Delegation"
        description="Manage vacation coverage, out-of-office handoffs, and workload transfers"
        crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Delegations' }]}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-signal text-white rounded-lg text-sm font-medium hover:bg-signal-hover transition flex items-center gap-2"
          >
            <span>+</span> New Delegation
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-2xl font-semibold text-gray-900">{stats.total || 0}</p>
          <p className="text-[10px] text-gray-500 uppercase font-medium">Total</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <p className="text-2xl font-semibold text-green-700">{stats.active || 0}</p>
          <p className="text-[10px] text-green-600 uppercase font-medium">Active Now</p>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <p className="text-2xl font-semibold text-blue-700">{stats.scheduled || 0}</p>
          <p className="text-[10px] text-blue-600 uppercase font-medium">Scheduled</p>
        </div>
        <div className="bg-gray-50 rounded-lg border p-4">
          <p className="text-2xl font-semibold text-gray-600">{stats.completed || 0}</p>
          <p className="text-[10px] text-gray-500 uppercase font-medium">Completed</p>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <p className="text-2xl font-semibold text-red-600">{stats.cancelled || 0}</p>
          <p className="text-[10px] text-red-500 uppercase font-medium">Cancelled</p>
        </div>
      </div>

      {/* Active Coverage Banner */}
      {delegations.filter(d => d.status === 'ACTIVE').length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> Active Coverage Right Now
          </h3>
          <div className="space-y-2">
            {delegations.filter(d => d.status === 'ACTIVE').map(d => (
              <div key={d.id} className="flex items-center gap-3 text-sm text-green-800">
                <span className="font-medium">{d.delegateName}</span>
                <span className="text-green-600">is covering for</span>
                <span className="font-medium">{d.delegatorName}</span>
                <span className="text-green-500">({REASONS.find(r => r.value === d.reason)?.label || d.reason})</span>
                <span className="text-green-500 ml-auto">{daysRemaining(d.endDate)} days remaining</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: 'all', label: 'All' },
          { key: 'ACTIVE', label: 'Active' },
          { key: 'SCHEDULED', label: 'Scheduled' },
          { key: 'COMPLETED', label: 'Completed' },
          { key: 'CANCELLED', label: 'Cancelled' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              filter === f.key ? 'border-signal text-signal' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Delegation List */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="w-8 h-8 text-fg-subtle" />}
            title="No delegations found"
            description="Create a new delegation to set up workload coverage"
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Out of Office</th>
                <th className="px-4 py-3 font-medium text-gray-600">Covered By</th>
                <th className="px-4 py-3 font-medium text-gray-600">Dates</th>
                <th className="px-4 py-3 font-medium text-gray-600">Reason</th>
                <th className="px-4 py-3 font-medium text-gray-600">Scope</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const reasonInfo = REASONS.find(r => r.value === d.reason)
                return (
                  <tr key={d.id} className="border-t hover:bg-blue-50/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{d.delegatorName}</div>
                      <div className="text-xs text-gray-500">{d.delegatorRole?.replace(/_/g, ' ')} &middot; {d.delegatorDepartment}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{d.delegateName}</div>
                      <div className="text-xs text-gray-500">{d.delegateRole?.replace(/_/g, ' ')} &middot; {d.delegateDepartment}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{formatDate(d.startDate)}</div>
                      <div className="text-xs text-gray-500">to {formatDate(d.endDate)}</div>
                      {d.status === 'ACTIVE' && (
                        <div className="text-xs text-green-600 font-medium mt-0.5">{daysRemaining(d.endDate)} days left</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span>{reasonInfo?.icon || '📋'}</span>
                        <span className="text-gray-700">{reasonInfo?.label || d.reason}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {SCOPES.find(s => s.value === d.scope)?.label || d.scope}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getStatusBadgeVariant(d.status)}>{d.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {(d.status === 'SCHEDULED' || d.status === 'ACTIVE') && (
                        <button
                          onClick={() => cancelDelegation(d.id)}
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900 text-lg">New Workload Delegation</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Delegator */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Who is out of office?</label>
                <select value={delegatorId} onChange={e => setDelegatorId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-signal focus:border-signal">
                  <option value="">Select staff member...</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName} — {s.role.replace(/_/g, ' ')} ({s.department})
                    </option>
                  ))}
                </select>
              </div>

              {/* Delegate */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Who will cover their work?</label>
                <select value={delegateId} onChange={e => setDelegateId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-signal focus:border-signal">
                  <option value="">Select covering staff...</option>
                  {staffList.filter(s => s.id !== delegatorId).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName} — {s.role.replace(/_/g, ' ')} ({s.department})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Reason & Scope */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <select value={reason} onChange={e => setReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {REASONS.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Coverage Scope</label>
                  <select value={scope} onChange={e => setScope(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={2} placeholder="Special instructions for coverage..."
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 rounded-b-xl flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 text-sm hover:bg-gray-200 rounded-lg">Cancel</button>
              <button
                onClick={createDelegation}
                disabled={saving || !delegatorId || !delegateId || !startDate || !endDate}
                className="px-4 py-2 bg-signal text-white rounded-lg text-sm font-medium hover:bg-signal-hover disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Delegation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
