'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, FileText, Clock, CheckCircle, PenTool, DollarSign, Search } from 'lucide-react'

interface LienRelease {
  id: string; jobId: string; jobNumber: string; builderName: string; jobAddress: string;
  companyName: string; type: string; status: string; amount: number;
  throughDate: string | null; issuedDate: string | null; signedDate: string | null;
  signedBy: string | null; createdAt: string;
}

interface Stats {
  total: number; pending: number; issued: number; signed: number;
  signedAmount: number; pendingAmount: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  ISSUED: 'bg-blue-100 text-blue-800',
  SIGNED: 'bg-green-100 text-green-800',
  VOID: 'bg-gray-100 text-gray-600',
}

const fmtUSD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export default function LienReleasesPage() {
  const [releases, setReleases] = useState<LienRelease[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, issued: 0, signed: 0, signedAmount: 0, pendingAmount: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newRelease, setNewRelease] = useState({ jobId: '', builderId: '', type: 'CONDITIONAL', amount: '', throughDate: '', notes: '' })

  const fetchReleases = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('type', typeFilter)
      const res = await fetch(`/api/ops/lien-releases?${params}`)
      const data = await res.json()
      setReleases(data.releases || [])
      setStats(data.stats || {})
    } catch (e) { console.error('Failed to fetch lien releases:', e) }
    finally { setLoading(false) }
  }, [statusFilter, typeFilter])

  useEffect(() => { fetchReleases() }, [fetchReleases])

  const createRelease = async () => {
    if (!newRelease.jobId || !newRelease.amount) return
    try {
      const res = await fetch('/api/ops/lien-releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRelease, amount: parseFloat(newRelease.amount) }),
      })
      if (res.ok) { setShowCreate(false); fetchReleases() }
    } catch (e) { console.error('Failed to create:', e) }
  }

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/ops/lien-releases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      fetchReleases()
    } catch (e) { console.error('Failed to update:', e) }
  }

  const filtered = releases.filter(r =>
    !searchTerm || r.jobNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.builderName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.companyName?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lien Releases</h1>
          <p className="text-sm text-gray-500 mt-1">Conditional and unconditional lien release tracking</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#3E2A1E] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2A1C14]">
          <Plus className="w-4 h-4" /> New Lien Release
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Pending', value: stats.pending, sub: fmtUSD(stats.pendingAmount || 0), icon: Clock, color: 'text-yellow-600' },
          { label: 'Issued', value: stats.issued, sub: 'Awaiting signature', icon: FileText, color: 'text-blue-600' },
          { label: 'Signed', value: stats.signed, sub: fmtUSD(stats.signedAmount || 0), icon: PenTool, color: 'text-green-600' },
          { label: 'Total', value: stats.total, sub: 'All releases', icon: DollarSign, color: 'text-gray-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-gray-500 font-medium">{s.label}</span>
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search jobs, builders..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ISSUED">Issued</option>
          <option value="SIGNED">Signed</option>
          <option value="VOID">Void</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          <option value="CONDITIONAL">Conditional</option>
          <option value="UNCONDITIONAL">Unconditional</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-3 px-4 font-medium text-gray-600">Job</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Builder</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Type</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Amount</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Through Date</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                No lien releases found.
              </td></tr>
            ) : filtered.map(lr => (
              <tr key={lr.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-4">
                  <div className="font-medium text-gray-900">{lr.jobNumber || '—'}</div>
                  <div className="text-xs text-gray-500 truncate max-w-[200px]">{lr.jobAddress}</div>
                </td>
                <td className="py-3 px-4 text-gray-700">{lr.companyName || lr.builderName || '—'}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs font-medium ${lr.type === 'UNCONDITIONAL' ? 'text-green-700' : 'text-blue-700'}`}>
                    {lr.type}
                  </span>
                </td>
                <td className="py-3 px-4 font-medium text-gray-900">{fmtUSD(lr.amount)}</td>
                <td className="py-3 px-4 text-gray-500 text-xs">
                  {lr.throughDate ? new Date(lr.throughDate).toLocaleDateString() : '—'}
                </td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[lr.status] || 'bg-gray-100'}`}>
                    {lr.status}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {lr.status === 'PENDING' && (
                    <button onClick={() => updateStatus(lr.id, 'ISSUED')}
                      className="text-xs text-blue-600 hover:underline">Issue</button>
                  )}
                  {lr.status === 'ISSUED' && (
                    <button onClick={() => updateStatus(lr.id, 'SIGNED')}
                      className="text-xs text-green-600 hover:underline">Mark Signed</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">New Lien Release</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job ID</label>
                <input type="text" placeholder="Enter Job ID" value={newRelease.jobId}
                  onChange={e => setNewRelease(p => ({ ...p, jobId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={newRelease.type}
                  onChange={e => setNewRelease(p => ({ ...p, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="CONDITIONAL">Conditional</option>
                  <option value="UNCONDITIONAL">Unconditional</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <input type="number" step="0.01" placeholder="0.00" value={newRelease.amount}
                  onChange={e => setNewRelease(p => ({ ...p, amount: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Through Date</label>
                <input type="date" value={newRelease.throughDate}
                  onChange={e => setNewRelease(p => ({ ...p, throughDate: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={createRelease} disabled={!newRelease.jobId || !newRelease.amount}
                className="px-4 py-2 text-sm bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14] disabled:opacity-50">
                Create Release
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
