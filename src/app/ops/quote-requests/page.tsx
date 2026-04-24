'use client'

import { useState, useEffect } from 'react'
import { FileQuestion } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'

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
        <div className="fixed top-4 right-4 z-50 bg-surface-elev text-fg px-4 py-2 rounded-lg shadow-lg text-sm border border-border">
          {toast}
        </div>
      )}

      <PageHeader
        title="Quote Requests"
        description="Manage incoming builder quote requests"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface-elev rounded-lg border border-border p-4">
          <div className="text-2xl font-semibold text-fg">{stats.total}</div>
          <div className="text-xs text-fg-muted uppercase tracking-wide">Total Requests</div>
        </div>
        <div className="bg-surface-elev rounded-lg border border-border p-4 border-l-4 border-l-blue-500">
          <div className="text-2xl font-semibold text-blue-700">{stats.new}</div>
          <div className="text-xs text-fg-muted uppercase tracking-wide">New</div>
        </div>
        <div className="bg-surface-elev rounded-lg border border-border p-4 border-l-4 border-l-amber-500">
          <div className="text-2xl font-semibold text-amber-700">{stats.reviewing}</div>
          <div className="text-xs text-fg-muted uppercase tracking-wide">Reviewing</div>
        </div>
        <div className="bg-surface-elev rounded-lg border border-border p-4 border-l-4 border-l-green-500">
          <div className="text-2xl font-semibold text-green-700">{stats.quoted}</div>
          <div className="text-xs text-fg-muted uppercase tracking-wide">Quoted</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm font-medium text-fg-muted">Status:</label>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-surface-elev"
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
        <div className={`bg-surface-elev rounded-lg border border-border overflow-hidden ${selected ? 'flex-1' : 'w-full'}`}>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-[3px] border-signal border-t-transparent rounded-full animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={<FileQuestion className="w-8 h-8 text-fg-subtle" />}
              title="No quote requests"
              description="Requests from builders will appear here."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-fg-muted">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-fg-muted">Builder</th>
                  <th className="text-left px-4 py-3 font-medium text-fg-muted">Project</th>
                  <th className="text-left px-4 py-3 font-medium text-fg-muted">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-fg-muted">Assigned</th>
                  <th className="text-left px-4 py-3 font-medium text-fg-muted">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map(qr => (
                  <tr
                    key={qr.id}
                    onClick={() => setSelected(qr)}
                    className={`cursor-pointer hover:bg-row-hover transition ${selected?.id === qr.id ? 'bg-signal-subtle' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{qr.referenceNumber}</td>
                    <td className="px-4 py-3 font-medium">{qr.companyName || '—'}</td>
                    <td className="px-4 py-3">
                      <div>{qr.projectName}</div>
                      <div className="text-xs text-fg-subtle">{qr.projectAddress}{qr.city ? `, ${qr.city}` : ''}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={qr.status} /></td>
                    <td className="px-4 py-3 text-fg-muted">{qr.assignedToName || '—'}</td>
                    <td className="px-4 py-3 text-fg-muted text-xs">
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
          <div className="w-96 bg-surface-elev rounded-lg border border-border p-5 sticky top-4 self-start">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-fg">Request Details</h3>
              <button
                onClick={() => setSelected(null)}
                className="text-fg-subtle hover:text-fg text-lg"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Reference & Status */}
              <div className="flex justify-between items-center">
                <span className="font-mono text-xs bg-surface-muted px-2 py-1 rounded">{selected.referenceNumber}</span>
                <StatusBadge status={selected.status} />
              </div>

              {/* Builder */}
              <div>
                <label className="text-xs text-fg-muted uppercase tracking-wide">Builder</label>
                <p className="font-medium">{selected.companyName || 'Unknown'}</p>
              </div>

              {/* Project */}
              <div>
                <label className="text-xs text-fg-muted uppercase tracking-wide">Project</label>
                <p className="font-medium">{selected.projectName}</p>
                <p className="text-fg-muted text-xs">
                  {selected.projectAddress}
                  {selected.city && `, ${selected.city}`}
                  {selected.state && `, ${selected.state}`}
                  {selected.zip && ` ${selected.zip}`}
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-fg-muted uppercase tracking-wide">Description</label>
                <p className="text-fg whitespace-pre-line">{selected.description}</p>
              </div>

              {/* Categories */}
              <div>
                <label className="text-xs text-fg-muted uppercase tracking-wide">Product Categories</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {categories(selected).map((cat: string, i: number) => (
                    <span key={i} className="bg-signal text-fg-on-accent text-xs px-2 py-0.5 rounded-full">
                      {cat}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sq Ft */}
              {selected.estimatedSquareFootage && (
                <div>
                  <label className="text-xs text-fg-muted uppercase tracking-wide">Est. Square Footage</label>
                  <p className="font-medium">{Number(selected.estimatedSquareFootage).toLocaleString()} sq ft</p>
                </div>
              )}

              {/* Preferred Delivery */}
              {selected.preferredDeliveryDate && (
                <div>
                  <label className="text-xs text-fg-muted uppercase tracking-wide">Preferred Delivery</label>
                  <p className="font-medium">{new Date(selected.preferredDeliveryDate).toLocaleDateString()}</p>
                </div>
              )}

              {/* Notes */}
              {selected.notes && (
                <div>
                  <label className="text-xs text-fg-muted uppercase tracking-wide">Notes</label>
                  <p className="text-fg text-xs whitespace-pre-line">{selected.notes}</p>
                </div>
              )}

              <hr className="border-border" />

              {/* Actions */}
              <div>
                <label className="text-xs text-fg-muted uppercase tracking-wide mb-1 block">Update Status</label>
                <div className="flex flex-wrap gap-2">
                  {['NEW', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'DECLINED'].map(s => (
                    <button
                      key={s}
                      disabled={updating || selected.status === s}
                      onClick={() => updateRequest(selected.id, { status: s })}
                      className={`px-3 py-1 rounded text-xs font-medium border transition
                        ${selected.status === s
                          ? 'bg-signal text-fg-on-accent border-signal'
                          : 'bg-surface-elev text-fg-muted border-border hover:border-signal hover:text-signal'
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
                <label className="text-xs text-fg-muted uppercase tracking-wide mb-1 block">Assign To</label>
                <select
                  value={selected.assignedTo || ''}
                  onChange={e => updateRequest(selected.id, { assignedTo: e.target.value || null })}
                  disabled={updating}
                  className="w-full border border-border rounded px-3 py-1.5 text-sm bg-surface-elev"
                >
                  <option value="">Unassigned</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Submitted date */}
              <div className="text-xs text-fg-subtle pt-2 border-t border-border">
                Submitted {new Date(selected.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
