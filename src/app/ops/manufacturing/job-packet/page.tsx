'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Printable Job Packet — Combined manufacturing document
// Page 1: Cover sheet with job summary + validation gates
// Page 2+: Pick List with checkboxes, sorted by zone/aisle for walk path
// Remaining: Build Sheets — one per assembly unit with component checklist,
//            door specs, hardware, handing, and QC sign-off boxes
// Final: Delivery/Install info with address and homeowner details
// ──────────────────────────────────────────────────────────────────────────

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

export default function JobPacketPage() {
  const [jobId, setJobId] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [data, setData] = useState<BuildSheetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [showAdvanceModal, setShowAdvanceModal] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [advanceMessage, setAdvanceMessage] = useState('')
  const printRef = useRef<HTMLDivElement>(null)

  const searchJobs = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setSearchResults([]); return }
    try {
      const res = await fetch(`/api/ops/jobs?search=${encodeURIComponent(q)}&limit=8`)
      if (res.ok) {
        const d = await res.json()
        setSearchResults(d.data || [])
      }
    } catch { /* */ }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchJobs(jobSearch), 300)
    return () => clearTimeout(t)
  }, [jobSearch, searchJobs])

  const loadData = async (id: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/ops/manufacturing/build-sheet?jobId=${id}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load')
      setData(await res.json())
      setJobId(id)
      setSearchResults([])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  function handlePrint() {
    window.print()
    // After printing, prompt to advance job status if applicable
    const status = data?.job?.status
    if (status && !['IN_PRODUCTION', 'STAGED', 'LOADED', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      setTimeout(() => setShowAdvanceModal(true), 500)
    }
  }

  async function advanceJobStatus() {
    if (!jobId) return
    setAdvancing(true)
    setAdvanceMessage('')
    try {
      const res = await fetch('/api/ops/manufacturing/advance-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const result = await res.json()
      if (res.ok) {
        setAdvanceMessage(`Job moved to ${result.newStatus || 'next stage'}`)
        // Reload job data to reflect new status
        await loadData(jobId)
      } else {
        setAdvanceMessage(result.error || 'Cannot advance — check gate requirements')
      }
    } catch {
      setAdvanceMessage('Failed to advance job status')
    } finally {
      setAdvancing(false)
    }
  }

  function fmtDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Sort picks by zone → bin for optimal warehouse walk path
  function getSortedPicks(): any[] {
    if (!data) return []
    const all = [
      ...(data.assemblyGroups?.flatMap(g => g.components.map(c => ({ ...c, parentName: g.parent.name, parentSku: g.parent.sku }))) || []),
      ...(data.directPicks?.map(p => ({ ...p, parentName: null, parentSku: null })) || [])
    ]
    return all.sort((a, b) => {
      const zA = (a.invZone || a.zone || 'ZZZ').toUpperCase()
      const zB = (b.invZone || b.zone || 'ZZZ').toUpperCase()
      if (zA !== zB) return zA.localeCompare(zB)
      const bA = (a.invBin || '').toUpperCase()
      const bB = (b.invBin || '').toUpperCase()
      return bA.localeCompare(bB)
    })
  }

  // ── Job search (only shown before data loads, hidden in print) ──
  if (!data) {
    return (
      <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', marginBottom: 8 }}>🖨️ Print Job Packet</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>Select a job to generate a printable pick list, build sheets, and delivery info</p>
        {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#991B1B', marginBottom: 16 }}>{error}</div>}
        <input
          type="text"
          placeholder="Search by job number or builder..."
          value={jobSearch}
          onChange={e => setJobSearch(e.target.value)}
          style={{ width: '100%', padding: '12px 16px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }}
        />
        {loading && <p style={{ textAlign: 'center', padding: 20, color: '#6B7280' }}>Loading...</p>}
        {searchResults.length > 0 && (
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, marginTop: 8, overflow: 'hidden' }}>
            {searchResults.map((j: any) => (
              <button
                key={j.id}
                onClick={() => loadData(j.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid #F3F4F6', background: 'white', cursor: 'pointer', fontSize: 14, border: 'none' }}
              >
                <strong>{j.jobNumber}</strong>
                <span style={{ color: '#6B7280', marginLeft: 8 }}>{j.builderName}</span>
                <span style={{ color: '#9CA3AF', marginLeft: 8, fontSize: 12 }}>{j.community}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const sortedPicks = getSortedPicks()
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <>
      {/* ── Screen-only toolbar ── */}
      <div className="no-print" style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, color: '#0f2a3e' }}>{data.job.jobNumber}</span>
          <span style={{ color: '#6B7280', marginLeft: 8 }}>{data.job.builderName}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setData(null); setJobId(''); setJobSearch('') }}
            style={{ padding: '8px 16px', background: 'white', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
            Change Job
          </button>
          <button onClick={handlePrint}
            style={{ padding: '8px 16px', background: '#0f2a3e', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            🖨️ Print Job Packet
          </button>
        </div>
      </div>

      {/* ── Advance Job Status Modal ── */}
      {showAdvanceModal && (
        <div className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 32, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#0f2a3e' }}>Move Job to Production?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: '#6B7280', lineHeight: 1.5 }}>
              You just printed the job packet for <strong>{data?.job?.jobNumber}</strong>.
              Would you like to advance this job to the next production stage?
            </p>
            {advanceMessage && (
              <div style={{ background: advanceMessage.includes('moved') ? '#D1FAE5' : '#FEF3C7', border: `1px solid ${advanceMessage.includes('moved') ? '#6EE7B7' : '#FCD34D'}`, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: advanceMessage.includes('moved') ? '#065F46' : '#92400E' }}>
                {advanceMessage}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdvanceModal(false); setAdvanceMessage('') }}
                style={{ padding: '10px 20px', background: 'white', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}>
                Not Now
              </button>
              {!advanceMessage.includes('moved') && (
                <button onClick={advanceJobStatus} disabled={advancing}
                  style={{ padding: '10px 20px', background: '#0f2a3e', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: advancing ? 'not-allowed' : 'pointer', opacity: advancing ? 0.7 : 1 }}>
                  {advancing ? 'Advancing...' : 'Yes, Advance Status'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Printable content ── */}
      <div ref={printRef} id="job-packet">
        <style>{`
          @media print {
            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .page-break { page-break-before: always; }
            .avoid-break { page-break-inside: avoid; }
            @page { size: letter; margin: 0.5in; }
          }
          #job-packet { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; }
          #job-packet table { border-collapse: collapse; width: 100%; }
          #job-packet th, #job-packet td { border: 1px solid #D1D5DB; padding: 6px 10px; font-size: 12px; }
          #job-packet th { background: #F3F4F6; font-weight: 700; text-transform: uppercase; font-size: 10px; color: #374151; }
          .check-box { width: 16px; height: 16px; border: 2px solid #6B7280; display: inline-block; border-radius: 2px; vertical-align: middle; }
          .section-header { background: #0f2a3e; color: white; padding: 8px 14px; font-size: 14px; font-weight: 700; margin: 0; }
          .sub-header { background: #C6A24E; color: white; padding: 6px 14px; font-size: 12px; font-weight: 700; margin: 0; }
        `}</style>

        {/* ════════════════════════════════════════════════════════════════
            PAGE 1: COVER SHEET
        ════════════════════════════════════════════════════════════════ */}
        <div style={{ padding: 20 }}>
          {/* Abel header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f2a3e', paddingBottom: 12, marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>ABEL LUMBER</h1>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Manufacturing Job Packet</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Printed: {today}</div>
            </div>
          </div>

          {/* Job info grid */}
          <table style={{ marginBottom: 20 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, width: '15%', background: '#F9FAFB' }}>Builder</td>
                <td style={{ width: '35%' }}>{data.job.builderName}</td>
                <td style={{ fontWeight: 700, width: '15%', background: '#F9FAFB' }}>Status</td>
                <td style={{ width: '35%' }}>{data.job.status?.replace(/_/g, ' ')}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Community</td>
                <td>{data.job.community || '—'} {data.job.lotBlock ? `/ Lot ${data.job.lotBlock}` : ''}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>PM</td>
                <td>{data.job.pmName || '—'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Address</td>
                <td>{data.job.jobAddress || '—'}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Scheduled</td>
                <td>{fmtDate(data.job.scheduledDate)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Order ID</td>
                <td>{data.job.orderId || '—'}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Scope</td>
                <td>{data.job.scopeType || '—'}</td>
              </tr>
            </tbody>
          </table>

          {/* Validation gates */}
          <div className="section-header">VALIDATION GATES</div>
          <table style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th style={{ width: '5%' }}>✓</th>
                <th style={{ textAlign: 'left' }}>Gate</th>
                <th style={{ width: '15%' }}>Status</th>
                <th style={{ width: '25%' }}>Sign Off</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Pick List Generated', data.gates.pickListGenerated],
                ['All Materials Allocated', data.gates.allMaterialsAllocated],
                ['All Picks Verified', data.gates.allPicksVerified],
                ['Pre-Production QC Passed', data.gates.preProductionQCPassed],
                ['Final Unit QC Passed', data.gates.finalUnitQCPassed],
                ['Pre-Delivery QC Passed', data.gates.preDeliveryQCPassed],
              ].map(([label, passed], i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center' }}>{passed ? '✅' : <span className="check-box" />}</td>
                  <td style={{ fontWeight: 600 }}>{label as string}</td>
                  <td style={{ textAlign: 'center', color: passed ? '#065F46' : '#991B1B', fontWeight: 600 }}>
                    {passed ? 'PASS' : 'PENDING'}
                  </td>
                  <td style={{ borderBottom: '1px solid #9CA3AF' }}></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Order summary */}
          <div className="section-header">ORDER SUMMARY — {data.orderItems.length} Line Items</div>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>SKU</th>
                <th style={{ textAlign: 'left' }}>Product</th>
                <th style={{ textAlign: 'center' }}>Size</th>
                <th style={{ textAlign: 'center' }}>Handing</th>
                <th style={{ textAlign: 'center' }}>Qty</th>
                <th style={{ textAlign: 'center' }}>Category</th>
              </tr>
            </thead>
            <tbody>
              {data.orderItems.map((item: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.sku}</td>
                  <td>{item.productName || item.description}</td>
                  <td style={{ textAlign: 'center' }}>{item.doorSize || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{item.handing || '—'}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>{item.category || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pick progress summary */}
          <div style={{ marginTop: 16, padding: 12, background: '#F9FAFB', border: '1px solid #D1D5DB', fontSize: 12 }}>
            <strong>Pick Summary:</strong> {data.pickSummary.total} items total
            — {data.pickSummary.verified} verified
            — {data.pickSummary.picked} picked
            — {data.pickSummary.pending} pending
            {data.pickSummary.short > 0 && <span style={{ color: '#DC2626', fontWeight: 700 }}> — {data.pickSummary.short} SHORT</span>}
          </div>

          {data.job.buildSheetNotes && (
            <div style={{ marginTop: 12, padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 12 }}>
              <strong>Notes:</strong> {data.job.buildSheetNotes}
            </div>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════════════
            PAGE 2+: PICK LIST (sorted by zone for walk path)
        ════════════════════════════════════════════════════════════════ */}
        <div className="page-break" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>PICK LIST</h2>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Sorted by zone → bin for warehouse walk path</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                <th style={{ width: '10%', textAlign: 'center' }}>Zone</th>
                <th style={{ width: '10%', textAlign: 'center' }}>Bin</th>
                <th style={{ width: '14%', textAlign: 'left' }}>SKU</th>
                <th style={{ textAlign: 'left' }}>Description</th>
                <th style={{ width: '12%', textAlign: 'left', fontSize: 9 }}>For Assembly</th>
                <th style={{ width: '6%', textAlign: 'center' }}>Need</th>
                <th style={{ width: '6%', textAlign: 'center' }}>Picked</th>
                <th style={{ width: '7%', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedPicks.map((pick: any, i: number) => {
                const isShort = pick.status === 'SHORT'
                const isDone = pick.status === 'VERIFIED'
                return (
                  <tr key={i} style={{ background: isShort ? '#FEF2F2' : isDone ? '#F0FDF4' : 'white' }}>
                    <td style={{ textAlign: 'center' }}>
                      <span className="check-box" />
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600, fontSize: 11 }}>
                      {pick.invZone || pick.zone || '—'}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#065F46' }}>
                      {pick.invBin || '—'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{pick.sku}</td>
                    <td style={{ fontSize: 11 }}>{pick.description}</td>
                    <td style={{ fontSize: 9, color: '#6B7280' }}>
                      {pick.parentSku || '—'}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{pick.quantity}</td>
                    <td style={{ textAlign: 'center' }}>{pick.pickedQty || 0}</td>
                    <td style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: isShort ? '#DC2626' : isDone ? '#065F46' : '#6B7280' }}>
                      {pick.status}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Picker sign-off */}
          <div style={{ marginTop: 24, display: 'flex', gap: 40, fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Picked By (Print Name)</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Signature</div>
            </div>
            <div style={{ width: 120 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Date</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 40, fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Verified By (Print Name)</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Signature</div>
            </div>
            <div style={{ width: 120 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Date</div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            BUILD SHEETS — One per assembly unit
        ════════════════════════════════════════════════════════════════ */}
        {data.assemblyGroups.map((group, gIdx) => (
          <div key={gIdx} className="page-break" style={{ padding: 20 }}>
            {/* Unit header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>BUILD SHEET</h2>
                <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Unit {gIdx + 1} of {data.assemblyGroups.length}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
              </div>
            </div>

            {/* Door identity */}
            <div style={{ border: '2px solid #0f2a3e', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ background: '#0f2a3e', color: 'white', padding: '8px 14px', fontSize: 16, fontWeight: 700 }}>
                {group.parent.name}
              </div>
              <div style={{ padding: 12 }}>
                <table style={{ border: 'none' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', width: '12%', background: '#F9FAFB' }}>SKU</td>
                      <td style={{ border: 'none', padding: '4px 10px', fontFamily: 'monospace' }}>{group.parent.sku}</td>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', width: '12%', background: '#F9FAFB' }}>Order Qty</td>
                      <td style={{ border: 'none', padding: '4px 10px', fontWeight: 700, fontSize: 16 }}>{group.parent.orderQty}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', background: '#F9FAFB' }}>Door Size</td>
                      <td style={{ border: 'none', padding: '4px 10px', fontWeight: 600, fontSize: 14 }}>{group.parent.doorSize || '—'}</td>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', background: '#F9FAFB' }}>Handing</td>
                      <td style={{ border: 'none', padding: '4px 10px', fontWeight: 600, fontSize: 14 }}>
                        {group.parent.handing || '—'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', background: '#F9FAFB' }}>Core</td>
                      <td style={{ border: 'none', padding: '4px 10px' }}>{group.parent.coreType || '—'}</td>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', background: '#F9FAFB' }}>Panel</td>
                      <td style={{ border: 'none', padding: '4px 10px' }}>{group.parent.panelStyle || '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', background: '#F9FAFB' }}>Jamb Size</td>
                      <td style={{ border: 'none', padding: '4px 10px' }}>{group.parent.jambSize || '—'}</td>
                      <td style={{ fontWeight: 700, border: 'none', padding: '4px 10px', background: '#F9FAFB' }}></td>
                      <td style={{ border: 'none', padding: '4px 10px' }}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Door diagram placeholder */}
            <div className="avoid-break" style={{ border: '2px dashed #D1D5DB', borderRadius: 4, padding: 16, marginBottom: 16, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAFAFA' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 4 }}>🚪</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>
                  {group.parent.doorSize || 'Standard'} — {group.parent.handing === 'LH' ? 'Left Hand' : group.parent.handing === 'RH' ? 'Right Hand' : group.parent.handing || 'See spec'}
                </div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                  {group.parent.coreType || ''} {group.parent.panelStyle ? `/ ${group.parent.panelStyle}` : ''}
                  {group.parent.jambSize ? ` / ${group.parent.jambSize} jamb` : ''}
                </div>
              </div>
            </div>

            {/* Component checklist */}
            <div className="sub-header">COMPONENT CHECKLIST — {group.components.length} Parts</div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                  <th style={{ textAlign: 'left' }}>Component</th>
                  <th style={{ textAlign: 'left', width: '16%' }}>SKU</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Need</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Pulled</th>
                  <th style={{ textAlign: 'center', width: '10%' }}>Zone / Bin</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {group.components.map((comp: any, cIdx: number) => {
                  const isShort = comp.status === 'SHORT'
                  return (
                    <tr key={cIdx} style={{ background: isShort ? '#FEF2F2' : 'white' }}>
                      <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                      <td style={{ fontWeight: 500 }}>{comp.description}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{comp.sku}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>{comp.quantity}</td>
                      <td style={{ textAlign: 'center' }}>{comp.pickedQty || ''}</td>
                      <td style={{ textAlign: 'center', fontSize: 11 }}>
                        {comp.invZone || comp.zone || '—'}{comp.invBin ? ` / ${comp.invBin}` : ''}
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: isShort ? '#DC2626' : comp.status === 'VERIFIED' ? '#065F46' : '#6B7280' }}>
                        {comp.status}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* QC sign-off boxes */}
            <div className="avoid-break" style={{ marginTop: 20 }}>
              <div className="sub-header">QC SIGN-OFF</div>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center', width: '5%' }}>☐</th>
                    <th style={{ textAlign: 'left' }}>Check</th>
                    <th style={{ textAlign: 'center', width: '10%' }}>Pass</th>
                    <th style={{ textAlign: 'center', width: '10%' }}>Fail</th>
                    <th style={{ textAlign: 'left', width: '30%' }}>Notes</th>
                    <th style={{ textAlign: 'left', width: '15%' }}>Inspector</th>
                  </tr>
                </thead>
                <tbody>
                  {['Slab/Panel condition', 'Jamb fit & square', 'Hardware installed correctly', 'Hinge alignment & swing', 'Weatherstrip/seal (if ext)', 'Overall finish & appearance'].map((check, ci) => (
                    <tr key={ci}>
                      <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                      <td style={{ fontWeight: 500 }}>{check}</td>
                      <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                      <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                      <td></td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Assembly signature line */}
            <div style={{ marginTop: 20, display: 'flex', gap: 40, fontSize: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
                <div style={{ fontWeight: 600 }}>Built By</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
                <div style={{ fontWeight: 600 }}>QC Inspector</div>
              </div>
              <div style={{ width: 120 }}>
                <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
                <div style={{ fontWeight: 600 }}>Date</div>
              </div>
            </div>
          </div>
        ))}

        {/* ════════════════════════════════════════════════════════════════
            FINAL PAGE: DELIVERY & INSTALL INFO
        ════════════════════════════════════════════════════════════════ */}
        <div className="page-break" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>DELIVERY & INSTALLATION</h2>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Pre-delivery checklist and install details</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
            </div>
          </div>

          {/* Delivery details */}
          <table style={{ marginBottom: 20 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, width: '18%', background: '#F9FAFB' }}>Delivery Address</td>
                <td colSpan={3}>{data.job.jobAddress || '________________________________'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Community</td>
                <td>{data.job.community || '—'}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB', width: '18%' }}>Lot/Block</td>
                <td>{data.job.lotBlock || '—'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Scheduled Date</td>
                <td>{fmtDate(data.job.scheduledDate)}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Total Units</td>
                <td style={{ fontWeight: 700 }}>{data.orderItems.reduce((s: number, oi: any) => s + (oi.quantity || 0), 0)}</td>
              </tr>
            </tbody>
          </table>

          {/* Pre-delivery checklist */}
          <div className="section-header">PRE-DELIVERY CHECKLIST</div>
          <table>
            <tbody>
              {[
                'All units built and QC passed',
                'All picks verified — no shortages',
                'Units staged in delivery bay',
                'Load order confirmed (placement on truck)',
                'Protection wrapping/blankets applied',
                'Delivery paperwork printed & attached',
                'Customer/site contact confirmed',
                'Access/gate codes obtained (if needed)',
              ].map((item, i) => (
                <tr key={i}>
                  <td style={{ width: '4%', textAlign: 'center' }}><span className="check-box" /></td>
                  <td>{item}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Unit count confirmation */}
          <div style={{ marginTop: 20 }}>
            <div className="section-header">UNIT COUNT CONFIRMATION</div>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Ordered</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Loaded</th>
                  <th style={{ textAlign: 'center', width: '5%' }}>✓</th>
                </tr>
              </thead>
              <tbody>
                {data.orderItems.map((item: any, i: number) => (
                  <tr key={i}>
                    <td>{item.productName || item.description} <span style={{ color: '#6B7280', fontSize: 10 }}>({item.sku})</span></td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
                    <td style={{ textAlign: 'center' }}></td>
                    <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Signatures */}
          <div style={{ marginTop: 24 }}>
            <div className="sub-header">SIGN-OFF</div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 40, fontSize: 12, marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 24, marginBottom: 4 }}></div>
                  <div style={{ fontWeight: 600 }}>Loaded By</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 24, marginBottom: 4 }}></div>
                  <div style={{ fontWeight: 600 }}>Driver</div>
                </div>
                <div style={{ width: 120 }}>
                  <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 24, marginBottom: 4 }}></div>
                  <div style={{ fontWeight: 600 }}>Date / Time</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 40, fontSize: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 24, marginBottom: 4 }}></div>
                  <div style={{ fontWeight: 600 }}>Received By (Site Contact)</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 24, marginBottom: 4 }}></div>
                  <div style={{ fontWeight: 600 }}>Signature</div>
                </div>
                <div style={{ width: 120 }}>
                  <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 24, marginBottom: 4 }}></div>
                  <div style={{ fontWeight: 600 }}>Date / Time</div>
                </div>
              </div>
            </div>
          </div>

          {/* Damage/notes */}
          <div style={{ marginTop: 16, border: '1px solid #D1D5DB', borderRadius: 4, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>DELIVERY NOTES / DAMAGE REPORT</div>
            <div style={{ minHeight: 80, borderBottom: '1px solid #E5E7EB' }}></div>
            <div style={{ minHeight: 40 }}></div>
          </div>
        </div>
      </div>
    </>
  )
}
