'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/formatting'
import Link from 'next/link'

interface Deal {
  id: string
  dealNumber: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  address: string
  city: string
  state: string
  zip: string
  source: string
  stage: string
  probability: number
  dealValue: number
  expectedCloseDate: string
  createdAt: string
  ownerId: string
  owner: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
  activities: DealActivity[]
  contracts: Contract[]
  documentRequests: DocumentRequest[]
}

interface DealActivity {
  id: string
  type: string
  subject: string
  notes: string
  outcome: string
  followUpDate?: string
  followUpDone: boolean
  createdAt: string
  staff: {
    id: string
    firstName: string
    lastName: string
  }
}

interface Contract {
  id: string
  contractNumber: string
  title: string
  type: string
  status: string
  startDate: string
  endDate: string
}

interface DocumentRequest {
  id: string
  documentType: string
  title: string
  status: string
  dueDate: string
  receivedDate?: string
}

const STAGE_NAMES: Record<string, string> = {
  PROSPECT: 'Prospect',
  DISCOVERY: 'Discovery',
  WALKTHROUGH: 'Walkthrough',
  BID_SUBMITTED: 'Bid Submitted',
  BID_REVIEW: 'Bid Review',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  ONBOARDED: 'Onboarded',
}

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: 'bg-gray-100 text-gray-800',
  DISCOVERY: 'bg-blue-100 text-blue-800',
  WALKTHROUGH: 'bg-indigo-100 text-indigo-800',
  BID_SUBMITTED: 'bg-yellow-100 text-yellow-800',
  BID_REVIEW: 'bg-orange-100 text-orange-800',
  NEGOTIATION: 'bg-purple-100 text-purple-800',
  WON: 'bg-green-100 text-green-800',
  LOST: 'bg-red-100 text-red-800',
  ONBOARDED: 'bg-emerald-100 text-emerald-800',
}

const ACTIVITY_ICONS: Record<string, string> = {
  CALL: '📞',
  EMAIL: '📧',
  MEETING: '📅',
  SITE_VISIT: '📍',
  TEXT: '💬',
  NOTE: '📝',
  STAGE_CHANGE: '🔄',
  BID_SENT: '📤',
  BID_REVISED: '📤',
  CONTRACT_SENT: '📋',
  CONTRACT_SIGNED: '✅',
  DOCUMENT_REQUESTED: '📄',
  DOCUMENT_RECEIVED: '📄',
  FOLLOW_UP: '⏰',
}

const STAGE_PROBABILITIES: Record<string, number> = {
  PROSPECT: 10, DISCOVERY: 20, WALKTHROUGH: 35, BID_SUBMITTED: 50,
  BID_REVIEW: 60, NEGOTIATION: 75, WON: 100, LOST: 0, ONBOARDED: 100,
}

function safeDateFormat(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

export default function DealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const dealId = params.id as string

  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [showStageDropdown, setShowStageDropdown] = useState(false)
  const [activeTab, setActiveTab] = useState<'activities' | 'contracts' | 'documents'>('activities')
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [newActivity, setNewActivity] = useState({
    type: 'CALL',
    subject: '',
    notes: '',
    outcome: '',
    followUpDate: '',
  })
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const fetchDeal = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/ops/sales/deals/${dealId}`)
      if (!response.ok) throw new Error('Failed to fetch deal')
      const data = await response.json()
      setDeal(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDeal()
  }, [dealId])

  const handleStageChange = async (newStage: string) => {
    const payload: any = {
      stage: newStage,
      probability: STAGE_PROBABILITIES[newStage] ?? deal?.probability,
    }
    if (newStage === 'WON') payload.actualCloseDate = new Date().toISOString()
    if (newStage === 'LOST') payload.lostDate = new Date().toISOString()

    try {
      const response = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('Failed to update stage')
      await fetchDeal()
      setShowStageDropdown(false)
    } catch (err) {
      showToast('Error updating stage: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error')
    }
  }

  const handleMarkWon = () => handleStageChange('WON')
  const handleMarkLost = () => handleStageChange('LOST')

  const handleAssignToMe = async () => {
    try {
      const meRes = await fetch('/api/ops/auth/me')
      if (!meRes.ok) return
      const meData = await meRes.json()
      const myId = meData.staff?.id || meData.id
      if (!myId) return
      const response = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: myId }),
      })
      if (!response.ok) throw new Error('Failed to assign deal')
      await fetchDeal()
    } catch (err) {
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error')
    }
  }

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch(`/api/ops/sales/deals/${dealId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newActivity,
          followUpDate: newActivity.followUpDate || undefined,
        }),
      })
      if (!response.ok) throw new Error('Failed to add activity')
      await fetchDeal()
      setShowAddActivity(false)
      setNewActivity({ type: 'CALL', subject: '', notes: '', outcome: '', followUpDate: '' })
    } catch (err) {
      showToast('Error adding activity: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error')
    }
  }

  const calculateDaysInPipeline = (createdAt: string): number => {
    const created = new Date(createdAt)
    const now = new Date()
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C6A24E]" />
      </div>
    )
  }

  if (error || !deal) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h2 className="text-lg font-bold text-red-700">Error</h2>
        <p className="text-red-600">{error || 'Deal not found'}</p>
        <Link href="/sales/deals" className="text-red-700 hover:text-red-800 font-medium mt-4 inline-block">
          Back to Deals
        </Link>
      </div>
    )
  }

  const daysInPipeline = calculateDaysInPipeline(deal.createdAt)
  const stageColor = STAGE_COLORS[deal.stage] || 'bg-gray-100 text-gray-800'
  const ownerName = deal.owner ? `${deal.owner.firstName || ''} ${deal.owner.lastName || ''}`.trim() : '—'

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
        }`}>
          {toast}
        </div>
      )}
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/sales" className="hover:text-gray-700">Sales</Link>
        {' / '}
        <Link href="/sales/deals" className="hover:text-gray-700">My Deals</Link>
        {' / '}
        <span className="text-gray-900 font-medium">{deal.companyName}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{deal.companyName}</h1>
            <div className="space-y-1 text-sm text-gray-600">
              {deal.contactPhone && <div>📞 {deal.contactPhone}</div>}
              {deal.contactEmail && <div>📧 {deal.contactEmail}</div>}
              {deal.address && <div>📍 {deal.address}{deal.city ? `, ${deal.city}` : ''}{deal.state ? `, ${deal.state}` : ''} {deal.zip || ''}</div>}
            </div>
            <div className="text-xs text-gray-400 mt-3">Deal #{deal.dealNumber}</div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <span className={`inline-block px-4 py-2 rounded-full font-semibold text-sm ${stageColor}`}>
              {STAGE_NAMES[deal.stage] || deal.stage}
            </span>
            <div className="flex gap-2 flex-wrap justify-end">
              {deal.stage !== 'WON' && deal.stage !== 'LOST' && (
                <>
                  <button onClick={handleMarkWon} className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition">
                    Mark Won
                  </button>
                  <button onClick={handleMarkLost} className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium transition">
                    Mark Lost
                  </button>
                </>
              )}
              <button onClick={handleAssignToMe} className="px-3 py-2 bg-[#C6A24E] text-white rounded-lg hover:bg-[#d46711] text-sm font-medium transition">
                Assign to Me
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowStageDropdown(!showStageDropdown)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium text-sm transition"
                >
                  Change Stage
                </button>
                {showStageDropdown && (
                  <div className="absolute right-0 top-10 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                    {Object.entries(STAGE_NAMES).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => handleStageChange(key)}
                        className="block w-full text-left px-4 py-2 hover:bg-gray-50 border-b last:border-b-0 text-sm"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Deal Value</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(deal.dealValue)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Win Probability</p>
          <p className="text-2xl font-bold text-gray-900">{deal.probability}%</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Expected Close</p>
          <p className="text-2xl font-bold text-gray-900">{safeDateFormat(deal.expectedCloseDate)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Days in Pipeline</p>
          <p className="text-2xl font-bold text-gray-900">{daysInPipeline}</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Action Buttons */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-900 mb-3 text-sm">Quick Actions</h3>
            <div className="flex gap-2 flex-wrap">
              {[
                { type: 'CALL', label: '📞 Log Call' },
                { type: 'EMAIL', label: '📧 Log Email' },
                { type: 'MEETING', label: '📅 Log Meeting' },
                { type: 'SITE_VISIT', label: '📍 Site Visit' },
                { type: 'NOTE', label: '📝 Add Note' },
              ].map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => {
                    setNewActivity({ ...newActivity, type })
                    setShowAddActivity(true)
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm transition"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">Activity Timeline</h2>
              {!showAddActivity && (
                <button
                  onClick={() => setShowAddActivity(true)}
                  className="px-3 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1a2f4e] text-sm font-medium transition"
                >
                  + Add Activity
                </button>
              )}
            </div>

            {showAddActivity && (
              <form onSubmit={handleAddActivity} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={newActivity.type}
                    onChange={(e) => setNewActivity({ ...newActivity, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                  >
                    {Object.entries(ACTIVITY_ICONS).map(([key]) => (
                      <option key={key} value={key}>{key.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={newActivity.subject}
                    onChange={(e) => setNewActivity({ ...newActivity, subject: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={newActivity.notes}
                    onChange={(e) => setNewActivity({ ...newActivity, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outcome</label>
                  <input
                    type="text"
                    value={newActivity.outcome}
                    onChange={(e) => setNewActivity({ ...newActivity, outcome: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Date (Optional)</label>
                  <input
                    type="date"
                    value={newActivity.followUpDate}
                    onChange={(e) => setNewActivity({ ...newActivity, followUpDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 px-3 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1a2f4e] font-medium">
                    Add Activity
                  </button>
                  <button type="button" onClick={() => setShowAddActivity(false)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Activities */}
            <div className="space-y-4">
              {deal.activities && deal.activities.length > 0 ? (
                [...deal.activities].reverse().map((activity) => (
                  <div key={activity.id} className="flex gap-4 pb-4 border-b border-gray-200 last:border-b-0">
                    <div className="text-2xl flex-shrink-0">
                      {ACTIVITY_ICONS[activity.type] || '📌'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{activity.subject}</p>
                      {activity.notes && <p className="text-sm text-gray-600 mt-1">{activity.notes}</p>}
                      {activity.outcome && <p className="text-sm text-gray-600">Outcome: {activity.outcome}</p>}
                      {activity.followUpDate && !activity.followUpDone && (
                        <p className="text-sm text-signal mt-1">Follow-up: {safeDateFormat(activity.followUpDate)}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        {safeDateFormat(activity.createdAt)} by {activity.staff ? `${activity.staff.firstName || ''} ${activity.staff.lastName || ''}`.trim() : '—'}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500 py-8">No activities yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Contact Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Contact</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-1">Primary Contact</p>
                <p className="font-semibold text-gray-900">{deal.contactName}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Email</p>
                {deal.contactEmail ? (
                  <a href={`mailto:${deal.contactEmail}`} className="text-[#C6A24E] hover:text-[#A8882A] font-medium">
                    {deal.contactEmail}
                  </a>
                ) : <p className="text-gray-400">—</p>}
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Phone</p>
                {deal.contactPhone ? (
                  <a href={`tel:${deal.contactPhone}`} className="text-[#C6A24E] hover:text-[#A8882A] font-medium">
                    {deal.contactPhone}
                  </a>
                ) : <p className="text-gray-400">—</p>}
              </div>
            </div>
          </div>

          {/* Deal Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Deal Info</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-1">Source</p>
                <p className="font-semibold text-gray-900">{deal.source || '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Sales Rep</p>
                <p className="font-semibold text-gray-900">{ownerName || '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Created</p>
                <p className="font-semibold text-gray-900">{safeDateFormat(deal.createdAt)}</p>
              </div>
            </div>
          </div>

          {/* Contracts */}
          {deal.contracts && deal.contracts.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-4">Contracts</h3>
              <div className="space-y-2">
                {deal.contracts.map((contract) => (
                  <div key={contract.id} className="p-3 border border-gray-200 rounded-lg">
                    <p className="font-semibold text-gray-900 text-sm">{contract.title || contract.type}</p>
                    <p className="text-xs text-gray-500 mt-1">{contract.contractNumber}</p>
                    <span className="text-xs px-2 py-0.5 rounded mt-2 inline-block bg-blue-100 text-blue-800">
                      {contract.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Document Requests */}
          {deal.documentRequests && deal.documentRequests.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-4">Documents</h3>
              <div className="space-y-2">
                {deal.documentRequests.map((doc) => (
                  <div key={doc.id} className="p-3 border border-gray-200 rounded-lg">
                    <p className="font-semibold text-gray-900 text-sm">{doc.title || doc.documentType}</p>
                    <p className="text-xs text-gray-500 mt-1">Due: {safeDateFormat(doc.dueDate)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded mt-2 inline-block ${
                      doc.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                      doc.status === 'OVERDUE' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {doc.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
