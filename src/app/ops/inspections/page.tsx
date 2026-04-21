'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, Plus, Clock, AlertTriangle, XCircle, Search, Filter, ClipboardList } from 'lucide-react'

interface Inspection {
  id: string; templateName: string; templateCode: string; category: string;
  jobNumber: string; builderName: string; jobAddress: string;
  inspectorName: string; status: string; passRate: number | null;
  scheduledDate: string | null; completedDate: string | null; createdAt: string;
}

interface Template { id: string; name: string; code: string; category: string; items: any[] }

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  SCHEDULED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-800',
  PASSED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  REQUIRES_REINSPECTION: 'bg-orange-100 text-orange-800',
}

export default function InspectionsPage() {
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newInspection, setNewInspection] = useState({ templateId: '', jobId: '', inspectorId: '', scheduledDate: '', notes: '' })
  const [total, setTotal] = useState(0)

  const fetchInspections = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (categoryFilter) params.set('category', categoryFilter)
      const res = await fetch(`/api/ops/inspections?${params}`)
      const data = await res.json()
      setInspections(data.inspections || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error('Failed to fetch inspections:', e)
    } finally { setLoading(false) }
  }, [statusFilter, categoryFilter])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/inspections/templates')
      const data = await res.json()
      setTemplates(data.templates || [])
    } catch (e) { console.error('Failed to fetch templates:', e) }
  }, [])

  useEffect(() => { fetchInspections(); fetchTemplates() }, [fetchInspections, fetchTemplates])

  const createInspection = async () => {
    if (!newInspection.templateId) return
    try {
      const res = await fetch('/api/ops/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInspection),
      })
      if (res.ok) {
        setShowCreate(false)
        setNewInspection({ templateId: '', jobId: '', inspectorId: '', scheduledDate: '', notes: '' })
        fetchInspections()
      }
    } catch (e) { console.error('Failed to create:', e) }
  }

  const filtered = inspections.filter(i =>
    !searchTerm || i.jobNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.builderName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.templateName?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const stats = {
    total: inspections.length,
    pending: inspections.filter(i => i.status === 'PENDING' || i.status === 'SCHEDULED').length,
    passed: inspections.filter(i => i.status === 'PASSED').length,
    failed: inspections.filter(i => i.status === 'FAILED').length,
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inspections</h1>
          <p className="text-sm text-gray-500 mt-1">Pre-install, post-install, QC, and delivery inspections</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#0f2a3e] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#0a1a28] transition-colors">
          <Plus className="w-4 h-4" /> New Inspection
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: stats.total, icon: ClipboardList, color: 'text-gray-700' },
          { label: 'Pending/Scheduled', value: stats.pending, icon: Clock, color: 'text-yellow-600' },
          { label: 'Passed', value: stats.passed, icon: CheckCircle, color: 'text-green-600' },
          { label: 'Failed', value: stats.failed, icon: XCircle, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-gray-500 font-medium">{s.label}</span>
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search jobs, builders, templates..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Categories</option>
          <option value="INSTALLATION">Installation</option>
          <option value="MANUFACTURING">Manufacturing</option>
          <option value="DELIVERY">Delivery</option>
          <option value="GENERAL">General</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-3 px-4 font-medium text-gray-600">Template</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Job</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Builder</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Inspector</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Pass Rate</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                No inspections found. Create one to get started.
              </td></tr>
            ) : filtered.map(insp => (
              <tr key={insp.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                <td className="py-3 px-4">
                  <div className="font-medium text-gray-900">{insp.templateName || 'Custom'}</div>
                  <div className="text-xs text-gray-500">{insp.category}</div>
                </td>
                <td className="py-3 px-4 text-gray-700">{insp.jobNumber || '—'}</td>
                <td className="py-3 px-4 text-gray-700">{insp.builderName || '—'}</td>
                <td className="py-3 px-4 text-gray-700">{insp.inspectorName || 'Unassigned'}</td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[insp.status] || 'bg-gray-100 text-gray-600'}`}>
                    {insp.status?.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {insp.passRate != null ? (
                    <span className={`font-medium ${insp.passRate >= 90 ? 'text-green-600' : insp.passRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {insp.passRate.toFixed(0)}%
                    </span>
                  ) : '—'}
                </td>
                <td className="py-3 px-4 text-gray-500 text-xs">
                  {insp.scheduledDate ? new Date(insp.scheduledDate).toLocaleDateString() : '—'}
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
            <h2 className="text-lg font-bold mb-4">New Inspection</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
                <select value={newInspection.templateId}
                  onChange={e => setNewInspection(p => ({ ...p, templateId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job ID</label>
                <input type="text" placeholder="Enter Job ID" value={newInspection.jobId}
                  onChange={e => setNewInspection(p => ({ ...p, jobId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Date</label>
                <input type="date" value={newInspection.scheduledDate}
                  onChange={e => setNewInspection(p => ({ ...p, scheduledDate: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea placeholder="Optional notes..." value={newInspection.notes}
                  onChange={e => setNewInspection(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={createInspection} disabled={!newInspection.templateId}
                className="px-4 py-2 text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] disabled:opacity-50">
                Create Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
