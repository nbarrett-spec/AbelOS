'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

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

// ── Job-queue row shape (subset of /api/ops/jobs response) ───────────────
interface QueueJob {
  id: string
  jobNumber: string
  builderName: string | null
  community: string | null
  jobAddress: string | null
  scheduledDate: string | null
  status: string
  scopeType: string | null
  jobType: string | null
  assignedPMId: string | null
  assignedPM?: { firstName?: string; lastName?: string } | null
}

interface PMOption {
  id: string
  firstName: string
  lastName: string
}

// ── Door size parser: "2/8 x 6/8" → { widthIn: 32, heightIn: 80 } ───────
// Standard notation: first number = feet, second = inches. "2/8" = 2'8" = 32"
function parseDoorSize(size: string | null | undefined): { widthIn: number; heightIn: number } | null {
  if (!size) return null
  // Try "W/w x H/h" pattern (e.g. "2/8 x 6/8", "3/0x7/0")
  const m = size.match(/(\d+)\s*\/\s*(\d+)\s*[xX×]\s*(\d+)\s*\/\s*(\d+)/)
  if (m) {
    return {
      widthIn: parseInt(m[1]) * 12 + parseInt(m[2]),
      heightIn: parseInt(m[3]) * 12 + parseInt(m[4]),
    }
  }
  // Try "WxH" in inches (e.g. "32x80")
  const m2 = size.match(/(\d+)\s*[xX×]\s*(\d+)/)
  if (m2) {
    return { widthIn: parseInt(m2[1]), heightIn: parseInt(m2[2]) }
  }
  return null
}

// Generate cut specs for jambs and casing based on door dimensions
function getCutSpecs(
  dims: { widthIn: number; heightIn: number } | null,
  jambSize: string | null | undefined,
  casingCode: string | null | undefined,
  isExterior: boolean,
) {
  if (!dims) return []
  const specs: { piece: string; material: string; qty: number; length: string; notes: string }[] = []
  const w = dims.widthIn
  const h = dims.heightIn

  // Side jambs: cut to door height (typically the slab height)
  specs.push({
    piece: 'Side Jamb',
    material: jambSize ? `${jambSize} jamb stock` : 'Jamb stock',
    qty: 2,
    length: `${h}"`,
    notes: 'Full height — do not trim until test-fit',
  })

  // Head jamb: door width + 2× jamb dado depth (~3/8" each side = +3/4")
  // In practice head jamb = slab width + 2× reveal + 2× dado
  const headLen = w + 1 // +1" accounts for dado + reveal tolerance
  specs.push({
    piece: 'Head Jamb',
    material: jambSize ? `${jambSize} jamb stock` : 'Jamb stock',
    qty: 1,
    length: `${headLen}" (${w}" slab + 1" dado/reveal)`,
    notes: 'Verify rough opening before final cut',
  })

  // Door stop: 2 sides + 1 head
  specs.push({
    piece: 'Door Stop — Sides',
    material: 'Stop moulding',
    qty: 2,
    length: `${h}"`,
    notes: 'Miter at head; set 1/8" reveal from jamb face',
  })
  specs.push({
    piece: 'Door Stop — Head',
    material: 'Stop moulding',
    qty: 1,
    length: `${w + 1}"`,
    notes: 'Miter both ends — match side stops',
  })

  // Casing: 2 side pieces + 1 head piece (per side of door = x2 for both sides)
  const casingMat = casingCode ? `${casingCode} casing` : 'Casing'
  // Side casing: jamb height + 3/8" reveal + miter allowance
  const sideCasingLen = h + 0.375 + 0.25 // reveal + miter
  specs.push({
    piece: 'Side Casing',
    material: casingMat,
    qty: isExterior ? 2 : 4, // exterior = 1 side only; interior = both sides
    length: `${Math.ceil(sideCasingLen * 8) / 8}" (~${Math.ceil(sideCasingLen)}")`,
    notes: `Miter top at 45° — ${isExterior ? 'exterior face only' : 'both sides of wall'}`,
  })
  // Head casing: door width + 2× reveal + 2× casing width (typically 2.25-3.5")
  // Simplified: slab width + ~7"
  const headCasingLen = w + 7
  specs.push({
    piece: 'Head Casing',
    material: casingMat,
    qty: isExterior ? 1 : 2,
    length: `${headCasingLen}"`,
    notes: `Miter both ends at 45° — ${isExterior ? 'exterior face only' : 'both sides'}`,
  })

  if (isExterior) {
    specs.push({
      piece: 'Threshold / Sill',
      material: 'Threshold stock',
      qty: 1,
      length: `${w + 2}" (verify rough opening)`,
      notes: 'Level before fastening — shim as needed',
    })
  }

  return specs
}

// JobType → interior/exterior mapping. EXTERIOR covers final-front /
// front-door scopes. Everything else (TRIM_*, DOORS, HARDWARE_*, etc.) is
// treated as interior. CUSTOM/QC/PUNCH/WARRANTY remain unassigned and pass
// every type filter except when a specific bucket is selected.
const EXTERIOR_JOB_TYPES = new Set(['FINAL_FRONT', 'FINAL_FRONT_INSTALL'])
const INTERIOR_JOB_TYPES = new Set([
  'TRIM_1', 'TRIM_1_INSTALL',
  'TRIM_2', 'TRIM_2_INSTALL',
  'DOORS', 'DOOR_INSTALL',
  'HARDWARE', 'HARDWARE_INSTALL',
])

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
  const [printMode, setPrintMode] = useState<'brief' | 'standard' | 'full'>('full')
  const printRef = useRef<HTMLDivElement>(null)

  // ── Job queue state (shown above the search bar) ──────────────────────
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [pms, setPms] = useState<PMOption[]>([])
  const [typeFilter, setTypeFilter] = useState<'' | 'interior' | 'exterior'>('')
  const [builderFilter, setBuilderFilter] = useState<string>('')
  const [pmFilter, setPmFilter] = useState<string>('')

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

  // Load PM list once for the filter dropdown.
  useEffect(() => {
    fetch('/api/ops/pm/roster')
      .then(r => r.json())
      .then(d => {
        const list = (d.pms || d.data || []) as PMOption[]
        setPms(list)
      })
      .catch(() => { /* silent — filter just won't populate */ })
  }, [])

  // Fetch the queue. Re-runs when builder or PM filter changes (server-side
  // filters). Type filter is applied client-side so we don't refetch for it.
  const fetchQueue = useCallback(async () => {
    setQueueLoading(true)
    setQueueError('')
    try {
      const params = new URLSearchParams({
        status: 'MATERIALS_LOCKED,IN_PRODUCTION',
        limit: '100',
      })
      if (builderFilter.trim()) params.set('builderName', builderFilter.trim())
      if (pmFilter) params.set('assignedPMId', pmFilter)
      const res = await fetch(`/api/ops/jobs?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load job queue')
      const d = await res.json()
      setQueueJobs((d.data || []) as QueueJob[])
    } catch (e: any) {
      setQueueError(e?.message || 'Failed to load job queue')
      setQueueJobs([])
    } finally {
      setQueueLoading(false)
    }
  }, [builderFilter, pmFilter])

  useEffect(() => { fetchQueue() }, [fetchQueue])

  // Apply client-side type filter and sort by scheduledDate ASC (nulls last).
  const visibleQueueJobs = useMemo(() => {
    const filtered = queueJobs.filter(j => {
      if (!typeFilter) return true
      const jt = (j.jobType || '').toUpperCase()
      if (typeFilter === 'interior') return INTERIOR_JOB_TYPES.has(jt)
      if (typeFilter === 'exterior') return EXTERIOR_JOB_TYPES.has(jt)
      return true
    })
    return [...filtered].sort((a, b) => {
      const ta = a.scheduledDate ? new Date(a.scheduledDate).getTime() : Number.POSITIVE_INFINITY
      const tb = b.scheduledDate ? new Date(b.scheduledDate).getTime() : Number.POSITIVE_INFINITY
      return ta - tb
    })
  }, [queueJobs, typeFilter])

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
        const gateMsg = result.gateFailures?.length
          ? `\nBlocked by: ${result.gateFailures.join(', ')}`
          : ''
        setAdvanceMessage((result.error || 'Cannot advance — check gate requirements') + gateMsg)
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
    const fmtSched = (d: string | null) => {
      if (!d) return '—'
      const dt = new Date(d)
      if (Number.isNaN(dt.getTime())) return '—'
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    return (
      <div style={{ maxWidth: 1200, margin: '40px auto', padding: '0 20px' }}>
        <h1 className="text-fg" style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>🖨️ Print Job Packet</h1>
        <p className="text-fg-muted" style={{ fontSize: 13, marginBottom: 24 }}>Select a job to generate a printable pick list, build sheets, and delivery info</p>
        {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#991B1B', marginBottom: 16 }}>{error}</div>}

        {/* ── Job Queue (active manufacturing jobs) ─────────────────── */}
        <div className="bg-surface border border-border" style={{ borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="text-fg" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Active Manufacturing Jobs</h2>
              <p className="text-fg-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                Materials Locked &amp; In Production — sorted by scheduled date
              </p>
            </div>
            <button
              onClick={fetchQueue}
              className="border border-border bg-surface hover:bg-row-hover"
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
            >
              {queueLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {/* Filter row */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as '' | 'interior' | 'exterior')}
              className="border border-border bg-surface text-fg"
              style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13 }}
            >
              <option value="">All Types</option>
              <option value="interior">Interior</option>
              <option value="exterior">Exterior</option>
            </select>
            <input
              type="text"
              placeholder="Filter by builder…"
              value={builderFilter}
              onChange={e => setBuilderFilter(e.target.value)}
              className="border border-border bg-surface text-fg"
              style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, minWidth: 200 }}
            />
            <select
              value={pmFilter}
              onChange={e => setPmFilter(e.target.value)}
              className="border border-border bg-surface text-fg"
              style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13 }}
            >
              <option value="">All PMs</option>
              {pms.map(pm => (
                <option key={pm.id} value={pm.id}>
                  {pm.firstName} {pm.lastName}
                </option>
              ))}
            </select>
            {(typeFilter || builderFilter || pmFilter) && (
              <button
                onClick={() => { setTypeFilter(''); setBuilderFilter(''); setPmFilter('') }}
                className="text-fg-muted hover:text-fg"
                style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Clear filters
              </button>
            )}
          </div>

          {queueError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10, color: '#991B1B', fontSize: 12, marginBottom: 12 }}>
              {queueError}
            </div>
          )}

          <div className="border border-border" style={{ borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr className="bg-surface-muted text-fg-muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Job #</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Builder</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Community</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Address</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Scheduled</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {queueLoading && visibleQueueJobs.length === 0 && (
                  <tr><td colSpan={7} className="text-fg-muted" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>Loading queue…</td></tr>
                )}
                {!queueLoading && visibleQueueJobs.length === 0 && (
                  <tr><td colSpan={7} className="text-fg-muted" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>
                    No jobs match. Try clearing filters or use search below.
                  </td></tr>
                )}
                {visibleQueueJobs.map((j, idx) => (
                  <tr
                    key={j.id}
                    className="hover:bg-row-hover"
                    style={{ borderTop: idx === 0 ? 'none' : '1px solid #F3F4F6' }}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{j.jobNumber}</td>
                    <td style={{ padding: '10px 12px' }} className="text-fg">{j.builderName || '—'}</td>
                    <td style={{ padding: '10px 12px' }} className="text-fg-muted">{j.community || '—'}</td>
                    <td style={{ padding: '10px 12px' }} className="text-fg-muted">{j.jobAddress || '—'}</td>
                    <td style={{ padding: '10px 12px' }} className="text-fg-muted">{fmtSched(j.scheduledDate)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 11 }} className="text-fg-muted">
                      {j.status?.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => loadData(j.id)}
                        style={{ padding: '6px 12px', background: '#0f2a3e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Print Packet
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Search bar (existing) ──────────────────────────────────── */}
        <input
          type="text"
          placeholder="Search by job number or builder..."
          value={jobSearch}
          onChange={e => setJobSearch(e.target.value)}
          className="border border-border"
          style={{ width: '100%', padding: '12px 16px', borderRadius: 8, fontSize: 14 }}
        />
        {loading && <p className="text-fg-muted" style={{ textAlign: 'center', padding: 20 }}>Loading...</p>}
        {searchResults.length > 0 && (
          <div className="border border-border" style={{ borderRadius: 8, marginTop: 8, overflow: 'hidden' }}>
            {searchResults.map((j: any) => (
              <button
                key={j.id}
                onClick={() => loadData(j.id)}
                className="bg-surface hover:bg-row-hover"
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid #F3F4F6', cursor: 'pointer', fontSize: 14, border: 'none' }}
              >
                <strong>{j.jobNumber}</strong>
                <span className="text-fg-muted" style={{ marginLeft: 8 }}>{j.builderName}</span>
                <span className="text-fg-subtle" style={{ marginLeft: 8, fontSize: 12 }}>{j.community}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const sortedPicks = getSortedPicks()
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  // ── M-11: Cut List + Hardware Pick Ticket categorization ────────────
  // Uses simple string matching on category/description/sku since the
  // BOM doesn't carry a strict typology. Door slabs, jamb pieces, and
  // trim land in the cut list (anything you'd cut to length on the
  // manufacturing floor). Hinges, locks, knobs, deadbolts, latches,
  // strikes go to the hardware pick ticket. We pull from order items so
  // the panel sheets carry the right level of detail (size, handing,
  // jamb size, etc.) for the cut list, and merge in BOM components so
  // jambs/trim/hardware components purchased per-unit also appear.
  const cutListItems = (() => {
    const matches = (s: string | null | undefined, words: string[]) =>
      !!s && words.some(w => s.toLowerCase().includes(w))
    const cutWords = ['door', 'slab', 'jamb', 'trim', 'casing', 'mould', 'molding', 'panel', 'stile', 'rail', 'sill', 'mullion']
    const list: any[] = []
    // Order items first — these are the primary "build" lines
    for (const oi of (data.orderItems || [])) {
      const cat = oi.category || ''
      const desc = oi.productName || oi.description || ''
      if (matches(cat, cutWords) || matches(desc, cutWords) || matches(oi.sku, cutWords)) {
        list.push({
          sku: oi.sku,
          description: oi.productName || oi.description,
          dimensions: oi.doorSize || oi.jambSize || '—',
          handing: oi.handing || '—',
          coreType: oi.coreType || '',
          panelStyle: oi.panelStyle || '',
          jambSize: oi.jambSize || '',
          casingCode: oi.casingCode || '',
          quantity: oi.quantity,
          source: 'order',
        })
      }
    }
    // BOM components that are jamb/trim sub-pieces (per assembly)
    for (const grp of (data.assemblyGroups || [])) {
      for (const comp of grp.components) {
        const desc = comp.description || ''
        const sku = comp.sku || ''
        if (matches(desc, ['jamb', 'casing', 'trim', 'mould', 'molding', 'stop', 'sill']) || matches(sku, ['jamb', 'csg', 'trim'])) {
          list.push({
            sku: comp.sku,
            description: comp.description,
            dimensions: '—',
            handing: '—',
            coreType: '',
            panelStyle: '',
            jambSize: '',
            casingCode: '',
            quantity: comp.quantity,
            source: 'bom',
            parentSku: grp.parent.sku,
          })
        }
      }
    }
    return list
  })()

  const hardwareItems = (() => {
    const matches = (s: string | null | undefined, words: string[]) =>
      !!s && words.some(w => s.toLowerCase().includes(w))
    const hwWords = ['hinge', 'lock', 'knob', 'lever', 'deadbolt', 'latch', 'strike', 'handle', 'pull', 'hardware', 'screw', 'bolt', 'fastener', 'stop', 'closer', 'kick', 'magnetic']
    const merged: Record<string, { sku: string; description: string; quantity: number; finish: string; source: string }> = {}
    const add = (sku: string, description: string, qty: number, finish: string, source: string) => {
      const key = sku || description
      if (!key) return
      if (merged[key]) merged[key].quantity += qty
      else merged[key] = { sku: sku || '—', description, quantity: qty, finish, source }
    }
    // Order item hardware lines (e.g. lockset SKUs ordered directly)
    for (const oi of (data.orderItems || [])) {
      const cat = oi.category || ''
      const desc = oi.productName || oi.description || ''
      if (matches(cat, hwWords) || matches(desc, hwWords) || matches(oi.sku, ['hng', 'lk', 'kn', 'lvr', 'db'])) {
        add(oi.sku, desc, oi.quantity || 0, oi.hardwareFinish || '', 'order')
      }
    }
    // BOM hardware components (per-assembly hardware kits)
    for (const grp of (data.assemblyGroups || [])) {
      for (const comp of grp.components) {
        const desc = comp.description || ''
        const sku = comp.sku || ''
        if (matches(desc, hwWords) || matches(sku, ['hng', 'lk', 'kn', 'lvr', 'db'])) {
          add(comp.sku, desc, comp.quantity || 0, '', 'bom')
        }
      }
    }
    return Object.values(merged)
  })()

  return (
    <>
      {/* ── Screen-only toolbar ── */}
      <div className="no-print" style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, color: '#0f2a3e' }}>{data.job.jobNumber}</span>
          <span style={{ color: '#6B7280', marginLeft: 8 }}>{data.job.builderName}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Print mode toggle */}
          <div style={{ display: 'flex', background: '#E5E7EB', borderRadius: 6, overflow: 'hidden', marginRight: 4 }}>
            {([['brief', 'Brief'], ['standard', 'Standard'], ['full', 'Full']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setPrintMode(mode)}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: printMode === mode ? 700 : 500, cursor: 'pointer', border: 'none',
                  background: printMode === mode ? '#0f2a3e' : 'transparent',
                  color: printMode === mode ? 'white' : '#374151',
                  transition: 'all 0.15s',
                }}>
                {label}
              </button>
            ))}
          </div>
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
              <div style={{ background: advanceMessage.includes('moved') ? '#D1FAE5' : '#FEF3C7', border: `1px solid ${advanceMessage.includes('moved') ? '#6EE7B7' : '#FCD34D'}`, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: advanceMessage.includes('moved') ? '#065F46' : '#92400E', whiteSpace: 'pre-line' }}>
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
            html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print, nav, aside, header:not(#job-packet *), footer:not(#job-packet *) { display: none !important; }
            .page-break { page-break-before: always; break-before: page; }
            .avoid-break { page-break-inside: avoid; break-inside: avoid; }
            @page { size: letter; margin: 0.4in 0.5in; }
            #job-packet { position: absolute; left: 0; top: 0; width: 100%; }
            /* Keep section content together */
            #job-packet table { page-break-inside: auto; break-inside: auto; }
            #job-packet tr { page-break-inside: avoid; break-inside: avoid; }
            #job-packet .build-sheet-unit { page-break-inside: avoid; break-inside: avoid; }
          }
          @media screen {
            #job-packet { max-width: 900px; margin: 0 auto; }
            .page-break { border-top: 3px dashed #D1D5DB; margin-top: 32px; padding-top: 32px; }
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
            M-11: CUT LIST — Door slabs, jamb pieces, trim with dimensions
        ════════════════════════════════════════════════════════════════ */}
        <div className="page-break" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>CUT LIST</h2>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Door slabs, jamb pieces, casing & trim — cut to dimension before assembly</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
            </div>
          </div>

          {cutListItems.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', border: '1px dashed #D1D5DB', borderRadius: 4, color: '#6B7280', fontSize: 12 }}>
              No cut-list items identified for this job.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                  <th style={{ textAlign: 'left', width: '14%' }}>SKU</th>
                  <th style={{ textAlign: 'left' }}>Description</th>
                  <th style={{ textAlign: 'center', width: '12%' }}>Door Size</th>
                  <th style={{ textAlign: 'center', width: '10%' }}>Handing</th>
                  <th style={{ textAlign: 'center', width: '10%' }}>Jamb</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Qty</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Cut OK</th>
                </tr>
              </thead>
              <tbody>
                {cutListItems.map((item: any, i: number) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.sku}</td>
                    <td style={{ fontSize: 11 }}>
                      {item.description}
                      {item.coreType || item.panelStyle ? (
                        <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>
                          {item.coreType}{item.coreType && item.panelStyle ? ' / ' : ''}{item.panelStyle}
                          {item.casingCode ? ` / ${item.casingCode}` : ''}
                          {item.source === 'bom' && item.parentSku ? ` (for ${item.parentSku})` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600, fontSize: 12 }}>{item.dimensions || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.handing || '—'}</td>
                    <td style={{ textAlign: 'center', fontSize: 11 }}>{item.jambSize || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
                    <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 16, padding: 10, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, color: '#92400E' }}>
            <strong>Cutter note:</strong> Verify dimensions against build sheet for each unit before cutting. Mark each row when cut & labeled. Set aside off-cuts for pre-hung jamb assembly.
          </div>

          {/* Cutter sign-off */}
          <div style={{ marginTop: 24, display: 'flex', gap: 40, fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Cut By (Print Name)</div>
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
            M-11: HARDWARE PICK TICKET — Hinges, locks, knobs grouped for warehouse
        ════════════════════════════════════════════════════════════════ */}
        <div className="page-break" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>HARDWARE PICK TICKET</h2>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Hinges, locksets, knobs & accessories — grouped by SKU for warehouse pulling</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
            </div>
          </div>

          {hardwareItems.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', border: '1px dashed #D1D5DB', borderRadius: 4, color: '#6B7280', fontSize: 12 }}>
              No hardware items identified for this job.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                  <th style={{ textAlign: 'left', width: '18%' }}>SKU</th>
                  <th style={{ textAlign: 'left' }}>Description</th>
                  <th style={{ textAlign: 'center', width: '14%' }}>Finish</th>
                  <th style={{ textAlign: 'center', width: '10%' }}>Qty</th>
                  <th style={{ textAlign: 'center', width: '10%' }}>Pulled</th>
                </tr>
              </thead>
              <tbody>
                {hardwareItems.map((item: any, i: number) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>{item.sku}</td>
                    <td style={{ fontSize: 11 }}>{item.description}</td>
                    <td style={{ textAlign: 'center', fontSize: 11 }}>{item.finish || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{item.quantity}</td>
                    <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 16, padding: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', fontSize: 11, color: '#1E40AF' }}>
            <strong>Picker note:</strong> Pull complete count per SKU before moving to next item. Flag any SKU with zero on-hand to PM immediately. Bag hardware per unit if assemblies require — see build sheets.
          </div>

          {/* Picker sign-off */}
          <div style={{ marginTop: 24, display: 'flex', gap: 40, fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Picked By</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Verified By</div>
            </div>
            <div style={{ width: 120 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Date</div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            M-11: DELIVERY INFO — Address, scheduled date, builder contact
        ════════════════════════════════════════════════════════════════ */}
        <div className="page-break" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>DELIVERY INFO</h2>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Site, schedule & contact — verify before truck leaves yard</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
            </div>
          </div>

          {/* Big scheduled-date hero */}
          <div style={{ border: '2px solid #0f2a3e', borderRadius: 4, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F9FAFB' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Scheduled Delivery</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#0f2a3e', marginTop: 4 }}>{fmtDate(data.job.scheduledDate)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Drop Plan</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f2a3e', marginTop: 4 }}>{(data.job as any).dropPlan || 'Single Drop'}</div>
            </div>
          </div>

          {/* Address & site detail */}
          <div className="section-header">SITE & ADDRESS</div>
          <table style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, width: '22%', background: '#F9FAFB' }}>Delivery Address</td>
                <td colSpan={3} style={{ fontSize: 14, fontWeight: 600 }}>{data.job.jobAddress || '________________________________'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Builder</td>
                <td>{data.job.builderName}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB', width: '22%' }}>Community</td>
                <td>{data.job.community || '—'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Lot / Block</td>
                <td>{data.job.lotBlock || '—'}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Builder PO #</td>
                <td>{(data.job as any).bwpPoNumber || '—'}</td>
              </tr>
            </tbody>
          </table>

          {/* Contacts */}
          <div className="section-header">CONTACTS</div>
          <table style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, width: '22%', background: '#F9FAFB' }}>Builder Site Contact</td>
                <td style={{ fontSize: 13 }}>{(data.job as any).builderContact || '________________________________'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Abel PM</td>
                <td style={{ fontSize: 13 }}>{data.job.pmName || '________________________________'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Driver</td>
                <td style={{ fontSize: 13 }}>________________________________</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Gate / Access Code</td>
                <td style={{ fontSize: 13 }}>________________________________</td>
              </tr>
            </tbody>
          </table>

          {/* Load summary — what's going on the truck */}
          <div className="section-header">LOAD SUMMARY</div>
          <table>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, width: '22%', background: '#F9FAFB' }}>Total Line Items</td>
                <td>{data.orderItems.length}</td>
                <td style={{ fontWeight: 700, width: '22%', background: '#F9FAFB' }}>Total Units</td>
                <td style={{ fontWeight: 700 }}>{data.orderItems.reduce((s: number, oi: any) => s + (oi.quantity || 0), 0)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Assembly Units</td>
                <td>{data.assemblyGroups.length}</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Hardware SKUs</td>
                <td>{hardwareItems.length}</td>
              </tr>
            </tbody>
          </table>

          {/* Driver release sign-off */}
          <div style={{ marginTop: 24, display: 'flex', gap: 40, fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Released By (Yard)</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Driver</div>
            </div>
            <div style={{ width: 140 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Date / Time Out</div>
            </div>
          </div>
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
            BUILD SHEETS — Mode-dependent rendering
            Brief: 1-page summary table of all doors
            Standard: Compact cards, 2-3 per page with specs + components
            Full: One full page per door with assembly steps + QC
        ════════════════════════════════════════════════════════════════ */}

        {/* ── BRIEF MODE: single-page summary table ── */}
        {printMode === 'brief' && (
          <div className="page-break" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>BUILD BRIEF</h2>
                <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>{data.assemblyGroups.length} assembly units — summary view</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th style={{ width: '4%', textAlign: 'center' }}>#</th>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th style={{ textAlign: 'left', width: '12%' }}>SKU</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Size</th>
                  <th style={{ textAlign: 'center', width: '6%' }}>Hand</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Core</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Panel</th>
                  <th style={{ textAlign: 'center', width: '7%' }}>Jamb</th>
                  <th style={{ textAlign: 'center', width: '5%' }}>Qty</th>
                  <th style={{ textAlign: 'center', width: '5%' }}>Parts</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Status</th>
                  <th style={{ textAlign: 'center', width: '4%' }}>☐</th>
                </tr>
              </thead>
              <tbody>
                {data.assemblyGroups.map((group, gIdx) => {
                  const hasShort = group.components.some((c: any) => c.status === 'SHORT')
                  const allVerified = group.components.length > 0 && group.components.every((c: any) => c.status === 'VERIFIED')
                  return (
                    <tr key={gIdx} style={{ background: hasShort ? '#FEF2F2' : allVerified ? '#F0FDF4' : 'white' }}>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#C6A24E' }}>{gIdx + 1}</td>
                      <td style={{ fontWeight: 600, fontSize: 11 }}>{group.parent.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{group.parent.sku}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 12 }}>{group.parent.doorSize || '—'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 12 }}>{(group.parent.handing || '—').toUpperCase()}</td>
                      <td style={{ textAlign: 'center', fontSize: 10 }}>{group.parent.coreType || '—'}</td>
                      <td style={{ textAlign: 'center', fontSize: 10 }}>{group.parent.panelStyle || '—'}</td>
                      <td style={{ textAlign: 'center', fontSize: 10 }}>{group.parent.jambSize || '—'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#0f2a3e' }}>{group.parent.orderQty}</td>
                      <td style={{ textAlign: 'center', fontSize: 11 }}>{group.components.length}</td>
                      <td style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: hasShort ? '#DC2626' : allVerified ? '#065F46' : '#92400E' }}>
                        {hasShort ? 'SHORT' : allVerified ? 'READY' : 'IN PROG'}
                      </td>
                      <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Brief summary footer */}
            <div style={{ marginTop: 16, display: 'flex', gap: 24, fontSize: 12 }}>
              <div><strong>Total Units:</strong> {data.assemblyGroups.reduce((s, g) => s + (g.parent.orderQty || 0), 0)}</div>
              <div><strong>Assembly Groups:</strong> {data.assemblyGroups.length}</div>
              <div><strong>Short:</strong> <span style={{ color: '#DC2626', fontWeight: 700 }}>{data.assemblyGroups.filter(g => g.components.some((c: any) => c.status === 'SHORT')).length}</span></div>
              <div><strong>Ready:</strong> <span style={{ color: '#065F46', fontWeight: 700 }}>{data.assemblyGroups.filter(g => g.components.length > 0 && g.components.every((c: any) => c.status === 'VERIFIED')).length}</span></div>
            </div>

            {/* Notes / sign-off */}
            <div style={{ marginTop: 16, border: '1px solid #D1D5DB', borderRadius: 4, padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: '#6B7280', textTransform: 'uppercase', marginBottom: 4 }}>Notes</div>
              <div style={{ minHeight: 50, borderBottom: '1px solid #E5E7EB' }}></div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 40, fontSize: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 18, marginBottom: 4 }}></div>
                <div style={{ fontWeight: 600 }}>Production Lead</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 18, marginBottom: 4 }}></div>
                <div style={{ fontWeight: 600 }}>Date</div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 9, color: '#9CA3AF', textAlign: 'center' }}>
              Abel Lumber — Build Brief — {data.job.jobNumber} — Printed {today}
            </div>
          </div>
        )}

        {/* ── STANDARD MODE: compact cards, 2-3 per page ── */}
        {printMode === 'standard' && (() => {
          // Group assembly units into chunks of 3 per printed page
          const chunks: typeof data.assemblyGroups[] = []
          for (let i = 0; i < data.assemblyGroups.length; i += 3) {
            chunks.push(data.assemblyGroups.slice(i, i + 3))
          }
          return chunks.map((chunk, chunkIdx) => (
            <div key={`std-${chunkIdx}`} className="page-break" style={{ padding: 20 }}>
              {chunkIdx === 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>BUILD SHEETS — STANDARD</h2>
                    <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>{data.assemblyGroups.length} units — specs + components</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
                    <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName}</div>
                  </div>
                </div>
              )}
              {chunk.map((group, localIdx) => {
                const gIdx = chunkIdx * 3 + localIdx
                const hasShort = group.components.some((c: any) => c.status === 'SHORT')
                const allVerified = group.components.length > 0 && group.components.every((c: any) => c.status === 'VERIFIED')
                const handing = (group.parent.handing || '').toUpperCase()
                const isExterior = (data.job.scopeType || '').toLowerCase().includes('ext') || (group.parent.name || '').toLowerCase().includes('ext')
                const dims = parseDoorSize(group.parent.doorSize)
                const specs = getCutSpecs(dims, group.parent.jambSize, (data.orderItems.find((oi: any) => oi.productId === group.parent.productId) as any)?.casingCode, isExterior)

                return (
                  <div key={gIdx} className="avoid-break" style={{ border: '2px solid #D1D5DB', borderRadius: 6, marginBottom: 14, overflow: 'hidden' }}>
                    {/* Compact header */}
                    <div style={{ background: '#0f2a3e', color: 'white', padding: '6px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ background: '#C6A24E', color: '#0f2a3e', borderRadius: 4, padding: '2px 10px', fontWeight: 900, fontSize: 18 }}>{gIdx + 1}</span>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{group.parent.name}</span>
                        <span style={{ fontSize: 10, opacity: 0.7 }}>({group.parent.sku})</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 11, alignItems: 'center' }}>
                        {hasShort && <span style={{ background: '#DC2626', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: 10 }}>SHORT</span>}
                        {allVerified && <span style={{ background: '#065F46', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: 10 }}>READY</span>}
                      </div>
                    </div>

                    {/* Specs row */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #D1D5DB', fontSize: 11, background: '#F9FAFB' }}>
                      {[
                        ['Size', group.parent.doorSize || '—', true],
                        ['Hand', handing || '—', true],
                        ['Core', group.parent.coreType || '—', false],
                        ['Panel', group.parent.panelStyle || '—', false],
                        ['Jamb', group.parent.jambSize || '—', false],
                        ['Qty', group.parent.orderQty, true],
                      ].map(([label, value, bold], si) => (
                        <div key={si} style={{ flex: 1, padding: '5px 10px', borderRight: si < 5 ? '1px solid #E5E7EB' : 'none', textAlign: 'center' }}>
                          <div style={{ fontSize: 8, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>{label as string}</div>
                          <div style={{ fontSize: bold ? 14 : 11, fontWeight: bold ? 800 : 600, color: '#0f2a3e' }}>{value as string | number}</div>
                        </div>
                      ))}
                    </div>

                    {/* Compact component list */}
                    <table style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: '4%', textAlign: 'center', padding: '3px 6px', fontSize: 9 }}>☐</th>
                          <th style={{ textAlign: 'left', padding: '3px 6px', fontSize: 9 }}>Component</th>
                          <th style={{ textAlign: 'left', width: '14%', padding: '3px 6px', fontSize: 9 }}>SKU</th>
                          <th style={{ textAlign: 'center', width: '6%', padding: '3px 6px', fontSize: 9 }}>Need</th>
                          <th style={{ textAlign: 'center', width: '10%', padding: '3px 6px', fontSize: 9 }}>Zone/Bin</th>
                          <th style={{ textAlign: 'center', width: '7%', padding: '3px 6px', fontSize: 9 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.components.map((comp: any, cIdx: number) => {
                          const isShortC = comp.status === 'SHORT'
                          const isVerifiedC = comp.status === 'VERIFIED'
                          return (
                            <tr key={cIdx} style={{ background: isShortC ? '#FEF2F2' : isVerifiedC ? '#F0FDF4' : 'white' }}>
                              <td style={{ textAlign: 'center', padding: '2px 6px' }}>
                                {isVerifiedC ? <span style={{ color: '#065F46', fontSize: 12 }}>✓</span> : <span className="check-box" style={{ width: 12, height: 12 }} />}
                              </td>
                              <td style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px' }}>
                                {comp.description}
                                {isShortC && <span style={{ color: '#DC2626', fontWeight: 800, marginLeft: 4, fontSize: 9 }}>SHORT</span>}
                              </td>
                              <td style={{ fontFamily: 'monospace', fontSize: 9, padding: '2px 6px' }}>{comp.sku}</td>
                              <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 11, padding: '2px 6px' }}>{comp.quantity}</td>
                              <td style={{ textAlign: 'center', fontSize: 9, padding: '2px 6px', color: '#065F46' }}>
                                {comp.invZone || comp.zone || '—'}{comp.invBin ? `/${comp.invBin}` : ''}
                              </td>
                              <td style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, padding: '2px 6px', color: isShortC ? '#DC2626' : isVerifiedC ? '#065F46' : '#92400E' }}>
                                {comp.status}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    {/* Compact cut specs (if available) */}
                    {specs.length > 0 && (
                      <div style={{ borderTop: '1px solid #D1D5DB' }}>
                        <div style={{ background: '#F3F4F6', padding: '3px 14px', fontSize: 10, fontWeight: 700, color: '#374151' }}>
                          CUT SPECS — {group.parent.doorSize} {dims ? `(${dims.widthIn}" × ${dims.heightIn}")` : ''}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 0, fontSize: 10, padding: '4px 14px 6px' }}>
                          {specs.map((s, si) => (
                            <div key={si} style={{ width: '50%', display: 'flex', gap: 6, padding: '1px 0' }}>
                              <span className="check-box" style={{ width: 10, height: 10, flexShrink: 0, marginTop: 2 }} />
                              <span><strong>{s.piece}</strong> ({s.qty}): <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f2a3e' }}>{s.length}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              <div style={{ fontSize: 9, color: '#9CA3AF', textAlign: 'center', marginTop: 8 }}>
                Abel Lumber — Build Sheet (Standard) — {data.job.jobNumber} — Page {chunkIdx + 1} of {chunks.length} — Printed {today}
              </div>
            </div>
          ))
        })()}

        {/* ── FULL MODE: one page per door (original stellar build sheet) ── */}
        {printMode === 'full' && data.assemblyGroups.map((group, gIdx) => {
          const hasShort = group.components.some((c: any) => c.status === 'SHORT')
          const allVerified = group.components.length > 0 && group.components.every((c: any) => c.status === 'VERIFIED')
          const handing = (group.parent.handing || '').toUpperCase()
          const isLH = handing.includes('L')
          const isRH = handing.includes('R')
          const isExterior = (data.job.scopeType || '').toLowerCase().includes('ext') || (group.parent.name || '').toLowerCase().includes('ext')

          return (
          <div key={gIdx} className="page-break build-sheet-unit" style={{ padding: 20 }}>
            {/* ── Top banner: giant unit number + job ID ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', marginBottom: 0 }}>
              {/* Left: UNIT badge */}
              <div style={{ background: '#0f2a3e', color: 'white', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
                <div style={{ background: '#C6A24E', color: '#0f2a3e', borderRadius: 6, padding: '6px 14px', fontWeight: 900, fontSize: 28, lineHeight: 1, minWidth: 60, textAlign: 'center' }}>
                  {gIdx + 1}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, letterSpacing: 1, textTransform: 'uppercase' }}>Build Sheet — Unit {gIdx + 1} of {data.assemblyGroups.length}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{group.parent.name}</div>
                </div>
              </div>
              {/* Right: Job / Builder / Date */}
              <div style={{ background: '#F9FAFB', border: '2px solid #0f2a3e', borderLeft: 'none', padding: '8px 16px', display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', alignItems: 'flex-end', minWidth: 180 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#C6A24E' }}>{data.job.jobNumber}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{data.job.builderName}</div>
                <div style={{ fontSize: 10, color: '#6B7280' }}>{data.job.community || ''}{data.job.lotBlock ? ` / Lot ${data.job.lotBlock}` : ''}</div>
              </div>
            </div>

            {/* ── Short material alert ── */}
            {hasShort && (
              <div style={{ background: '#DC2626', color: 'white', padding: '8px 16px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>⚠</span>
                MATERIAL SHORTAGE — Check component list before starting build. Do NOT proceed until shorts are resolved with PM.
              </div>
            )}

            {/* ── Door specs + handing diagram side-by-side ── */}
            <div style={{ display: 'flex', gap: 0, marginTop: hasShort ? 0 : 0, border: '2px solid #D1D5DB', borderTop: hasShort ? 'none' : '2px solid #D1D5DB' }}>
              {/* Left: Key specs in large text */}
              <div style={{ flex: 1, padding: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Door Specifications</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>Size</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#0f2a3e', lineHeight: 1.1 }}>{group.parent.doorSize || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>Handing</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#0f2a3e', lineHeight: 1.1 }}>{handing || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>Core Type</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{group.parent.coreType || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>Panel Style</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{group.parent.panelStyle || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>Jamb Size</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{group.parent.jambSize || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>Order Qty</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#C6A24E', lineHeight: 1.1 }}>{group.parent.orderQty}</div>
                  </div>
                </div>

                <div style={{ marginTop: 10, padding: '6px 10px', background: '#F3F4F6', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  SKU: {group.parent.sku}
                </div>
              </div>

              {/* Right: Handing diagram */}
              <div style={{ width: 180, borderLeft: '2px solid #D1D5DB', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: 12, background: '#FAFAFA' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Handing</div>
                <svg viewBox="0 0 120 140" width="110" height="130" style={{ display: 'block' }}>
                  {/* Door frame */}
                  <rect x="10" y="10" width="100" height="120" fill="none" stroke="#D1D5DB" strokeWidth="2" />
                  {/* Door slab */}
                  {isLH ? (
                    <>
                      <line x1="10" y1="10" x2="10" y2="130" stroke="#0f2a3e" strokeWidth="4" />
                      <rect x="10" y="10" width="50" height="120" fill="#0f2a3e" fillOpacity="0.08" stroke="#0f2a3e" strokeWidth="2" />
                      {/* Swing arc */}
                      <path d="M 60 130 A 50 50 0 0 1 10 80" fill="none" stroke="#C6A24E" strokeWidth="2" strokeDasharray="4 3" />
                      {/* Arrow */}
                      <polygon points="12,83 18,78 16,87" fill="#C6A24E" />
                      {/* Hinge dots */}
                      <circle cx="13" cy="30" r="3" fill="#374151" />
                      <circle cx="13" cy="65" r="3" fill="#374151" />
                      <circle cx="13" cy="110" r="3" fill="#374151" />
                    </>
                  ) : isRH ? (
                    <>
                      <line x1="110" y1="10" x2="110" y2="130" stroke="#0f2a3e" strokeWidth="4" />
                      <rect x="60" y="10" width="50" height="120" fill="#0f2a3e" fillOpacity="0.08" stroke="#0f2a3e" strokeWidth="2" />
                      {/* Swing arc */}
                      <path d="M 60 130 A 50 50 0 0 0 110 80" fill="none" stroke="#C6A24E" strokeWidth="2" strokeDasharray="4 3" />
                      {/* Arrow */}
                      <polygon points="108,83 102,78 104,87" fill="#C6A24E" />
                      {/* Hinge dots */}
                      <circle cx="107" cy="30" r="3" fill="#374151" />
                      <circle cx="107" cy="65" r="3" fill="#374151" />
                      <circle cx="107" cy="110" r="3" fill="#374151" />
                    </>
                  ) : (
                    <>
                      <rect x="30" y="20" width="60" height="100" fill="#0f2a3e" fillOpacity="0.06" stroke="#9CA3AF" strokeWidth="1.5" strokeDasharray="4 2" />
                      <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280" fontWeight="600">SEE SPEC</text>
                    </>
                  )}
                </svg>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0f2a3e', marginTop: 4 }}>
                  {isLH ? 'LEFT HAND (LH)' : isRH ? 'RIGHT HAND (RH)' : handing || 'N/A'}
                </div>
                <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>
                  {isLH ? 'Hinges on LEFT, opens LEFT' : isRH ? 'Hinges on RIGHT, opens RIGHT' : 'Confirm with PM'}
                </div>
              </div>
            </div>

            {/* ── Component checklist ── */}
            <div style={{ marginTop: 14 }}>
              <div style={{ background: '#0f2a3e', color: 'white', padding: '7px 14px', fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>COMPONENT CHECKLIST — {group.components.length} Parts</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>
                  {allVerified ? '✓ ALL VERIFIED' : `${group.components.filter((c: any) => c.status === 'VERIFIED').length} of ${group.components.length} verified`}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                    <th style={{ textAlign: 'left' }}>Component</th>
                    <th style={{ textAlign: 'left', width: '15%' }}>SKU</th>
                    <th style={{ textAlign: 'center', width: '7%' }}>Need</th>
                    <th style={{ textAlign: 'center', width: '7%' }}>Pulled</th>
                    <th style={{ textAlign: 'center', width: '12%' }}>Zone / Bin</th>
                    <th style={{ textAlign: 'center', width: '6%' }}>On Hand</th>
                    <th style={{ textAlign: 'center', width: '8%' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.components.map((comp: any, cIdx: number) => {
                    const isShort = comp.status === 'SHORT'
                    const isVerified = comp.status === 'VERIFIED'
                    return (
                      <tr key={cIdx} style={{ background: isShort ? '#FEF2F2' : isVerified ? '#F0FDF4' : 'white' }}>
                        <td style={{ textAlign: 'center' }}>
                          {isVerified ? <span style={{ color: '#065F46', fontSize: 14 }}>✓</span> : <span className="check-box" />}
                        </td>
                        <td style={{ fontWeight: 600, fontSize: 11 }}>
                          {comp.description}
                          {isShort && <span style={{ color: '#DC2626', fontWeight: 800, marginLeft: 6, fontSize: 10 }}>⚠ SHORT</span>}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{comp.sku}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{comp.quantity}</td>
                        <td style={{ textAlign: 'center', fontSize: 12, fontWeight: isShort ? 700 : 400, color: isShort ? '#DC2626' : undefined }}>
                          {comp.pickedQty || ''}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#065F46' }}>
                          {comp.invZone || comp.zone || '—'}{comp.invBin ? ` / ${comp.invBin}` : ''}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: (comp.invOnHand || 0) <= 0 ? '#DC2626' : '#374151' }}>
                          {comp.invOnHand ?? '—'}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: isShort ? '#DC2626' : isVerified ? '#065F46' : '#92400E' }}>
                          {comp.status}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Cut specifications (derived from door size) ── */}
            {(() => {
              const dims = parseDoorSize(group.parent.doorSize)
              const specs = getCutSpecs(dims, group.parent.jambSize, (data.orderItems.find((oi: any) => oi.productId === group.parent.productId) as any)?.casingCode, isExterior)
              if (specs.length === 0 && !dims) return (
                <div style={{ marginTop: 14, padding: 10, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, color: '#92400E' }}>
                  <strong>Cut specs:</strong> Door size not parseable — cutter must verify dimensions from order docs or PM before cutting.
                </div>
              )
              return (
                <div className="avoid-break" style={{ marginTop: 14 }}>
                  <div style={{ background: '#0f2a3e', color: 'white', padding: '7px 14px', fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>CUT SPECIFICATIONS — {group.parent.doorSize || 'See spec'}</span>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>
                      {dims ? `Slab: ${dims.widthIn}" W × ${dims.heightIn}" H` : 'Verify dimensions'}
                    </span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                        <th style={{ textAlign: 'left', width: '20%' }}>Piece</th>
                        <th style={{ textAlign: 'left', width: '18%' }}>Material</th>
                        <th style={{ textAlign: 'center', width: '6%' }}>Qty</th>
                        <th style={{ textAlign: 'left', width: '22%' }}>Cut Length</th>
                        <th style={{ textAlign: 'left' }}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specs.map((s, si) => (
                        <tr key={si}>
                          <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                          <td style={{ fontWeight: 600, fontSize: 11 }}>{s.piece}</td>
                          <td style={{ fontSize: 11, color: '#374151' }}>{s.material}</td>
                          <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{s.qty}</td>
                          <td style={{ fontWeight: 700, fontSize: 12, color: '#0f2a3e', fontFamily: 'monospace' }}>{s.length}</td>
                          <td style={{ fontSize: 10, color: '#6B7280' }}>{s.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 6, padding: '6px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 10, color: '#92400E' }}>
                    <strong>⚠ Cutter:</strong> All dimensions are nominal from door size. Verify against rough opening and test-fit before final cuts. Mark each row when cut and labeled.
                  </div>
                </div>
              )
            })()}

            {/* ── Assembly steps + QC in two-column layout ── */}
            <div className="avoid-break" style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              {/* Left: Assembly sequence */}
              <div style={{ flex: 1 }}>
                <div className="sub-header">ASSEMBLY SEQUENCE</div>
                <table>
                  <tbody>
                    {[
                      { step: '1', task: 'Verify all components present per checklist above', critical: false },
                      { step: '2', task: 'Check slab for damage — reject if dented, scratched, or warped', critical: true },
                      { step: '3', task: `Pre-fit jamb to slab — confirm ${group.parent.jambSize || 'specified'} jamb size`, critical: false },
                      { step: '4', task: `Install hinges — ${isLH ? 'LEFT side' : isRH ? 'RIGHT side' : 'per spec'}`, critical: true },
                      { step: '5', task: 'Hang door in jamb — check swing, clearance, plumb', critical: false },
                      { step: '6', task: 'Install hardware (lockset, deadbolt if applicable)', critical: false },
                      { step: '7', task: isExterior ? 'Apply weatherstrip & threshold — verify seal' : 'Install casing & trim — check miters', critical: isExterior },
                      { step: '8', task: 'Final function test — open/close/latch/lock', critical: true },
                    ].map((s, si) => (
                      <tr key={si}>
                        <td style={{ width: '6%', textAlign: 'center', fontWeight: 700, fontSize: 11, color: '#0f2a3e' }}>{s.step}</td>
                        <td style={{ fontSize: 11, fontWeight: s.critical ? 600 : 400, color: s.critical ? '#0f2a3e' : '#374151' }}>
                          {s.critical && <span style={{ color: '#DC2626', marginRight: 4 }}>●</span>}
                          {s.task}
                        </td>
                        <td style={{ width: '6%', textAlign: 'center' }}><span className="check-box" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right: QC checklist */}
              <div style={{ flex: 1 }}>
                <div className="sub-header">QC CHECKLIST</div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Check</th>
                      <th style={{ textAlign: 'center', width: '12%' }}>OK</th>
                      <th style={{ textAlign: 'center', width: '12%' }}>Fail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      'Slab condition (no dents/scratches)',
                      'Jamb square & flush',
                      'Hinge alignment — no bind/sag',
                      'Hardware function — latch/lock',
                      'Door swing — full open/close',
                      'Gap & reveal — even all sides',
                      isExterior ? 'Weatherstrip seal — no daylight' : 'Casing fit & miter tight',
                      'Overall finish — customer ready',
                    ].map((check, ci) => (
                      <tr key={ci}>
                        <td style={{ fontSize: 11, fontWeight: 500 }}>{check}</td>
                        <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                        <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Notes area ── */}
            <div className="avoid-break" style={{ marginTop: 12, border: '1px solid #D1D5DB', borderRadius: 4, padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Build Notes / Issues</div>
              <div style={{ minHeight: 40, borderBottom: '1px solid #E5E7EB' }}></div>
              <div style={{ minHeight: 24 }}></div>
            </div>

            {/* ── Sign-off strip ── */}
            <div className="avoid-break" style={{ marginTop: 14, border: '2px solid #0f2a3e', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ background: '#0f2a3e', color: 'white', padding: '5px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>SIGN-OFF</div>
              <div style={{ padding: '10px 14px' }}>
                <div style={{ display: 'flex', gap: 20, fontSize: 11 }}>
                  <div style={{ flex: 2 }}>
                    <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 16, marginBottom: 3 }}></div>
                    <div style={{ fontWeight: 600 }}>Built By (Print Name)</div>
                  </div>
                  <div style={{ flex: 2 }}>
                    <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 16, marginBottom: 3 }}></div>
                    <div style={{ fontWeight: 600 }}>QC Inspector</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 16, marginBottom: 3 }}></div>
                    <div style={{ fontWeight: 600 }}>Start Time</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 16, marginBottom: 3 }}></div>
                    <div style={{ fontWeight: 600 }}>End Time</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 16, marginBottom: 3 }}></div>
                    <div style={{ fontWeight: 600 }}>Date</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Footer with page reference ── */}
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9CA3AF' }}>
              <span>Abel Lumber — Manufacturing Build Sheet</span>
              <span>{data.job.jobNumber} — Unit {gIdx + 1} of {data.assemblyGroups.length}</span>
              <span>Printed {today}</span>
            </div>
          </div>
          )
        })}

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

          {/* Load order — sorted by physical size for efficient trailer loading */}
          {(() => {
            // Categorize order items into doors vs trim/components
            const isDoor = (item: any) => {
              const name = ((item.productName || item.description || '') + ' ' + (item.category || '') + ' ' + (item.sku || '')).toLowerCase()
              return name.includes('door') || name.includes('slab') || !!item.doorSize || !!item.handing
            }
            const isTrim = (item: any) => !isDoor(item)

            // Get physical area for sorting (larger = loaded first = bottom of trailer)
            const getArea = (item: any): number => {
              const dims = parseDoorSize(item.doorSize)
              if (dims) return dims.widthIn * dims.heightIn
              // For trim, estimate from description keywords
              const desc = ((item.productName || item.description || '') + ' ' + (item.sku || '')).toLowerCase()
              if (desc.includes('shelf') || desc.includes('bullnose') || desc.includes('closet')) return 5000 // large trim
              if (desc.includes('jamb')) return 3000
              if (desc.includes('casing') || desc.includes('base')) return 2000
              if (desc.includes('crown') || desc.includes('chair')) return 1500
              if (desc.includes('stop') || desc.includes('shoe')) return 500
              return 1000 // default mid-size
            }

            const doors = data.orderItems.filter(isDoor).sort((a: any, b: any) => getArea(b) - getArea(a))
            const trim = data.orderItems.filter(isTrim).sort((a: any, b: any) => getArea(b) - getArea(a))

            return (
              <div style={{ marginTop: 20 }}>
                <div className="section-header">LOAD ORDER — Largest First for Trailer Stacking</div>
                <div style={{ padding: '6px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderTop: 'none', fontSize: 10, color: '#92400E' }}>
                  Load in order shown: largest/heaviest items first (trailer floor), smallest last (top/front). Check off each item as loaded.
                </div>
                {doors.length > 0 && (
                  <>
                    <div className="sub-header" style={{ marginTop: 8 }}>DOORS — {doors.length} items (load first)</div>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '4%', textAlign: 'center' }}>#</th>
                          <th style={{ textAlign: 'left' }}>Product</th>
                          <th style={{ textAlign: 'center', width: '10%' }}>Size</th>
                          <th style={{ textAlign: 'center', width: '7%' }}>Hand</th>
                          <th style={{ textAlign: 'center', width: '7%' }}>Qty</th>
                          <th style={{ textAlign: 'center', width: '8%' }}>Loaded</th>
                          <th style={{ textAlign: 'center', width: '5%' }}>☐</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doors.map((item: any, i: number) => (
                          <tr key={`d-${i}`}>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#C6A24E', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ fontSize: 11, fontWeight: 500 }}>{item.productName || item.description} <span style={{ color: '#6B7280', fontSize: 9 }}>({item.sku})</span></td>
                            <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 12 }}>{item.doorSize || '—'}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.handing || '—'}</td>
                            <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 13 }}>{item.quantity}</td>
                            <td style={{ textAlign: 'center' }}></td>
                            <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {trim.length > 0 && (
                  <>
                    <div className="sub-header" style={{ marginTop: 8 }}>TRIM & COMPONENTS — {trim.length} items (load after doors)</div>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '4%', textAlign: 'center' }}>#</th>
                          <th style={{ textAlign: 'left' }}>Product</th>
                          <th style={{ textAlign: 'left', width: '14%' }}>SKU</th>
                          <th style={{ textAlign: 'center', width: '7%' }}>Qty</th>
                          <th style={{ textAlign: 'center', width: '8%' }}>Loaded</th>
                          <th style={{ textAlign: 'center', width: '5%' }}>☐</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trim.map((item: any, i: number) => (
                          <tr key={`t-${i}`}>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#C6A24E', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ fontSize: 11, fontWeight: 500 }}>{item.productName || item.description}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{item.sku}</td>
                            <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 13 }}>{item.quantity}</td>
                            <td style={{ textAlign: 'center' }}></td>
                            <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )
          })()}

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

        {/* ════════════════════════════════════════════════════════════════
            QC / PUNCH WALKER SHEET — Site walkthrough after delivery
        ════════════════════════════════════════════════════════════════ */}
        <div className="page-break" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f2a3e', paddingBottom: 8, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f2a3e', margin: 0 }}>QC / PUNCH WALK SHEET</h2>
              <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>Post-delivery site inspection &amp; punch items</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#C6A24E' }}>{data.job.jobNumber}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{data.job.builderName} — {data.job.community || ''} {data.job.lotBlock ? `Lot ${data.job.lotBlock}` : ''}</div>
            </div>
          </div>

          {/* Walk info */}
          <table style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, width: '18%', background: '#F9FAFB' }}>Address</td>
                <td colSpan={3}>{data.job.jobAddress || '________________________________'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Walk Date</td>
                <td style={{ width: '32%' }}>______ / ______ / ______</td>
                <td style={{ fontWeight: 700, background: '#F9FAFB', width: '18%' }}>Inspector</td>
                <td>________________________________</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Walk Type</td>
                <td colSpan={3}>
                  <span style={{ marginRight: 20 }}><span className="check-box" style={{ marginRight: 6 }} /> Post-Install QC</span>
                  <span style={{ marginRight: 20 }}><span className="check-box" style={{ marginRight: 6 }} /> Builder Punch Walk</span>
                  <span style={{ marginRight: 20 }}><span className="check-box" style={{ marginRight: 6 }} /> Warranty / Callback</span>
                  <span><span className="check-box" style={{ marginRight: 6 }} /> Final Walk</span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Room-by-room inspection grid */}
          <div className="section-header">ROOM-BY-ROOM INSPECTION</div>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', width: '3%' }}>#</th>
                <th style={{ textAlign: 'left', width: '18%' }}>Room / Location</th>
                <th style={{ textAlign: 'left', width: '25%' }}>Door / Item</th>
                <th style={{ textAlign: 'center', width: '5%' }}>OK</th>
                <th style={{ textAlign: 'center', width: '5%' }}>Fix</th>
                <th style={{ textAlign: 'left', width: '32%' }}>Issue / Notes</th>
                <th style={{ textAlign: 'center', width: '6%' }}>Photo</th>
                <th style={{ textAlign: 'center', width: '6%' }}>Done</th>
              </tr>
            </thead>
            <tbody>
              {/* Pre-fill with order items if available, plus blank rows for write-in */}
              {data.orderItems.slice(0, 20).map((item: any, i: number) => (
                <tr key={`item-${i}`}>
                  <td style={{ fontSize: 10, color: '#9CA3AF' }}>{i + 1}</td>
                  <td></td>
                  <td style={{ fontSize: 11 }}>{item.productName || item.description} <span style={{ fontSize: 9, color: '#9CA3AF' }}>({item.sku})</span></td>
                  <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  <td></td>
                  <td style={{ textAlign: 'center', fontSize: 10, color: '#9CA3AF' }}>Y / N</td>
                  <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                </tr>
              ))}
              {/* Extra blank rows for write-in items */}
              {Array.from({ length: Math.max(5, 25 - Math.min(data.orderItems.length, 20)) }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  <td style={{ fontSize: 10, color: '#9CA3AF' }}>{Math.min(data.orderItems.length, 20) + i + 1}</td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                  <td></td>
                  <td style={{ textAlign: 'center', fontSize: 10, color: '#9CA3AF' }}>Y / N</td>
                  <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Common defect checklist */}
          <div className="avoid-break" style={{ marginTop: 16 }}>
            <div className="sub-header">COMMON DEFECT CHECKLIST</div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '4%', textAlign: 'center' }}>☐</th>
                  <th style={{ textAlign: 'left' }}>Defect Type</th>
                  <th style={{ textAlign: 'center', width: '8%' }}>Count</th>
                  <th style={{ textAlign: 'left', width: '40%' }}>Notes / Locations</th>
                </tr>
              </thead>
              <tbody>
                {[
                  'Door slab damage (dents, scratches, chips)',
                  'Jamb damage or out of square',
                  'Wrong handing installed',
                  'Hardware missing or wrong finish',
                  'Hinge alignment / binding / sagging',
                  'Weatherstrip / seal gap (exterior)',
                  'Lockset / deadbolt function failure',
                  'Casing / trim damage or misalignment',
                  'Wrong size delivered',
                  'Paint / stain touch-up needed',
                  'Threshold / sweep issue',
                  'Other (write in)',
                ].map((defect, di) => (
                  <tr key={di}>
                    <td style={{ textAlign: 'center' }}><span className="check-box" /></td>
                    <td style={{ fontWeight: 500, fontSize: 11 }}>{defect}</td>
                    <td style={{ textAlign: 'center' }}></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary & disposition */}
          <div className="avoid-break" style={{ marginTop: 16 }}>
            <div className="sub-header">DISPOSITION</div>
            <table>
              <tbody>
                <tr>
                  <td style={{ width: '25%', fontWeight: 700, background: '#F9FAFB' }}>Overall Result</td>
                  <td>
                    <span style={{ marginRight: 24 }}><span className="check-box" style={{ marginRight: 6 }} /> PASS — No issues</span>
                    <span style={{ marginRight: 24 }}><span className="check-box" style={{ marginRight: 6 }} /> CONDITIONAL — Minor punch items</span>
                    <span><span className="check-box" style={{ marginRight: 6 }} /> FAIL — Major rework required</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Total Punch Items</td>
                  <td>________</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, background: '#F9FAFB' }}>Return Trip Needed?</td>
                  <td>
                    <span style={{ marginRight: 24 }}><span className="check-box" style={{ marginRight: 6 }} /> Yes — Est. date: ______________</span>
                    <span><span className="check-box" style={{ marginRight: 6 }} /> No</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Additional notes */}
          <div style={{ marginTop: 16, border: '1px solid #D1D5DB', borderRadius: 4, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>ADDITIONAL NOTES / BUILDER COMMENTS</div>
            <div style={{ minHeight: 60, borderBottom: '1px solid #E5E7EB' }}></div>
            <div style={{ minHeight: 40 }}></div>
          </div>

          {/* Sign-offs */}
          <div style={{ marginTop: 20, display: 'flex', gap: 40, fontSize: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>QC Inspector / Punch Walker</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Builder Rep / Site Super</div>
            </div>
            <div style={{ width: 120 }}>
              <div style={{ borderBottom: '1px solid #1a1a2e', paddingBottom: 20, marginBottom: 4 }}></div>
              <div style={{ fontWeight: 600 }}>Date</div>
            </div>
          </div>

          {/* Scan prompt */}
          <div style={{ marginTop: 12, padding: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, fontSize: 11, textAlign: 'center', color: '#1E40AF' }}>
            <strong>📱 Scan this sheet when complete</strong> — Go to <strong>app.abellumber.com/ops/scan</strong> to photograph this page and auto-enter results into Abel OS
          </div>
        </div>
      </div>
    </>
  )
}
