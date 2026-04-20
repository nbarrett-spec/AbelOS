'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface BuildSheetData {
  job: any
  orderItems: any[]
  assemblyGroups: { parent: any; components: any[] }[]
  directPicks: any[]
  pickSummary: {
    total: number; short: number; pending: number
    picking: number; picked: number; verified: number
    percentComplete: number
  }
  qcChecks: any[]
  gates: {
    pickListGenerated: boolean
    allMaterialsAllocated: boolean
    allPicksVerified: boolean
    preProductionQCPassed: boolean
    finalUnitQCPassed: boolean
    preDeliveryQCPassed: boolean
  }
}

export default function BuildSheetPage() {
  const [jobId, setJobId] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [data, setData] = useState<BuildSheetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  // Job search list
  const [searchResults, setSearchResults] = useState<any[]>([])

  const searchJobs = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setSearchResults([]); return }
    try {
      const res = await fetch(`/api/ops/jobs?search=${encodeURIComponent(q)}&limit=8&status=CREATED,READINESS_CHECK,MATERIALS_LOCKED,IN_PRODUCTION,STAGED`)
      if (res.ok) {
        const d = await res.json()
        setSearchResults(d.jobs || [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchJobs(jobSearch), 300)
    return () => clearTimeout(t)
  }, [jobSearch, searchJobs])

  const loadBuildSheet = async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/ops/manufacturing/build-sheet?jobId=${id}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to load')
      }
      const d = await res.json()
      setData(d)
      setJobId(id)
      setSearchResults([])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const generatePicks = async () => {
    if (!jobId) return
    setActionMsg('')
    try {
      const res = await fetch('/api/ops/manufacturing/generate-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, force: data?.job?.pickListGenerated }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setActionMsg(`Pick list generated: ${d.picksCreated} picks, ${d.shortages?.length || 0} shortages`)
      loadBuildSheet(jobId)
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`)
    }
  }

  const updatePickStatus = async (pickIds: string[], status: string) => {
    try {
      const res = await fetch('/api/ops/manufacturing/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickIds, status }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setActionMsg(`Updated ${d.updated} pick(s) to ${status}`)
      loadBuildSheet(jobId)
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`)
    }
  }

  const advanceJob = async (targetStatus: string) => {
    try {
      const res = await fetch('/api/ops/manufacturing/advance-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, targetStatus }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.gateFailures ? d.gateFailures.join('; ') : d.error)
      setActionMsg(`Job advanced to ${targetStatus}`)
      loadBuildSheet(jobId)
    } catch (e: any) {
      setActionMsg(`Gate failed: ${e.message}`)
    }
  }

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      PICKING: 'bg-blue-100 text-blue-800',
      PICKED: 'bg-indigo-100 text-indigo-800',
      VERIFIED: 'bg-green-100 text-green-800',
      SHORT: 'bg-red-100 text-red-800',
      SUBSTITUTED: 'bg-orange-100 text-orange-800',
    }
    return map[s] || 'bg-gray-100 text-gray-800'
  }

  const gateIcon = (passed: boolean) => passed ? '✅' : '⬜'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Build Sheet</h1>
          <p className="text-gray-600 text-sm mt-1">Manufacturing worksheet with BOM expansion, picks, and QC gates</p>
        </div>
        <Link href="/ops/manufacturing" className="text-sm text-[#3E2A1E] hover:text-[#C9822B]">← Manufacturing Dashboard</Link>
      </div>

      {/* Job Search */}
      {!data && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold mb-4">Select a Job</h2>
          <input
            type="text"
            placeholder="Search by job number or builder..."
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#3E2A1E] focus:outline-none"
            value={jobSearch}
            onChange={(e) => setJobSearch(e.target.value)}
          />
          {searchResults.length > 0 && (
            <div className="mt-2 border rounded-lg divide-y max-h-64 overflow-auto">
              {searchResults.map((j: any) => (
                <button
                  key={j.id}
                  onClick={() => loadBuildSheet(j.id)}
                  className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
                >
                  <span className="font-semibold">{j.jobNumber}</span>
                  <span className="text-gray-600 ml-2">{j.builderName}</span>
                  <span className="text-gray-400 ml-2 text-sm">{j.community}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${statusColor(j.status || '')}`}>{j.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3E2A1E]" />
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>}
      {actionMsg && <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-700">{actionMsg}</div>}

      {data && (
        <>
          {/* Job Header */}
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold">{data.job.jobNumber}</h2>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor(data.job.status)}`}>
                    {data.job.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-gray-600 mt-1">{data.job.builderName} — {data.job.community} {data.job.lotBlock || ''}</p>
                {data.job.jobAddress && <p className="text-gray-500 text-sm">{data.job.jobAddress}</p>}
                {data.job.pmName && <p className="text-gray-500 text-sm mt-1">PM: {data.job.pmName}</p>}
                {data.job.scheduledDate && (
                  <p className="text-sm mt-1 font-medium">Scheduled: {new Date(data.job.scheduledDate).toLocaleDateString()}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setData(null); setJobId(''); setJobSearch(''); }} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
                  Change Job
                </button>
                <button onClick={() => loadBuildSheet(jobId)} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Validation Gates */}
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-bold text-gray-900 mb-3">Validation Gates</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="text-center p-3 rounded-lg border">
                <div className="text-2xl">{gateIcon(data.gates.pickListGenerated)}</div>
                <p className="text-xs text-gray-600 mt-1">Pick List Generated</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <div className="text-2xl">{gateIcon(data.gates.allMaterialsAllocated)}</div>
                <p className="text-xs text-gray-600 mt-1">Materials Allocated</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <div className="text-2xl">{gateIcon(data.gates.allPicksVerified)}</div>
                <p className="text-xs text-gray-600 mt-1">All Picks Verified</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <div className="text-2xl">{gateIcon(data.gates.preProductionQCPassed)}</div>
                <p className="text-xs text-gray-600 mt-1">Pre-Production QC</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <div className="text-2xl">{gateIcon(data.gates.finalUnitQCPassed)}</div>
                <p className="text-xs text-gray-600 mt-1">Final Unit QC</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <div className="text-2xl">{gateIcon(data.gates.preDeliveryQCPassed)}</div>
                <p className="text-xs text-gray-600 mt-1">Pre-Delivery QC</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Pick Progress</span>
                <span>{data.pickSummary.percentComplete}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-[#3E2A1E] h-3 rounded-full transition-all"
                  style={{ width: `${data.pickSummary.percentComplete}%` }}
                />
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span>Short: {data.pickSummary.short}</span>
                <span>Pending: {data.pickSummary.pending}</span>
                <span>Picking: {data.pickSummary.picking}</span>
                <span>Picked: {data.pickSummary.picked}</span>
                <span className="text-green-600 font-medium">Verified: {data.pickSummary.verified}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-bold text-gray-900 mb-3">Actions</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={generatePicks} className="px-4 py-2 bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14] text-sm font-medium">
                {data.gates.pickListGenerated ? 'Regenerate Pick List' : 'Generate Pick List'}
              </button>
              {data.pickSummary.pending > 0 && (
                <button
                  onClick={() => {
                    const pendingIds = [...(data.assemblyGroups?.flatMap(g => g.components) || []), ...(data.directPicks || [])]
                      .filter(p => p.status === 'PENDING').map(p => p.id)
                    if (pendingIds.length) updatePickStatus(pendingIds, 'PICKING')
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  Start Picking All ({data.pickSummary.pending})
                </button>
              )}
              {data.pickSummary.picking > 0 && (
                <button
                  onClick={() => {
                    const pickingIds = [...(data.assemblyGroups?.flatMap(g => g.components) || []), ...(data.directPicks || [])]
                      .filter(p => p.status === 'PICKING').map(p => p.id)
                    if (pickingIds.length) updatePickStatus(pickingIds, 'PICKED')
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  Mark All Picked ({data.pickSummary.picking})
                </button>
              )}
              {data.pickSummary.picked > 0 && (
                <button
                  onClick={() => {
                    const pickedIds = [...(data.assemblyGroups?.flatMap(g => g.components) || []), ...(data.directPicks || [])]
                      .filter(p => p.status === 'PICKED').map(p => p.id)
                    if (pickedIds.length) updatePickStatus(pickedIds, 'VERIFIED')
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  Verify All ({data.pickSummary.picked})
                </button>
              )}

              {/* Status advance buttons */}
              {data.job.status === 'CREATED' && (
                <button onClick={() => advanceJob('READINESS_CHECK')} className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
                  → Readiness Check
                </button>
              )}
              {data.job.status === 'READINESS_CHECK' && (
                <button onClick={() => advanceJob('MATERIALS_LOCKED')} className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
                  → Lock Materials
                </button>
              )}
              {data.job.status === 'MATERIALS_LOCKED' && (
                <button onClick={() => advanceJob('IN_PRODUCTION')} className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
                  → Start Production
                </button>
              )}
              {data.job.status === 'IN_PRODUCTION' && (
                <button onClick={() => advanceJob('STAGED')} className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
                  → Staging Complete
                </button>
              )}
              {data.job.status === 'STAGED' && (
                <button onClick={() => advanceJob('LOADED')} className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
                  → Load on Truck
                </button>
              )}
            </div>
          </div>

          {/* Assembly Groups (BOM-expanded picks) */}
          {data.assemblyGroups.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-gray-900">Assembly Units</h3>
              {data.assemblyGroups.map((group, idx) => (
                <div key={idx} className="bg-white rounded-xl border overflow-hidden">
                  <div className="bg-gray-50 px-6 py-3 border-b flex items-center justify-between">
                    <div>
                      <span className="font-bold text-gray-900">{group.parent.name}</span>
                      <span className="text-gray-500 ml-2 text-sm">SKU: {group.parent.sku}</span>
                      <span className="text-gray-500 ml-2 text-sm">Qty: {group.parent.orderQty}</span>
                      {group.parent.doorSize && <span className="text-gray-500 ml-2 text-sm">{group.parent.doorSize}</span>}
                      {group.parent.handing && <span className="text-gray-500 ml-2 text-sm">{group.parent.handing}</span>}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left">Component</th>
                        <th className="px-4 py-2 text-left">SKU</th>
                        <th className="px-4 py-2 text-center">Need</th>
                        <th className="px-4 py-2 text-center">Picked</th>
                        <th className="px-4 py-2 text-center">Status</th>
                        <th className="px-4 py-2 text-center">Location</th>
                        <th className="px-4 py-2 text-center">Stock</th>
                        <th className="px-4 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {group.components.map((comp: any) => (
                        <tr key={comp.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{comp.description}</td>
                          <td className="px-4 py-2 text-gray-600">{comp.sku}</td>
                          <td className="px-4 py-2 text-center">{comp.quantity}</td>
                          <td className="px-4 py-2 text-center">{comp.pickedQty}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(comp.status)}`}>
                              {comp.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center text-gray-500 text-xs">
                            {comp.inventory?.zone || '—'}{comp.inventory?.bin ? ` / ${comp.inventory.bin}` : ''}
                          </td>
                          <td className="px-4 py-2 text-center text-xs">
                            <span className={comp.inventory?.available >= comp.quantity ? 'text-green-600' : 'text-red-600'}>
                              {comp.inventory?.available ?? 0}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            {comp.status === 'PENDING' && (
                              <button onClick={() => updatePickStatus([comp.id], 'PICKING')} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Pick</button>
                            )}
                            {comp.status === 'PICKING' && (
                              <button onClick={() => updatePickStatus([comp.id], 'PICKED')} className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200">Done</button>
                            )}
                            {comp.status === 'PICKED' && (
                              <button onClick={() => updatePickStatus([comp.id], 'VERIFIED')} className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">Verify</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* Direct Picks (non-BOM items) */}
          {data.directPicks.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="bg-gray-50 px-6 py-3 border-b">
                <h3 className="font-bold text-gray-900">Direct Items (No BOM)</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-left">SKU</th>
                    <th className="px-4 py-2 text-center">Need</th>
                    <th className="px-4 py-2 text-center">Picked</th>
                    <th className="px-4 py-2 text-center">Status</th>
                    <th className="px-4 py-2 text-center">Location</th>
                    <th className="px-4 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.directPicks.map((pick: any) => (
                    <tr key={pick.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{pick.description}</td>
                      <td className="px-4 py-2 text-gray-600">{pick.sku}</td>
                      <td className="px-4 py-2 text-center">{pick.quantity}</td>
                      <td className="px-4 py-2 text-center">{pick.pickedQty}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(pick.status)}`}>
                          {pick.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center text-gray-500 text-xs">
                        {pick.inventory?.zone || '—'}{pick.inventory?.bin ? ` / ${pick.inventory.bin}` : ''}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {pick.status === 'PENDING' && (
                          <button onClick={() => updatePickStatus([pick.id], 'PICKING')} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Pick</button>
                        )}
                        {pick.status === 'PICKING' && (
                          <button onClick={() => updatePickStatus([pick.id], 'PICKED')} className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200">Done</button>
                        )}
                        {pick.status === 'PICKED' && (
                          <button onClick={() => updatePickStatus([pick.id], 'VERIFIED')} className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">Verify</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* QC History */}
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-bold text-gray-900 mb-3">Quality Checks</h3>
            {data.qcChecks.length === 0 ? (
              <p className="text-gray-500 text-sm">No QC checks recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {data.qcChecks.map((qc: any) => (
                  <div key={qc.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <span className="font-medium text-sm">{qc.checkType.replace(/_/g, ' ')}</span>
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                        qc.result === 'PASS' ? 'bg-green-100 text-green-700' :
                        qc.result === 'FAIL' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{qc.result}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {qc.inspectorName} — {new Date(qc.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
