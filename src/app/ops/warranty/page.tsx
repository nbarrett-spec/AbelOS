'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

interface WarrantyClaim {
  id: string
  claimNumber: string
  type: string
  status: string
  priority: string
  subject: string
  description: string
  productName: string | null
  contactName: string | null
  contactEmail: string | null
  siteAddress: string | null
  siteCity: string | null
  assignedTo: string | null
  assignedToName: string | null
  submittedByName: string | null
  resolutionType: string | null
  resolutionCost: number
  creditAmount: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

interface Stats {
  total: number
  submitted: number
  under_review: number
  inspection_scheduled: number
  approved: number
  in_progress: number
  resolved: number
  denied: number
  closed: number
  urgent: number
  total_cost: number
  total_credits: number
}

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-800',
  UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
  INSPECTION_SCHEDULED: 'bg-purple-100 text-purple-800',
  APPROVED: 'bg-green-100 text-green-800',
  IN_PROGRESS: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  DENIED: 'bg-red-100 text-red-800',
  CLOSED: 'bg-gray-100 text-gray-800',
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  INSPECTION_SCHEDULED: 'Inspection Scheduled',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  DENIED: 'Denied',
  CLOSED: 'Closed',
}

const TYPE_ICONS: Record<string, string> = {
  PRODUCT: '📦',
  MATERIAL: '🪵',
  INSTALLATION: '🔧',
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'text-red-600 font-bold',
  HIGH: 'text-orange-600 font-semibold',
  MEDIUM: 'text-gray-600',
  LOW: 'text-gray-400',
}

export default function WarrantyDashboard() {
  const [claims, setClaims] = useState<WarrantyClaim[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [showNewClaimModal, setShowNewClaimModal] = useState(false)
  const [selectedClaim, setSelectedClaim] = useState<WarrantyClaim | null>(null)
  const [staffList, setStaffList] = useState<{id:string; name:string}[]>([])
  const [editPriority, setEditPriority] = useState('')
  const [editAssignedTo, setEditAssignedTo] = useState('')
  const [editResType, setEditResType] = useState('')
  const [editResCost, setEditResCost] = useState('')
  const [editCredit, setEditCredit] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    fetchClaims()
  }, [statusFilter, typeFilter, search])

  useEffect(() => {
    fetch('/api/ops/staff').then(r => r.json()).then(data => {
      const list = (data.staff || data || []).map((s: any) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
      }))
      setStaffList(list)
    }).catch(() => {})
  }, [])

  const fetchClaims = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (typeFilter !== 'ALL') params.set('type', typeFilter)
      if (search) params.set('search', search)

      const res = await fetch(`/api/ops/warranty/claims?${params}`)
      if (res.ok) {
        const data = await res.json()
        setClaims(data.claims || [])
        setStats(data.stats || null)
      }
    } catch (error) {
      console.error('Failed to fetch claims:', error)
    } finally {
      setLoading(false)
    }
  }

  const openClaimDetail = (claim: WarrantyClaim) => {
    setSelectedClaim(claim)
    setEditPriority(claim.priority)
    setEditAssignedTo(claim.assignedTo || '')
    setEditResType(claim.resolutionType || '')
    setEditResCost(String(claim.resolutionCost || ''))
    setEditCredit(String(claim.creditAmount || ''))
    setEditNotes('')
  }

  const handleSaveEdits = async () => {
    if (!selectedClaim) return
    setSaving(true)
    try {
      const payload: any = {}
      if (editPriority !== selectedClaim.priority) payload.priority = editPriority
      if (editAssignedTo !== (selectedClaim.assignedTo || '')) payload.assignedTo = editAssignedTo || null
      if (editResType !== (selectedClaim.resolutionType || '')) payload.resolutionType = editResType || null
      if (editResCost !== String(selectedClaim.resolutionCost || '')) payload.resolutionCost = parseFloat(editResCost) || 0
      if (editCredit !== String(selectedClaim.creditAmount || '')) payload.creditAmount = parseFloat(editCredit) || 0
      if (editNotes.trim()) payload.internalNotes = editNotes

      if (Object.keys(payload).length === 0) {
        showToast('No changes to save')
        setSaving(false)
        return
      }

      const res = await fetch(`/api/ops/warranty/claims/${selectedClaim.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        showToast('Claim updated')
        fetchClaims()
        setSelectedClaim(null)
      } else {
        const data = await res.json()
        showToast(data.error || 'Failed to update', 'error')
      }
    } catch {
      showToast('Failed to update claim', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (claimId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/ops/warranty/claims/${claimId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (res.ok) {
        fetchClaims()
        setSelectedClaim(null)
      } else {
        const data = await res.json()
        showToast(data.error || 'Failed to update status', 'error')
      }
    } catch (error) {
      console.error('Status update failed:', error)
    }
  }

  const handleCreateClaim = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload: Record<string, any> = {}
    form.forEach((val, key) => { if (val) payload[key] = val })

    // Validate format fields
    if (payload.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contactEmail)) {
      showToast('Please enter a valid email address', 'error'); return
    }
    if (payload.contactPhone && !/^(\+1)?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(payload.contactPhone)) {
      showToast('Please enter a valid phone number', 'error'); return
    }
    if (payload.siteZip && !/^\d{5}(-\d{4})?$/.test(payload.siteZip)) {
      showToast('Please enter a valid ZIP code', 'error'); return
    }

    try {
      const res = await fetch('/api/ops/warranty/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setShowNewClaimModal(false)
        fetchClaims()
      }
    } catch (error) {
      console.error('Create claim failed:', error)
    }
  }

  const openCount = stats ? Number(stats.submitted || 0) + Number(stats.under_review || 0) + Number(stats.inspection_scheduled || 0) + Number(stats.approved || 0) + Number(stats.in_progress || 0) : 0

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-surface-elevated'
        }`}>
          {toast}
        </div>
      )}
      <PageHeader
        title="Warranty Center"
        description="Manage warranty claims, policies, and inspections"
        actions={
          <>
            <Link
              href="/ops/warranty/policies"
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Manage Policies
            </Link>
            <button
              onClick={() => setShowNewClaimModal(true)}
              className="px-4 py-2 bg-signal text-white rounded-lg text-sm font-medium hover:bg-signal-hover"
            >
              + New Claim
            </button>
          </>
        }
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">Open Claims</p>
            <p className="text-2xl font-semibold text-[#1B2A4A]">{openCount}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">Submitted</p>
            <p className="text-2xl font-semibold text-blue-600">{Number(stats.submitted || 0)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">In Progress</p>
            <p className="text-2xl font-semibold text-orange-600">{Number(stats.in_progress || 0) + Number(stats.under_review || 0)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">Resolved</p>
            <p className="text-2xl font-semibold text-emerald-600">{Number(stats.resolved || 0)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">Urgent</p>
            <p className="text-2xl font-semibold text-red-600">{Number(stats.urgent || 0)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">Total Cost</p>
            <p className="text-2xl font-semibold text-gray-900">${Number(stats.total_cost || 0).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="ALL">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="ALL">All Types</option>
              <option value="PRODUCT">Product Defect</option>
              <option value="MATERIAL">Material</option>
              <option value="INSTALLATION">Installation</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search claims..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-full"
            />
          </div>
        </div>
      </div>

      {/* Claims Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading claims...</div>
        ) : claims.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="w-8 h-8 text-fg-subtle" />}
            title="No warranty claims found"
            description="Claims submitted by builders or staff will appear here"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Claim #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Subject</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Assigned</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openClaimDetail(claim)}
                        className="text-signal hover:text-signal-hover font-medium text-sm"
                      >
                        {claim.claimNumber}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span>{TYPE_ICONS[claim.type] || '📋'} {claim.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-900 font-medium">{claim.subject}</p>
                      {claim.productName && (
                        <p className="text-xs text-gray-400">{claim.productName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700">{claim.contactName || '—'}</p>
                      <p className="text-xs text-gray-400">{claim.siteCity || ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm ${PRIORITY_COLORS[claim.priority] || ''}`}>
                        {claim.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[claim.status] || 'bg-gray-100'}`}>
                        {STATUS_LABELS[claim.status] || claim.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {claim.assignedToName || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(claim.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openClaimDetail(claim)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Claim Detail Modal */}
      {selectedClaim && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16 overflow-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{selectedClaim.claimNumber}</h3>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${STATUS_COLORS[selectedClaim.status]}`}>
                  {STATUS_LABELS[selectedClaim.status]}
                </span>
              </div>
              <button onClick={() => setSelectedClaim(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 font-medium">Type</p>
                  <p className="text-sm">{TYPE_ICONS[selectedClaim.type]} {selectedClaim.type}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium">Priority</p>
                  <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full">
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium">Contact</p>
                  <p className="text-sm">{selectedClaim.contactName || '—'}</p>
                  <p className="text-xs text-gray-400">{selectedClaim.contactEmail || ''}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium">Assigned To</p>
                  <select value={editAssignedTo} onChange={(e) => setEditAssignedTo(e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full">
                    <option value="">— Unassigned —</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Subject</p>
                <p className="text-sm font-medium">{selectedClaim.subject}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Description</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedClaim.description}</p>
              </div>
              {selectedClaim.productName && (
                <div>
                  <p className="text-xs text-gray-400 font-medium">Product</p>
                  <p className="text-sm">{selectedClaim.productName}</p>
                </div>
              )}
              {/* Resolution Details - Editable */}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Resolution Details</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Resolution Type</label>
                    <select value={editResType} onChange={(e) => setEditResType(e.target.value)}
                      className="border rounded px-2 py-1 text-sm w-full">
                      <option value="">None</option>
                      <option value="REPLACEMENT">Replacement</option>
                      <option value="REPAIR">Repair</option>
                      <option value="CREDIT">Credit</option>
                      <option value="REFUND">Refund</option>
                      <option value="NO_ACTION">No Action</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Cost ($)</label>
                    <input type="number" step="0.01" value={editResCost} onChange={(e) => setEditResCost(e.target.value)}
                      className="border rounded px-2 py-1 text-sm w-full" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Credit ($)</label>
                    <input type="number" step="0.01" value={editCredit} onChange={(e) => setEditCredit(e.target.value)}
                      className="border rounded px-2 py-1 text-sm w-full" placeholder="0.00" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-gray-400 mb-1">Internal Notes</label>
                  <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                    rows={2} className="border rounded px-2 py-1 text-sm w-full" placeholder="Add internal notes..." />
                </div>
                <button onClick={handleSaveEdits} disabled={saving}
                  className="mt-2 px-3 py-1.5 bg-surface-elevated text-white rounded text-xs font-medium hover:bg-surface disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Submitted</p>
                <p className="text-sm">{new Date(selectedClaim.createdAt).toLocaleString()} by {selectedClaim.submittedByName || 'Builder'}</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl">
              <p className="text-xs text-gray-500 mb-2">Update Status:</p>
              <div className="flex flex-wrap gap-2">
                {selectedClaim.status === 'SUBMITTED' && (
                  <>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'UNDER_REVIEW')} className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-medium hover:bg-yellow-600">Start Review</button>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'DENIED')} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600">Deny</button>
                  </>
                )}
                {selectedClaim.status === 'UNDER_REVIEW' && (
                  <>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'APPROVED')} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600">Approve</button>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'INSPECTION_SCHEDULED')} className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-medium hover:bg-purple-600">Schedule Inspection</button>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'DENIED')} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600">Deny</button>
                  </>
                )}
                {selectedClaim.status === 'INSPECTION_SCHEDULED' && (
                  <>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'APPROVED')} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600">Approve</button>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'DENIED')} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600">Deny</button>
                  </>
                )}
                {selectedClaim.status === 'APPROVED' && (
                  <>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'IN_PROGRESS')} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600">Start Work</button>
                    <button onClick={() => handleStatusChange(selectedClaim.id, 'RESOLVED')} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600">Resolve</button>
                  </>
                )}
                {selectedClaim.status === 'IN_PROGRESS' && (
                  <button onClick={() => handleStatusChange(selectedClaim.id, 'RESOLVED')} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600">Mark Resolved</button>
                )}
                {selectedClaim.status === 'RESOLVED' && (
                  <button onClick={() => handleStatusChange(selectedClaim.id, 'CLOSED')} className="px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:bg-gray-600">Close Claim</button>
                )}
                {selectedClaim.status === 'DENIED' && (
                  <button onClick={() => handleStatusChange(selectedClaim.id, 'UNDER_REVIEW')} className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-medium hover:bg-yellow-600">Reopen for Review</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Claim Modal */}
      {showNewClaimModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16 overflow-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">New Warranty Claim</h3>
              <button onClick={() => setShowNewClaimModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <form onSubmit={handleCreateClaim} className="px-6 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Warranty Type *</label>
                  <select name="type" required className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="PRODUCT">Product Defect</option>
                    <option value="MATERIAL">Material</option>
                    <option value="INSTALLATION">Installation/Workmanship</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select name="priority" className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
                <input name="subject" required className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Brief description of the issue" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                <textarea name="description" required rows={3} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Detailed description of the warranty issue..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                  <input name="productName" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., AGT Interior Door" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product SKU</label>
                  <input name="productSku" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., AGT-INT-001" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Install Date</label>
                  <input name="installDate" type="date" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Issue First Noticed</label>
                  <input name="issueDate" type="date" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="text-sm font-semibold text-gray-600 mb-3">Contact & Site Info</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                    <input name="contactName" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                    <input name="contactEmail" type="email" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                    <input name="contactPhone" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Site Address</label>
                  <input name="siteAddress" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-3 gap-4 mt-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input name="siteCity" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <input name="siteState" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                    <input name="siteZip" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={() => setShowNewClaimModal(false)} className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-signal text-white rounded-lg text-sm font-medium hover:bg-signal-hover">Submit Claim</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
