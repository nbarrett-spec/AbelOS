'use client'

import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

const NAVY = '#0f2a3e'
const ORANGE = '#C6A24E'

interface PermitLead {
  id: string
  permitNumber: string | null
  address: string
  city: string | null
  county: string | null
  builderName: string | null
  builderFound: boolean
  matchedBuilderId: string | null
  projectType: string
  estimatedValue: number
  filingDate: string | null
  status: string
  source: string
  createdAt: string
}

interface PipelineItem {
  status: string
  count: number
  value: number
}

export default function PermitsPage() {
  const [permits, setPermits] = useState<PermitLead[]>([])
  const [pipeline, setPipeline] = useState<PipelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showImport, setShowImport] = useState(false)
  const [importData, setImportData] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadData()
  }, [statusFilter, page])

  const loadData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', '25')
      if (statusFilter) params.append('status', statusFilter)

      const res = await fetch(`/api/agent-hub/permits?${params}`)
      if (res.ok) {
        const data = await res.json()
        setPermits(data.data || [])
        setPipeline(data.pipeline || [])
        setTotalPages(data.pagination?.pages || 1)
      }
    } catch (err) {
      console.error('Failed to load permits:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    try {
      const lines = importData.trim().split('\n')
      const permits = lines.map(line => {
        const parts = line.split(',').map(s => s.trim())
        return {
          permitNumber: parts[0] || null,
          address: parts[1] || 'Unknown',
          city: parts[2] || null,
          builderName: parts[3] || null,
          projectType: parts[4] || 'RESIDENTIAL',
          estimatedValue: parseFloat(parts[5]) || 0,
        }
      }).filter(p => p.address !== 'Unknown')

      const res = await fetch('/api/agent-hub/permits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permits),
      })
      const data = await res.json()
      setMessage(`Imported ${data.imported?.length || 0} permits, ${data.skipped || 0} skipped`)
      setShowImport(false)
      setImportData('')
      loadData()
    } catch (err) {
      setMessage('Import failed')
    }
  }

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      await fetch(`/api/agent-hub/permits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      loadData()
    } catch (err) {
      console.error('Status update failed:', err)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'NEW': return { bg: '#e3f2fd', color: '#1565c0' }
      case 'RESEARCHED': return { bg: '#fff3e0', color: '#e65100' }
      case 'OUTREACH_SENT': return { bg: '#e8f5e9', color: '#2e7d32' }
      case 'CONVERTED': return { bg: '#e8f5e9', color: '#1b5e20' }
      case 'DISQUALIFIED': return { bg: '#fce4ec', color: '#c62828' }
      default: return { bg: '#f5f5f5', color: '#666' }
    }
  }

  const pipelineTotal = pipeline.reduce((s, p) => s + p.count, 0)
  const pipelineValue = pipeline.reduce((s, p) => s + p.value, 0)

  return (
    <div style={{ padding: 0, minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: 'white', padding: '30px 40px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="text-2xl font-semibold" style={{ margin: '0 0 8px 0' }}>
              Building Permit Monitor
            </h1>
            <p className="text-sm" style={{ color: '#ccc', margin: 0 }}>
              Track new building permits, research builders, and convert leads into customers
            </p>
          </div>
          <button
            onClick={() => setShowImport(!showImport)}
            className="text-sm font-semibold cursor-pointer"
            style={{
              backgroundColor: ORANGE, color: 'white', border: 'none',
              padding: '10px 20px', borderRadius: '4px',
            }}
          >
            Import Permits
          </button>
        </div>
      </div>

      {message && (
        <div style={{ backgroundColor: '#d4edda', color: '#155724', padding: '12px 40px', marginBottom: '20px', borderLeft: '4px solid #28a745' }}>
          {message}
          <button onClick={() => setMessage('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>×</button>
        </div>
      )}

      {/* Import Panel */}
      {showImport && (
        <div style={{ padding: '0 40px 20px' }}>
          <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '20px' }}>
            <h3 className="text-sm font-semibold" style={{ margin: '0 0 10px', color: NAVY }}>Import Permits (CSV format)</h3>
            <p className="text-xs text-fg-muted" style={{ margin: '0 0 10px' }}>
              Format: Permit#, Address, City, Builder Name, Project Type (RESIDENTIAL/COMMERCIAL), Estimated Value
            </p>
            <textarea
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder="BP-2026-001, 123 Oak Lane, Austin, Smith Homes, RESIDENTIAL, 450000"
              className="text-[13px] font-mono"
              style={{ width: '100%', height: '120px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
              <button onClick={handleImport} className="text-[13px] cursor-pointer" style={{ backgroundColor: NAVY, color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px' }}>
                Import
              </button>
              <button onClick={() => setShowImport(false)} className="text-[13px] cursor-pointer" style={{ backgroundColor: '#eee', color: '#333', border: 'none', padding: '8px 16px', borderRadius: '4px' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Summary */}
      <div style={{ padding: '0 40px 20px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '15px', textAlign: 'center' }}>
          <div className="text-[11px] text-fg-muted uppercase mb-1.5">Total Permits</div>
          <div className="text-xl font-semibold" style={{ color: NAVY }}>{pipelineTotal}</div>
        </div>
        {['NEW', 'RESEARCHED', 'OUTREACH_SENT', 'CONVERTED', 'DISQUALIFIED'].map(status => {
          const item = pipeline.find(p => p.status === status)
          const sc = statusColor(status)
          return (
            <div
              key={status}
              onClick={() => { setStatusFilter(statusFilter === status ? '' : status); setPage(1) }}
              className="cursor-pointer"
              style={{
                backgroundColor: statusFilter === status ? sc.bg : 'white',
                border: `1px solid ${statusFilter === status ? sc.color : '#ddd'}`,
                borderRadius: '4px', padding: '15px', textAlign: 'center',
              }}
            >
              <div className="text-[11px] text-fg-muted uppercase mb-1.5">
                {status.replace('_', ' ')}
              </div>
              <div className="text-xl font-semibold" style={{ color: sc.color }}>{item?.count || 0}</div>
            </div>
          )
        })}
      </div>

      {/* Permits Table */}
      <div style={{ padding: '0 40px 20px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
          {loading ? (
            <div className="text-center py-10 text-fg-subtle">Loading...</div>
          ) : permits.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="w-8 h-8 text-fg-subtle" />}
              title="No permits found"
              description="Import permits to get started."
            />
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                      {['Status', 'Permit #', 'Address', 'City', 'Builder', 'Type', 'Value', 'Filed', 'Actions'].map(h => (
                        <th key={h} className="text-xs font-semibold text-fg-muted" style={{ padding: '12px 10px', textAlign: 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {permits.map(p => {
                      const sc = statusColor(p.status)
                      return (
                        <tr key={p.id} className="hover:bg-row-hover" style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '10px' }}>
                            <span className="text-[11px] font-semibold" style={{ padding: '3px 8px', borderRadius: '3px', backgroundColor: sc.bg, color: sc.color }}>
                              {p.status}
                            </span>
                          </td>
                          <td className="text-xs font-mono" style={{ padding: '10px' }}>{p.permitNumber || '—'}</td>
                          <td className="text-[13px] font-medium" style={{ padding: '10px' }}>{p.address}</td>
                          <td className="text-xs" style={{ padding: '10px' }}>{p.city || '—'}</td>
                          <td style={{ padding: '10px' }}>
                            <div className="text-[13px] font-medium" style={{ color: NAVY }}>{p.builderName || '—'}</div>
                            {p.builderFound && (
                              <div className="text-[11px]" style={{ color: '#27ae60' }}>✓ Existing customer</div>
                            )}
                          </td>
                          <td className="text-xs" style={{ padding: '10px' }}>{p.projectType}</td>
                          <td className="text-[13px] font-medium" style={{ padding: '10px' }}>
                            {p.estimatedValue > 0 ? `$${p.estimatedValue.toLocaleString()}` : '—'}
                          </td>
                          <td className="text-xs text-fg-muted" style={{ padding: '10px' }}>
                            {p.filingDate ? new Date(p.filingDate).toLocaleDateString() : '—'}
                          </td>
                          <td style={{ padding: '10px' }}>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {p.status === 'NEW' && (
                                <button onClick={() => handleStatusUpdate(p.id, 'RESEARCHED')}
                                  className="text-[11px] cursor-pointer"
                                  style={{ backgroundColor: ORANGE, color: 'white', border: 'none', padding: '4px 8px', borderRadius: '3px' }}>
                                  Mark Researched
                                </button>
                              )}
                              {(p.status === 'RESEARCHED') && (
                                <button onClick={() => handleStatusUpdate(p.id, 'OUTREACH_SENT')}
                                  className="text-[11px] cursor-pointer"
                                  style={{ backgroundColor: '#27ae60', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '3px' }}>
                                  Send Outreach
                                </button>
                              )}
                              {p.status !== 'CONVERTED' && p.status !== 'DISQUALIFIED' && (
                                <button onClick={() => handleStatusUpdate(p.id, 'DISQUALIFIED')}
                                  className="text-[11px] cursor-pointer text-fg-muted"
                                  style={{ backgroundColor: '#eee', border: 'none', padding: '4px 8px', borderRadius: '3px' }}>
                                  DQ
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ padding: '15px', display: 'flex', justifyContent: 'center', gap: '10px', borderTop: '1px solid #eee' }}>
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="text-xs"
                  style={{ padding: '6px 12px', backgroundColor: page === 1 ? '#eee' : NAVY, color: page === 1 ? '#999' : 'white', border: 'none', borderRadius: '3px', cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
                  Prev
                </button>
                <span className="text-xs text-fg-muted" style={{ padding: '6px 12px' }}>Page {page} of {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                  className="text-xs"
                  style={{ padding: '6px 12px', backgroundColor: page === totalPages ? '#eee' : NAVY, color: page === totalPages ? '#999' : 'white', border: 'none', borderRadius: '3px', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
