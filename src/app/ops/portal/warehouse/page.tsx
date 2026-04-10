'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Modal } from '../../components/Modal'

interface MaterialPick {
  id: string
  sku: string
  description: string
  quantity: number
  pickedQty: number
  status: string
  zone: string
  job: { id: string; jobNumber: string; builderName: string }
}

interface ProductionJob {
  id: string
  jobNumber: string
  builderName: string
  community: string
  scheduledDate: string
  status: string
}

interface QCCheck {
  id: string
  checkType: string
  result: string
  notes: string
  createdAt: string
  job: { id: string; jobNumber: string; builderName: string }
  inspector: { firstName: string; lastName: string }
}

interface DashboardData {
  productionQueue: ProductionJob[]
  materialPickSummary: { pending: number; picking: number; picked: number; verified: number; short: number }
  qualityCheckSummary: { recentChecks: any[]; passRate: number }
  kpis: { jobsInProduction: number; picksPending: number; qcPassRate: number; itemsStaged: number }
}

export default function WarehousePortal() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [picks, setPicks] = useState<MaterialPick[]>([])
  const [qcChecks, setQcChecks] = useState<QCCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Modal states
  const [showPickModal, setShowPickModal] = useState(false)
  const [showQCModal, setShowQCModal] = useState(false)
  const [selectedPick, setSelectedPick] = useState<MaterialPick | null>(null)
  const [saving, setSaving] = useState(false)

  // QC form state
  const [qcJobId, setQcJobId] = useState('')
  const [qcResult, setQcResult] = useState('PASS')
  const [qcNotes, setQcNotes] = useState('')

  const fetchData = async () => {
    try {
      const [dashRes, picksRes, qcRes] = await Promise.all([
        fetch('/api/ops/manufacturing/dashboard'),
        fetch('/api/ops/manufacturing/picks'),
        fetch('/api/ops/manufacturing/qc'),
      ])

      if (dashRes.ok) {
        const dashData = await dashRes.json()
        setDashboard(dashData)
      }
      if (picksRes.ok) {
        const picksData = await picksRes.json()
        setPicks(picksData.picks || [])
      }
      if (qcRes.ok) {
        const qcData = await qcRes.json()
        setQcChecks(qcData.checks || [])
      }
    } catch (error) {
      console.error('Failed to load warehouse data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleStartPick = (pick: MaterialPick) => {
    setSelectedPick(pick)
    setShowPickModal(true)
  }

  const handleUpdatePickStatus = async (pickId: string, newStatus: string, pickedQty?: number) => {
    setSaving(true)
    try {
      // Use a generic PATCH since we have the picks API
      const res = await fetch(`/api/ops/manufacturing/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickId, status: newStatus, pickedQty }),
      })
      if (res.ok) {
        setActionMsg({ type: 'success', text: `Pick updated to ${newStatus.replace(/_/g, ' ')}` })
        setShowPickModal(false)
        fetchData()
      } else {
        setActionMsg({ type: 'error', text: 'Failed to update pick status' })
      }
    } catch {
      setActionMsg({ type: 'error', text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  const handleSubmitQC = async () => {
    if (!qcJobId) {
      setActionMsg({ type: 'error', text: 'Please select a job for QC' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: qcJobId,
          checkType: 'FINAL',
          result: qcResult,
          notes: qcNotes,
          defectCodes: [],
        }),
      })
      if (res.ok) {
        setActionMsg({ type: 'success', text: `QC check recorded: ${qcResult}` })
        setShowQCModal(false)
        setQcJobId('')
        setQcResult('PASS')
        setQcNotes('')
        fetchData()
      } else {
        const data = await res.json()
        setActionMsg({ type: 'error', text: data.error || 'Failed to create QC check' })
      }
    } catch {
      setActionMsg({ type: 'error', text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  const statusColors: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    PICKING: 'bg-blue-100 text-blue-700',
    PICKED: 'bg-green-100 text-green-700',
    VERIFIED: 'bg-purple-100 text-purple-700',
    SHORT: 'bg-red-100 text-red-700',
    PASS: 'bg-green-100 text-green-700',
    FAIL: 'bg-red-100 text-red-700',
    CONDITIONAL_PASS: 'bg-yellow-100 text-yellow-700',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#27AE60]" />
      </div>
    )
  }

  const kpis = dashboard?.kpis || { jobsInProduction: 0, picksPending: 0, qcPassRate: 0, itemsStaged: 0 }
  const pickSummary = dashboard?.materialPickSummary || { pending: 0, picking: 0, picked: 0, verified: 0, short: 0 }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Warehouse & Manufacturing</h1>
          <p className="text-gray-600 mt-1">Pick lists, production queue, QC, and staging management</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowPickModal(true); setSelectedPick(null) }}
            className="px-4 py-2 bg-[#27AE60] text-white rounded-lg hover:bg-[#229954] transition-colors text-sm font-medium"
          >
            + Start Pick
          </button>
          <Link href="/ops/jobs" className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
            All Jobs
          </Link>
        </div>
      </div>

      {/* Toast */}
      {actionMsg && (
        <div className={`p-3 rounded-lg text-sm font-medium ${actionMsg.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {actionMsg.text}
          <button onClick={() => setActionMsg(null)} className="float-right text-lg leading-none">&times;</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-l-4 border-l-[#27AE60] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Picks Pending</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.picksPending}</p>
          <p className="text-xs text-gray-400 mt-1">{pickSummary.picking} in progress</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-[#E67E22] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Jobs In Production</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.jobsInProduction}</p>
          <p className="text-xs text-gray-400 mt-1">Active jobs</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">QC Pass Rate</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{(kpis.qcPassRate * 100).toFixed(0)}%</p>
          <p className="text-xs text-gray-400 mt-1">{qcChecks.length} total checks</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-purple-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Items Staged</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.itemsStaged}</p>
          <p className="text-xs text-gray-400 mt-1">{pickSummary.verified} verified</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Material Picks */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Material Picks</h2>
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">Pending: {pickSummary.pending}</span>
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-600">Picking: {pickSummary.picking}</span>
              <span className="px-2 py-1 rounded bg-green-100 text-green-600">Picked: {pickSummary.picked}</span>
              {pickSummary.short > 0 && (
                <span className="px-2 py-1 rounded bg-red-100 text-red-600">Short: {pickSummary.short}</span>
              )}
            </div>
          </div>

          {picks.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">&#128230;</p>
              <p>No material picks in the system</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {picks.map((pick) => (
                <div key={pick.id} className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-[#27AE60] transition-all">
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{pick.sku}</p>
                    <p className="text-sm text-gray-600 mt-0.5 truncate max-w-xs">{pick.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {pick.job?.jobNumber} &bull; {pick.job?.builderName} &bull; Zone: {pick.zone || 'N/A'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right mr-2">
                      <p className="text-sm font-semibold">{pick.pickedQty}/{pick.quantity}</p>
                      <p className="text-xs text-gray-400">picked</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[pick.status] || 'bg-gray-100 text-gray-700'}`}>
                      {pick.status}
                    </span>
                    {['PENDING', 'PICKING'].includes(pick.status) && (
                      <button
                        onClick={() => handleStartPick(pick)}
                        className="px-3 py-1.5 text-sm rounded-lg bg-[#27AE60] text-white hover:bg-[#229954] transition-colors font-medium"
                      >
                        {pick.status === 'PENDING' ? 'Start' : 'Continue'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => { setShowPickModal(true); setSelectedPick(null) }}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-[#27AE60] transition-all text-sm font-medium text-gray-900 text-left"
            >
              &#x1F195; Start Pick
            </button>
            <button
              onClick={() => setShowQCModal(true)}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-500 transition-all text-sm font-medium text-gray-900 text-left"
            >
              &#x2705; Complete QC
            </button>
            <Link href="/ops/schedule"
              className="block w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all text-sm font-medium text-gray-900"
            >
              &#x1F4CD; View Schedule
            </Link>
            <Link href="/ops/jobs"
              className="block w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-yellow-50 hover:border-yellow-500 transition-all text-sm font-medium text-gray-900"
            >
              &#x1F69A; Job Pipeline
            </Link>
          </div>
        </div>
      </div>

      {/* Production Queue */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Production Queue</h2>
          <Link href="/ops/jobs" className="text-sm text-[#27AE60] hover:text-[#229954]">All Jobs &rarr;</Link>
        </div>

        {(dashboard?.productionQueue || []).length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">&#127981;</p>
            <p>No jobs currently in production</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(dashboard?.productionQueue || []).map((job) => {
              const daysUntilDue = job.scheduledDate
                ? Math.ceil((new Date(job.scheduledDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null
              return (
                <div key={job.id} className="p-4 rounded-lg border border-gray-200 hover:border-[#E67E22] transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-900">{job.jobNumber}</p>
                      <p className="text-sm text-gray-600">{job.builderName}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded font-medium ${
                      job.status === 'STAGED' ? 'bg-purple-100 text-purple-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {job.community && <p className="text-xs text-gray-500">{job.community}</p>}
                  {daysUntilDue !== null && (
                    <p className={`text-xs mt-2 font-medium ${daysUntilDue < 0 ? 'text-red-600' : daysUntilDue <= 3 ? 'text-yellow-600' : 'text-gray-500'}`}>
                      {daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} days overdue` : `Due in ${daysUntilDue} days`}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* QC Checks */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Recent QC Checks</h2>
          <button onClick={() => setShowQCModal(true)} className="text-sm text-[#27AE60] hover:text-[#229954] font-medium">
            + New QC Check
          </button>
        </div>

        {qcChecks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">&#x2714;&#xFE0F;</p>
            <p>No QC checks recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Job</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Result</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Inspector</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Notes</th>
                </tr>
              </thead>
              <tbody>
                {qcChecks.slice(0, 10).map((check) => (
                  <tr key={check.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{check.job?.jobNumber || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{check.checkType}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[check.result] || 'bg-gray-100 text-gray-700'}`}>
                        {check.result}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {check.inspector ? `${check.inspector.firstName} ${check.inspector.lastName}` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(check.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-xs">{check.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pick Detail Modal */}
      <Modal isOpen={showPickModal} onClose={() => setShowPickModal(false)} title={selectedPick ? `Pick: ${selectedPick.sku}` : 'Material Picks'}>
        {selectedPick ? (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-900">{selectedPick.description}</p>
              <p className="text-xs text-gray-500 mt-1">{selectedPick.job?.jobNumber} &bull; {selectedPick.job?.builderName}</p>
              <p className="text-xs text-gray-500">Zone: {selectedPick.zone || 'N/A'}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Required Qty</p>
                <p className="text-lg font-bold text-gray-900">{selectedPick.quantity}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Picked So Far</p>
                <p className="text-lg font-bold text-gray-900">{selectedPick.pickedQty}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-4 border-t">
              {selectedPick.status === 'PENDING' && (
                <button onClick={() => handleUpdatePickStatus(selectedPick.id, 'PICKING')} disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Updating...' : 'Start Picking'}
                </button>
              )}
              {selectedPick.status === 'PICKING' && (
                <>
                  <button onClick={() => handleUpdatePickStatus(selectedPick.id, 'PICKED', selectedPick.quantity)} disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                    {saving ? 'Updating...' : 'Mark Picked (Full)'}
                  </button>
                  <button onClick={() => handleUpdatePickStatus(selectedPick.id, 'SHORT')} disabled={saving}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    Mark Short
                  </button>
                </>
              )}
              {selectedPick.status === 'PICKED' && (
                <button onClick={() => handleUpdatePickStatus(selectedPick.id, 'VERIFIED')} disabled={saving}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                  {saving ? 'Updating...' : 'Verify & Stage'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Select a pending pick from the list to begin:</p>
            {picks.filter(p => ['PENDING', 'PICKING'].includes(p.status)).length === 0 ? (
              <p className="text-center py-4 text-gray-400 text-sm">No pending picks available</p>
            ) : (
              picks.filter(p => ['PENDING', 'PICKING'].includes(p.status)).map((pick) => (
                <button key={pick.id} onClick={() => setSelectedPick(pick)}
                  className="w-full text-left p-3 rounded-lg border hover:border-[#27AE60] hover:bg-green-50 transition-all">
                  <p className="font-semibold text-sm text-gray-900">{pick.sku}</p>
                  <p className="text-xs text-gray-500">{pick.job?.jobNumber} &bull; {pick.quantity} units &bull; {pick.status}</p>
                </button>
              ))
            )}
          </div>
        )}
      </Modal>

      {/* QC Modal */}
      <Modal isOpen={showQCModal} onClose={() => setShowQCModal(false)} title="New QC Check">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Job</label>
            <select value={qcJobId} onChange={(e) => setQcJobId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select a job...</option>
              {(dashboard?.productionQueue || []).map((job) => (
                <option key={job.id} value={job.id}>{job.jobNumber} - {job.builderName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Result</label>
            <select value={qcResult} onChange={(e) => setQcResult(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
              <option value="CONDITIONAL_PASS">CONDITIONAL PASS</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes</label>
            <textarea value={qcNotes} onChange={(e) => setQcNotes(e.target.value)}
              rows={3} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Inspection notes..." />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleSubmitQC} disabled={saving}
              className="px-4 py-2 bg-[#27AE60] text-white rounded-lg text-sm font-medium hover:bg-[#229954] disabled:opacity-50">
              {saving ? 'Saving...' : 'Submit QC Check'}
            </button>
            <button onClick={() => setShowQCModal(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
