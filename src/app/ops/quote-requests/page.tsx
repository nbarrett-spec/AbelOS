'use client'

import { useState, useEffect } from 'react'

interface QuoteRequest {
  id: string
  builderId: string
  companyName?: string
  referenceNumber: string
  projectName: string
  projectAddress: string
  city?: string
  state?: string
  zip?: string
  description: string
  estimatedSquareFootage?: number
  productCategories: string[] | string
  preferredDeliveryDate?: string
  notes?: string
  status: string
  assignedTo?: string
  assignedToName?: string
  createdAt: string
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  NEW:       { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'New' },
  REVIEWING: { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Reviewing' },
  QUOTED:    { bg: 'bg-green-50',   text: 'text-green-700',   label: 'Quoted' },
  ACCEPTED:  { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Accepted' },
  DECLINED:  { bg: 'bg-red-50',     text: 'text-red-700',     label: 'Declined' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { bg: 'bg-gray-50', text: 'text-gray-700', label: status }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

export default function OpsQuoteRequestsPage() {
  const [requests, setRequests] = useState<QuoteRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<QuoteRequest | null>(null)
  const [updating, setUpdating] = useState(false)
  const [toast, setToast] = useState('')
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([])

  const fetchRequests = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    fetch(`/api/ops/quote-requests?${params}`)
      .then(r => r.json())
      .then(data => setRequests(data.quoteRequests || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRequests() }, [statusFilter])

  useEffect(() => {
    fetch('/api/ops/staff')
      .then(r => r.json())
      .then(data => {
        const list = (data.staff || data || []).map((s: any) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
        }))
        setStaffList(list)
      })
      .catch(() => {})
  }, [])

  const updateRequest = async (id: string, updates: Record<string, any>) => {
    setUpdating(true)
    try {
      const res = await fetch('/api/ops/quote-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
      if (res.ok) {
        setToast('Quote request updated')
        fetchRequests()
        if (selected?.id === id) {
          const data = await res.json()
          setSelected(data.quoteRequest || null)
        }
      } else {
        const err = await res.json()
        setToast(err.error || 'Update failed')
      }
    } catch {
      setToast('Failed to update')
    }
    setUpdating(false)
    setTimeout(() => setToast(''), 3000)
  }

  const categories = (qr: QuoteRequest) => {
    if (Array.isArray(qr.productCategories)) return qr.productCategories
    if (typeof qr.productCategories === 'string') {
      try { return JSON.parse(qr.productCategories) } catch { return [qr.productCategories] }
    }
    return []
  }

  const stats = {
    total: requests.length,
    new: requests.filter(r => r.status === 'NEW').length,
    reviewing: requests.filter(r => r.status === 'REVIEWING').length,
    quoted: requests.filter(r => r.status === 'QUOTED').length,
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#0f2a3e] text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2A4A]">Quote Requests</h1>
          <p className="text-gray-500 text-sm">Manage incoming builder quote requests</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-[#1B2A4A]">{stats.total}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Total Requests</div>
        </div>
        <div className="bg-white rounded-lg border p-4 border-l-4 border-l-blue-500">
          <div className="text-2xl font-bold text-blue-700">{stats.new}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">New</div>
        </div>
        <div className="bg-white rounded-lg border p-4 border-l-4 border-l-amber-500">
          <div className="text-2xl font-bold text-amber-700">{stats.reviewing}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Reviewing</div>
        </div>
        <div className="bg-white rounded-lg border p-4 border-l-4 border-l-green-500">
          <div className="text-2xl font-bold text-green-700">{stats.quoted}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Quoted</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm font-medium text-gray-600">Status:</label>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All</option>
          <option value="NEW">New</option>
          <option value="REVIEWING">Reviewing</option>
          <option value="QUOTED">Quoted</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DECLINED">Declined</option>
        </select>
      </div>

      {/* Table + Detail Panel */}
      <div className="flex gap-6">
        {/* Table */}
        <div className={`bg-white rounded-lg border overflow-hidden ${selected ? 'flex-1' : 'w-full'}`}>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-3 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-2">📋</div>
              <p className="font-medium">No quote requests found</p>
              <p className="text-sm">Requests from builders will appear here</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Builder</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Project</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Assigned</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {requests.map(qr => (
                  <tr
                    key={qr.id}
                    onClick={() => setSelected(qr)}
                    className={`cursor-pointer hover:bg-gray-50 transition ${selected?.id === qr.id ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{qr.referenceNumber}</td>
                    <td className="px-4 py-3 font-medium">{qr.companyName || '—'}</td>
                    <td className="px-4 py-3">
                      <div>{qr.projectName}</div>
                      <div className="text-xs text-gray-400">{qr.projectAddress}{qr.city ? `, ${qr.city}` : ''}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={qr.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{qr.assignedToName || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(qr.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-96 bg-white rounded-lg border p-5 sticky top-4 self-start">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[#1B2A4A]">Request Details</h3>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Reference & Status */}
              <div className="flex justify-between items-center">
                <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{selected.referenceNumber}</span>
                <StatusBadge status={selected.status} />
              </div>

              {/* Builder */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Builder</label>
                <p className="font-medium">{selected.companyName || 'Unknown'}</p>
              </div>

              {/* Project */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Project</label>
                <p className="font-medium">{selected.projectName}</p>
                <p className="text-gray-500 text-xs">
                  {selected.projectAddress}
                  {selected.city && `, ${selected.city}`}
                  {selected.state && `, ${selected.state}`}
                  {selected.zip && ` ${selected.zip}`}
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Description</label>
                <p className="text-gray-700 whitespace-pre-line">{selected.description}</p>
              </div>

              {/* Categories */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Product Categories</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {categories(selected).map((cat: string, i: number) => (
                    <span key={i} className="bg-[#0f2a3e] text-white text-xs px-2 py-0.5 rounded-full">
                      {cat}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sq Ft */}
              {selected.estimatedSquareFootage && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Est. Square Footage</label>
                  <p className="font-medium">{Number(selected.estimatedSquareFootage).toLocaleString()} sq ft</p>
                </div>
              )}

              {/* Preferred Delivery */}
              {selected.preferredDeliveryDate && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Preferred Delivery</label>
                  <p className="font-medium">{new Date(selected.preferredDeliveryDate).toLocaleDateString()}</p>
                </div>
              )}

              {/* Notes */}
              {selected.notes && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Notes</label>
                  <p className="text-gray-700 text-xs whitespace-pre-line">{selected.notes}</p>
                </div>
              )}

              <hr />

              {/* Actions */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Update Status</label>
                <div className="flex flex-wrap gap-2">
                  {['NEW', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'DECLINED'].map(s => (
                    <button
                      key={s}
                      disabled={updating || selected.status === s}
                      onClick={() => updateRequest(selected.id, { status: s })}
                      className={`px-3 py-1 rounded text-xs font-medium border transition
                        ${selected.status === s
                          ? 'bg-[#0f2a3e] text-white border-[#0f2a3e]'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-[#0f2a3e] hover:text-[#0f2a3e]'
                        }
                        ${updating ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      {STATUS_CONFIG[s]?.label || s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assign */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Assign To</label>
                <select
                  value={selected.assignedTo || ''}
                  onChange={e => updateRequest(selected.id, { assignedTo: e.target.value || null })}
                  disabled={updating}
                  className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                >
                  <option value="">Unassigned</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Submitted date */}
              <div className="text-xs text-gray-400 pt-2 border-t">
                Submitted {new Date(selected.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
