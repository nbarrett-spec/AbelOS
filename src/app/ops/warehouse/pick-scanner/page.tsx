'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Warehouse, AlertTriangle } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import QRScanner from '@/components/ui/QRScanner'
import { decodeTag } from '@/lib/qr-tags'
import SopQuickAccess from '@/components/SopQuickAccess'
import EmptyState from '@/components/ui/EmptyState'

// Statuses the warehouse pick-scanner cares about. Kept as a single source
// of truth so the API filter and the on-screen "Showing:" chip can't drift.
const ACTIVE_PICK_STATUSES = ['MATERIALS_LOCKED', 'IN_PRODUCTION'] as const

const PICK_STATUSES = [
  { key: 'PENDING', label: 'Pending', color: '#95A5A6' },
  { key: 'PICKING', label: 'Picking', color: '#F1C40F' },
  { key: 'PICKED', label: 'Picked', color: '#3498DB' },
  { key: 'VERIFIED', label: 'Verified', color: '#27AE60' },
  { key: 'SHORT', label: 'Short', color: '#E74C3C' },
  { key: 'SUBSTITUTED', label: 'Substituted', color: '#9B59B6' },
]

interface MaterialPick {
  id: string
  sku: string
  description: string
  quantity: number
  pickedQty: number
  status: string
  binLocation: string | null
  warehouseZone: string | null
  product: { id: string; name: string; sku: string } | null
}

interface ReadyJob {
  id: string
  jobNumber: string
  builderName: string
  scheduledDate: string | null
  status: string
  orderNumber: string | null
  orderId: string | null
  totalPicks: number
  verifiedPicks: number
  pickedPicks: number
  shortPicks: number
  pendingPicks: number
  allComplete: boolean
}

// Tap-target minimum 48px for mobile/tablet picker use
const TAP_TARGET = 48

export default function PickScannerPage() {
  const { addToast } = useToast()
  const [jobs, setJobs] = useState<ReadyJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const [selectedJob, setSelectedJob] = useState<ReadyJob | null>(null)
  const [picks, setPicks] = useState<MaterialPick[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [skuFilter, setSkuFilter] = useState('')
  const [scanInput, setScanInput] = useState('')
  const [flashFeedback, setFlashFeedback] = useState<'success' | 'error' | null>(null)
  const [lastScanMessage, setLastScanMessage] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Camera vs. HID-barcode/text fallback. Default to camera for phone use.
  const [scanMode, setScanMode] = useState<'camera' | 'text'>('camera')

  // Manual job-number lookup (parallel path to QR scanning when camera fails)
  const [jobLookupInput, setJobLookupInput] = useState('')
  const [jobLookupError, setJobLookupError] = useState<string | null>(null)
  const [jobLookupLoading, setJobLookupLoading] = useState(false)

  // Camera initialization error surfaced from QRScanner — drives a banner so
  // the scanner area never goes blank when getUserMedia rejects.
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Cross-dock job IDs — jobs whose materials are flagged on incoming POs
  // for immediate dock-door staging (do NOT put away to bin). Populated from
  // /api/ops/warehouse/cross-dock on mount. If the fetch fails we fall back
  // to an empty Set so the scanner stays fully functional.
  const [crossDockJobIds, setCrossDockJobIds] = useState<Set<string>>(
    () => new Set<string>()
  )

  const scanInputRef = useRef<HTMLInputElement>(null)
  const verifyingRef = useRef(false)

  // ── Load ready-to-pick jobs ────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    try {
      setJobsLoading(true)
      setJobsError(null)
      const res = await fetch('/api/ops/warehouse/ready-to-pick')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to load jobs')
      setJobs([])
    } finally {
      setJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // ── Load cross-dock job IDs ────────────────────────────────────────────
  // Hits the same /api/ops/warehouse/cross-dock feed the receiving page uses
  // and flattens the per-line `jobs` arrays into a single Set of job IDs.
  // If anything goes wrong we log + leave the Set empty — picker workflow
  // must NOT be blocked when this fetch fails.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ops/warehouse/cross-dock')
        if (!res.ok) {
          console.warn(
            '[pick-scanner] cross-dock fetch returned',
            res.status
          )
          return
        }
        const data = await res.json()
        const lines: Array<{ jobs?: Array<{ id?: string }> }> = Array.isArray(
          data?.lines
        )
          ? data.lines
          : []
        const ids = new Set<string>()
        for (const line of lines) {
          if (!Array.isArray(line.jobs)) continue
          for (const j of line.jobs) {
            if (j && typeof j.id === 'string' && j.id) ids.add(j.id)
          }
        }
        if (!cancelled) setCrossDockJobIds(ids)
      } catch (err) {
        console.warn('[pick-scanner] cross-dock fetch failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Load picks for a specific job ──────────────────────────────────────
  const fetchPicks = useCallback(async (jobId: string) => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/ops/warehouse/picks-for-job?jobId=${jobId}`)
      if (!res.ok) throw new Error('Failed to fetch picks')
      const data = await res.json()
      setPicks(data.picks || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load picks')
    } finally {
      setLoading(false)
    }
  }, [])

  const startPicking = async (job: ReadyJob) => {
    setSelectedJob(job)
    setPicks([])
    setError(null)
    setLastScanMessage(null)
    await fetchPicks(job.id)
    if (scanMode === 'text') {
      setTimeout(() => scanInputRef.current?.focus(), 100)
    }
  }

  const backToJobList = () => {
    setSelectedJob(null)
    setPicks([])
    setScanInput('')
    setSkuFilter('')
    setError(null)
    setLastScanMessage(null)
    setCameraError(null)
    fetchJobs()
  }

  // ── Manual job lookup ─────────────────────────────────────────────────
  // Parallel path to QR scanning: lets the picker type a job number and jump
  // straight into the pick UI. Used when the camera is unavailable, when
  // jobs aren't yet listed (e.g. just transitioned to MATERIALS_LOCKED), or
  // for any picker who prefers keyboard entry.
  const lookupJobByNumber = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      setJobLookupError(null)
      setJobLookupLoading(true)
      try {
        // Prefer matches already in the loaded list — same-tab navigation
        // without an extra round-trip.
        const local = jobs.find(
          j => j.jobNumber.toLowerCase() === trimmed.toLowerCase()
        )
        if (local) {
          await startPicking(local)
          setJobLookupInput('')
          return
        }

        // Fall back to the jobs API, scoped to active pick statuses.
        const params = new URLSearchParams({
          search: trimmed,
          status: ACTIVE_PICK_STATUSES.join(','),
          limit: '5',
        })
        const res = await fetch(`/api/ops/jobs?${params.toString()}`)
        if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status})`)
        const data = await res.json()
        const jobsResult: any[] = data.jobs || data.data || []
        const exact =
          jobsResult.find(
            (j: any) =>
              (j.jobNumber || '').toLowerCase() === trimmed.toLowerCase()
          ) || jobsResult[0]

        if (!exact) {
          setJobLookupError(
            `No active pick job matches "${trimmed}". Job must be MATERIALS_LOCKED or IN_PRODUCTION.`
          )
          return
        }

        // Hydrate a ReadyJob shape good enough for the pick UI; counts will
        // be filled by fetchPicks once the user is in the pick view.
        const hydrated: ReadyJob = {
          id: exact.id,
          jobNumber: exact.jobNumber,
          builderName: exact.builderName || '',
          scheduledDate: exact.scheduledDate || null,
          status: exact.status || '',
          orderNumber: exact.orderNumber || exact.order?.orderNumber || null,
          orderId: exact.orderId || exact.order?.id || null,
          totalPicks: 0,
          verifiedPicks: 0,
          pickedPicks: 0,
          shortPicks: 0,
          pendingPicks: 0,
          allComplete: false,
        }
        await startPicking(hydrated)
        setJobLookupInput('')
      } catch (err) {
        setJobLookupError(
          err instanceof Error ? err.message : 'Lookup failed'
        )
      } finally {
        setJobLookupLoading(false)
      }
    },
    // startPicking depends on fetchPicks/scanMode but is stable enough here;
    // we intentionally re-create on jobs change so local hits are fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs]
  )

  // ── Audio feedback ─────────────────────────────────────────────────────
  const playSound = (type: 'success' | 'error') => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      const audioContext = new AC()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.frequency.value = type === 'success' ? 800 : 300
      oscillator.type = 'sine'
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + (type === 'success' ? 0.1 : 0.15)
      )
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + (type === 'success' ? 0.1 : 0.15))
    } catch {
      /* audio blocked — non-fatal */
    }
  }

  // ── Scan flow ──────────────────────────────────────────────────────────
  // Takes a raw scanned string. Decodes Abel QR URIs (abel://product/<sku>)
  // and falls back to treating the input as a bare SKU.
  const runScan = useCallback(
  async (raw: string) => {
    if (!raw || !selectedJob || verifyingRef.current) return
    verifyingRef.current = true
    setVerifying(true)
    setError(null)

    const decoded = decodeTag(raw)
    // Accept product tags and raw SKUs. Bay/pallet tags aren't part of the
    // pick-verification flow — show a clear error instead of a bogus
    // mismatch.
    if (decoded.kind !== 'product' && decoded.kind !== 'raw') {
      setFlashFeedback('error')
      playSound('error')
      setError(`Scanned a ${decoded.kind} tag — scan a product QR or SKU instead.`)
      setTimeout(() => setFlashFeedback(null), 600)
      verifyingRef.current = false
      setVerifying(false)
      return
    }
    const scannedSku = decoded.id.trim()
    if (!scannedSku) {
      verifyingRef.current = false
      setVerifying(false)
      return
    }

    try {
      // Find the first pick that still needs action, preferring one that
      // matches the scanned SKU (so pickers can scan any bin in any order).
      const targetBySku =
        picks.find(
          p =>
            p.status !== 'VERIFIED' &&
            p.status !== 'PICKED' &&
            p.status !== 'SHORT' &&
            p.sku.trim().toUpperCase() === scannedSku.toUpperCase()
        ) ||
        picks.find(
          p =>
            p.status !== 'VERIFIED' && p.status !== 'PICKED' && p.status !== 'SHORT'
        )

      if (!targetBySku) {
        setFlashFeedback('error')
        playSound('error')
        setError('All items on this job are already picked or short.')
        setTimeout(() => setFlashFeedback(null), 600)
        setScanInput('')
        setVerifying(false)
        verifyingRef.current = false
        return
      }

      const res = await fetch(
        `/api/ops/warehouse/picks/${targetBySku.id}/scan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scannedSku }),
        }
      )

      const result = await res.json().catch(() => ({}))

      if (res.ok && result.verified) {
        setFlashFeedback('success')
        playSound('success')
        setLastScanMessage(`Picked ${targetBySku.sku}`)
        setPicks(prev =>
          prev.map(p =>
            p.id === targetBySku.id
              ? { ...p, status: 'PICKED', pickedQty: p.quantity }
              : p
          )
        )
        if (result.jobAdvanced) {
          addToast({
            type: 'success',
            title: 'Job Staged',
            message: `All picks complete — ${selectedJob.jobNumber} advanced to STAGED.`,
          })
        }
      } else {
        setFlashFeedback('error')
        playSound('error')
        setError(
          result?.expected && result?.scanned
            ? `SKU Mismatch — expected ${result.expected}, scanned ${result.scanned}`
            : result?.error || 'Scan failed'
        )
      }
    } catch (err) {
      setFlashFeedback('error')
      playSound('error')
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanInput('')
      setTimeout(() => {
        setFlashFeedback(null)
        if (scanMode === 'text') scanInputRef.current?.focus()
      }, 500)
      setVerifying(false)
      verifyingRef.current = false
    }
  }, [selectedJob, picks, addToast, scanMode])

  // Wraps the runScan for the text-input form submit path.
  const handleScan = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await runScan(scanInput.trim())
    },
    [runScan, scanInput]
  )

  // ── Short-pick action ──────────────────────────────────────────────────
  const markShort = async (pick: MaterialPick) => {
    const reason = window.prompt(
      `Mark ${pick.sku} as SHORT. Reason? (opens purchasing inbox item)`,
      'Bin empty'
    )
    if (reason === null) return
    try {
      const res = await fetch(`/api/ops/warehouse/picks/${pick.id}/short`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) throw new Error('Failed to mark short')
      setPicks(prev =>
        prev.map(p => (p.id === pick.id ? { ...p, status: 'SHORT' } : p))
      )
      playSound('success')
      addToast({
        type: 'info',
        title: 'Short-pick filed',
        message: `${pick.sku} flagged for purchasing re-order.`,
      })
    } catch (err) {
      playSound('error')
      addToast({
        type: 'error',
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to mark short',
      })
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const pickedCount = picks.filter(
    p => p.status === 'VERIFIED' || p.status === 'PICKED'
  ).length
  const shortCount = picks.filter(p => p.status === 'SHORT').length
  const totalCount = picks.length

  const filteredPicks = skuFilter.trim()
    ? picks.filter(
        p =>
          p.sku.toLowerCase().includes(skuFilter.trim().toLowerCase()) ||
          (p.description || '')
            .toLowerCase()
            .includes(skuFilter.trim().toLowerCase()) ||
          (p.binLocation || '')
            .toLowerCase()
            .includes(skuFilter.trim().toLowerCase())
      )
    : picks

  const getStatusColor = (status: string): string => {
    const cfg = PICK_STATUSES.find(s => s.key === status)
    return cfg?.color || '#95A5A6'
  }

  // ── JOB LIST VIEW ──────────────────────────────────────────────────────
  if (!selectedJob) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#1a1a2e',
          color: '#fff',
          padding: '1rem',
        }}
      >
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', margin: 0 }}>
            Warehouse Pick Scanner
          </h1>
          <p style={{ color: '#aaa', margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
            Select a job to begin picking
          </p>
        </div>

        {/* Actions row */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            onClick={fetchJobs}
            style={{
              minHeight: TAP_TARGET,
              padding: '0.75rem 1.25rem',
              backgroundColor: '#2a2a3e',
              color: '#fff',
              border: '2px solid #C6A24E',
              borderRadius: '0.5rem',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <Link
            href="/ops/manufacturing"
            style={{
              minHeight: TAP_TARGET,
              padding: '0.75rem 1.25rem',
              backgroundColor: 'transparent',
              color: '#C6A24E',
              border: '2px solid #444',
              borderRadius: '0.5rem',
              fontSize: '1rem',
              fontWeight: 'bold',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Back to Manufacturing
          </Link>
        </div>

        {/* Manual job-number lookup — parallel path to QR scanning. Always
            visible so pickers can jump straight to a job by number even when
            the camera is unavailable or the job hasn't appeared in the list
            yet. */}
        <div
          style={{
            backgroundColor: '#2a2a3e',
            border: '1px solid #444',
            borderRadius: '0.75rem',
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <label
            htmlFor="pick-job-lookup"
            style={{
              display: 'block',
              fontSize: '0.75rem',
              color: '#aaa',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.5rem',
            }}
          >
            Look up by job number
          </label>
          <form
            onSubmit={e => {
              e.preventDefault()
              void lookupJobByNumber(jobLookupInput)
            }}
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            <input
              id="pick-job-lookup"
              type="text"
              value={jobLookupInput}
              onChange={e => setJobLookupInput(e.target.value)}
              placeholder="Job number (e.g. 1234567)"
              style={{
                flex: 1,
                minWidth: 200,
                minHeight: TAP_TARGET,
                padding: '0.75rem 1rem',
                fontSize: '1rem',
                backgroundColor: '#1a1a2e',
                border: '2px solid #444',
                borderRadius: '0.5rem',
                color: '#fff',
                fontWeight: 'bold',
                letterSpacing: '0.05em',
              }}
              autoComplete="off"
              disabled={jobLookupLoading}
            />
            <button
              type="submit"
              disabled={jobLookupLoading || !jobLookupInput.trim()}
              style={{
                minHeight: TAP_TARGET,
                padding: '0.75rem 1.5rem',
                backgroundColor: '#C6A24E',
                color: '#1a1a2e',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: 'bold',
                cursor: jobLookupLoading ? 'wait' : 'pointer',
                opacity: jobLookupLoading || !jobLookupInput.trim() ? 0.6 : 1,
              }}
            >
              {jobLookupLoading ? 'Looking up...' : 'Look up'}
            </button>
          </form>
          {jobLookupError && (
            <div
              style={{
                marginTop: '0.5rem',
                color: '#FF6B6B',
                fontSize: '0.85rem',
                fontWeight: 'bold',
              }}
            >
              {jobLookupError}
            </div>
          )}
        </div>

        {/* Status filter chip — makes the implicit job-list filter explicit
            so pickers know why a job they expected isn't showing. */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.4rem 0.75rem',
            backgroundColor: 'rgba(198, 162, 78, 0.12)',
            border: '1px solid #C6A24E',
            borderRadius: '999px',
            fontSize: '0.75rem',
            color: '#E8C97A',
            fontWeight: 'bold',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <span style={{ opacity: 0.7 }}>Showing:</span>
          <span>{ACTIVE_PICK_STATUSES.join(', ')} jobs</span>
        </div>

        {jobsLoading ? (
          <JobListSkeleton />
        ) : jobsError ? (
          <div
            style={{
              backgroundColor: 'rgba(231, 76, 60, 0.2)',
              border: '2px solid #E74C3C',
              borderRadius: '0.5rem',
              padding: '1rem',
              color: '#FF6B6B',
              fontWeight: 'bold',
            }}
          >
            {jobsError}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Warehouse className="w-8 h-8 text-fg-subtle" />}
            title="No jobs ready for picking"
            description="Jobs must be in MATERIALS_LOCKED or IN_PRODUCTION status. If a job should be here, check that its pick list has been generated."
            action={{ label: 'View All Jobs', href: '/ops/jobs' }}
            secondaryAction={{ label: 'Refresh', onClick: fetchJobs }}
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '1rem',
            }}
          >
            {jobs.map(j => {
              const pct =
                j.totalPicks > 0
                  ? Math.round(
                      ((j.verifiedPicks + j.pickedPicks) / j.totalPicks) * 100
                    )
                  : 0
              const isCrossDock = crossDockJobIds.has(j.id)
              return (
                <div
                  key={j.id}
                  style={{
                    backgroundColor: '#2a2a3e',
                    border: isCrossDock ? '2px solid #E74C3C' : '1px solid #444',
                    borderRadius: '0.75rem',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  {isCrossDock && (
                    <div
                      style={{
                        display: 'inline-block',
                        alignSelf: 'flex-start',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: '#E74C3C',
                        color: '#fff',
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Cross-Dock — Stage at Dock
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: 'monospace',
                          color: '#C6A24E',
                          fontSize: '1.25rem',
                          fontWeight: 'bold',
                        }}
                      >
                        {j.jobNumber}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: '#ccc' }}>
                        {j.builderName}
                        {j.orderNumber ? ` · ${j.orderNumber}` : ''}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #555',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {j.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.875rem', color: '#aaa' }}>
                    Scheduled:{' '}
                    {j.scheduledDate
                      ? new Date(j.scheduledDate).toLocaleDateString()
                      : 'TBD'}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '0.5rem',
                      fontSize: '0.75rem',
                    }}
                  >
                    <Stat label="Total" value={j.totalPicks} />
                    <Stat
                      label="Picked"
                      value={j.verifiedPicks + j.pickedPicks}
                      color="#27AE60"
                    />
                    <Stat label="Pending" value={j.pendingPicks} color="#F1C40F" />
                    <Stat label="Short" value={j.shortPicks} color="#E74C3C" />
                  </div>

                  {/* Progress bar */}
                  <div
                    style={{
                      height: '0.5rem',
                      backgroundColor: '#3a3a4e',
                      borderRadius: '0.25rem',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        backgroundColor: '#27AE60',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>

                  <button
                    onClick={() => startPicking(j)}
                    style={{
                      minHeight: TAP_TARGET,
                      padding: '0.875rem',
                      backgroundColor: '#C6A24E',
                      color: '#1a1a2e',
                      fontWeight: 'bold',
                      fontSize: '1rem',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                    }}
                  >
                    {j.allComplete ? 'Review' : 'Start Picking'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── PICK VIEW (selected job) ───────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1a1a2e',
        color: '#fff',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Cross-dock banner — render first so the picker sees it before any
          other UI on this view. The banner uses the brand-red palette
          requested in the W-15 spec (Tailwind utility classes mirror the
          receiving-page banner). */}
      {selectedJob && crossDockJobIds.has(selectedJob.id) && (
        <div
          className="bg-red-50 border-2 border-red-500 text-red-800 p-3 rounded-lg font-bold"
          role="alert"
          style={{ marginBottom: '1rem' }}
        >
          ⚠ CROSS-DOCK JOB — Stage at Dock Door, do NOT put away to bin
        </div>
      )}

      {/* Flash feedback overlay */}
      {flashFeedback && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor:
              flashFeedback === 'success'
                ? 'rgba(39, 174, 96, 0.9)'
                : 'rgba(231, 76, 60, 0.9)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '5rem',
            fontWeight: 'bold',
            animation: 'fadeOut 0.5s ease-out',
            pointerEvents: 'none',
          }}
        >
          {flashFeedback === 'success' ? 'OK' : 'X'}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>
            {selectedJob.jobNumber}
          </h1>
          <p style={{ color: '#aaa', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            {selectedJob.builderName}
            {selectedJob.orderNumber ? ` · ${selectedJob.orderNumber}` : ''}
          </p>
        </div>
        <button
          onClick={backToJobList}
          style={{
            minHeight: TAP_TARGET,
            padding: '0.75rem 1rem',
            backgroundColor: '#2a2a3e',
            color: '#fff',
            border: '2px solid #444',
            borderRadius: '0.5rem',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Back to Jobs
        </button>
      </div>

      {/* Scan mode toggle: phone camera (default) vs. text/HID-barcode */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.5rem',
          }}
        >
          <label
            style={{
              color: '#ccc',
              fontSize: '0.875rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
            }}
          >
            Scan SKU
          </label>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              type="button"
              onClick={() => {
                setScanMode('camera')
                // Give the camera a clean retry when the user explicitly
                // toggles back to it.
                setCameraError(null)
              }}
              style={{
                minHeight: 36,
                padding: '0.4rem 0.8rem',
                backgroundColor: scanMode === 'camera' ? '#C6A24E' : 'transparent',
                color: scanMode === 'camera' ? '#1a1a2e' : '#ccc',
                border: '1px solid #C6A24E',
                borderRadius: '0.4rem 0 0 0.4rem',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              Camera
            </button>
            <button
              type="button"
              onClick={() => {
                setScanMode('text')
                setTimeout(() => scanInputRef.current?.focus(), 50)
              }}
              style={{
                minHeight: 36,
                padding: '0.4rem 0.8rem',
                backgroundColor: scanMode === 'text' ? '#C6A24E' : 'transparent',
                color: scanMode === 'text' ? '#1a1a2e' : '#ccc',
                border: '1px solid #C6A24E',
                borderLeft: 'none',
                borderRadius: '0 0.4rem 0.4rem 0',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              Keyboard
            </button>
          </div>
        </div>

        {scanMode === 'camera' ? (
          <div style={{ marginBottom: '0.25rem' }}>
            {cameraError && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  backgroundColor: 'rgba(231, 76, 60, 0.15)',
                  border: '2px solid #E74C3C',
                  borderRadius: '0.5rem',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.5rem',
                  color: '#FFC1B6',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                }}
              >
                <AlertTriangle
                  size={18}
                  style={{ flexShrink: 0, marginTop: 2 }}
                  aria-hidden
                />
                <div>
                  Camera unavailable. Use manual entry below.
                  <button
                    type="button"
                    onClick={() => {
                      setScanMode('text')
                      setTimeout(() => scanInputRef.current?.focus(), 50)
                    }}
                    style={{
                      marginLeft: '0.5rem',
                      background: 'transparent',
                      color: '#C6A24E',
                      border: 'none',
                      textDecoration: 'underline',
                      fontWeight: 'bold',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Switch to keyboard
                  </button>
                </div>
              </div>
            )}
            <QRScanner
              active={!!selectedJob && !verifying}
              onScan={code => {
                void runScan(code)
              }}
              onError={err => {
                console.error('[QRScanner]', err)
                // Surface the failure in the page UI so the scanner area
                // never goes blank when getUserMedia rejects (no camera,
                // permission denied, lib failed to load, etc).
                const msg =
                  (err as any)?.message ||
                  (err as any)?.name ||
                  'Camera unavailable'
                setCameraError(typeof msg === 'string' ? msg : 'Camera unavailable')
              }}
              prompt="Scan product QR or barcode"
            />
          </div>
        ) : (
          <form onSubmit={handleScan}>
            <input
              ref={scanInputRef}
              type="text"
              autoFocus
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              placeholder="SCAN OR TYPE SKU"
              style={{
                width: '100%',
                minHeight: '64px',
                padding: '1.25rem',
                fontSize: '1.5rem',
                backgroundColor: '#2a2a3e',
                border: '3px solid #C6A24E',
                borderRadius: '0.5rem',
                color: '#fff',
                fontWeight: 'bold',
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
              disabled={verifying}
              autoComplete="off"
            />
          </form>
        )}
      </div>

      {/* SKU search filter — separate from scan input so pickers can lookup */}
      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          value={skuFilter}
          onChange={e => setSkuFilter(e.target.value)}
          placeholder="Search SKU / description / bin..."
          style={{
            width: '100%',
            minHeight: TAP_TARGET,
            padding: '0.75rem 1rem',
            fontSize: '1rem',
            backgroundColor: '#2a2a3e',
            border: '1px solid #444',
            borderRadius: '0.5rem',
            color: '#fff',
          }}
          autoComplete="off"
        />
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 'bold',
            }}
          >
            <span>Progress</span>
            <span>
              {pickedCount} of {totalCount} picked · {shortCount} short
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '1.5rem',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.5rem',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${totalCount > 0 ? (pickedCount / totalCount) * 100 : 0}%`,
                backgroundColor: '#27AE60',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}

      {/* Last scan message */}
      {lastScanMessage && !error && (
        <div
          style={{
            backgroundColor: 'rgba(39, 174, 96, 0.15)',
            border: '2px solid #27AE60',
            borderRadius: '0.5rem',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: '#B6EFCA',
            fontSize: '0.95rem',
            fontWeight: 'bold',
          }}
        >
          {lastScanMessage}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div
          style={{
            backgroundColor: 'rgba(231, 76, 60, 0.2)',
            border: '2px solid #E74C3C',
            borderRadius: '0.5rem',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: '#FF6B6B',
            fontSize: '0.95rem',
            fontWeight: 'bold',
          }}
        >
          {error}
        </div>
      )}

      {/* Pick list */}
      {loading ? (
        <PickListSkeleton />
      ) : filteredPicks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>
            {picks.length === 0
              ? 'No picks for this job.'
              : 'No picks match the current filter.'}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {filteredPicks.map(pick => {
            const statusColor = getStatusColor(pick.status)
            const isDone = pick.status === 'VERIFIED' || pick.status === 'PICKED'
            const isShort = pick.status === 'SHORT'
            return (
              <div
                key={pick.id}
                style={{
                  backgroundColor: isDone ? '#1f3324' : isShort ? '#3a1f1f' : '#2a2a3e',
                  border: `2px solid ${isDone ? '#27AE60' : isShort ? '#E74C3C' : '#444'}`,
                  borderRadius: '0.75rem',
                  padding: '1rem',
                  opacity: isDone ? 0.75 : 1,
                }}
              >
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                    color: '#C6A24E',
                    marginBottom: '0.5rem',
                    fontFamily: 'monospace',
                  }}
                >
                  {pick.sku}
                </div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    color: '#ccc',
                    marginBottom: '0.75rem',
                  }}
                >
                  {pick.description}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    marginBottom: '0.75rem',
                    fontSize: '0.875rem',
                  }}
                >
                  <div>
                    <div style={{ color: '#999' }}>QTY</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 'bold' }}>
                      {pick.pickedQty}/{pick.quantity}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#999' }}>BIN</div>
                    <div
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 'bold',
                        color: '#27AE60',
                      }}
                    >
                      {pick.warehouseZone || ''} {pick.binLocation || ''}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '0.4rem 0.75rem',
                      borderRadius: '0.25rem',
                      backgroundColor: statusColor,
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                    }}
                  >
                    {pick.status}
                  </div>
                  {!isDone && !isShort && (
                    <button
                      onClick={() => markShort(pick)}
                      style={{
                        minHeight: TAP_TARGET,
                        padding: '0.5rem 1rem',
                        backgroundColor: 'transparent',
                        color: '#E74C3C',
                        border: '2px solid #E74C3C',
                        borderRadius: '0.5rem',
                        fontSize: '0.9rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                      }}
                    >
                      Mark Short
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Warehouse SOPs for the current staff role */}
      <div style={{ marginTop: '1.5rem' }}>
        <SopQuickAccess role="WAREHOUSE_TECH" limit={5} title="Warehouse SOPs" />
      </div>

      <style jsx>{`
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  )
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div
      style={{
        backgroundColor: '#1a1a2e',
        border: '1px solid #3a3a4e',
        borderRadius: '0.25rem',
        padding: '0.5rem',
        textAlign: 'center',
      }}
    >
      <div style={{ color: '#888', fontSize: '0.65rem', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          color: color || '#fff',
          fontWeight: 'bold',
          fontSize: '1.1rem',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// Lightweight skeleton mimicking the job-card grid so the page never goes
// blank while /api/ops/warehouse/ready-to-pick is in flight.
function JobListSkeleton() {
  const cards = [0, 1, 2, 3]
  return (
    <div
      role="status"
      aria-label="Loading ready-to-pick jobs"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '1rem',
      }}
    >
      {cards.map(i => (
        <div
          key={i}
          style={{
            backgroundColor: '#2a2a3e',
            border: '1px solid #3a3a4e',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          <div
            style={{
              height: '1.5rem',
              width: '40%',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.25rem',
            }}
          />
          <div
            style={{
              height: '0.875rem',
              width: '70%',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.25rem',
            }}
          />
          <div
            style={{
              height: '0.875rem',
              width: '50%',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.25rem',
            }}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '0.5rem',
            }}
          >
            {[0, 1, 2, 3].map(j => (
              <div
                key={j}
                style={{
                  height: '2.5rem',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #3a3a4e',
                  borderRadius: '0.25rem',
                }}
              />
            ))}
          </div>
          <div
            style={{
              height: '0.5rem',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.25rem',
            }}
          />
          <div
            style={{
              height: '2.75rem',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.5rem',
            }}
          />
        </div>
      ))}
      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
      `}</style>
    </div>
  )
}

// Compact skeleton for the pick-rows list while picks-for-job is in flight.
function PickListSkeleton() {
  const rows = [0, 1, 2]
  return (
    <div
      role="status"
      aria-label="Loading picks"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        flex: 1,
      }}
    >
      {rows.map(i => (
        <div
          key={i}
          style={{
            backgroundColor: '#2a2a3e',
            border: '2px solid #3a3a4e',
            borderRadius: '0.75rem',
            padding: '1rem',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          <div
            style={{
              height: '1.25rem',
              width: '30%',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.25rem',
              marginBottom: '0.5rem',
            }}
          />
          <div
            style={{
              height: '0.95rem',
              width: '70%',
              backgroundColor: '#3a3a4e',
              borderRadius: '0.25rem',
              marginBottom: '0.75rem',
            }}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                height: '2.25rem',
                backgroundColor: '#1a1a2e',
                border: '1px solid #3a3a4e',
                borderRadius: '0.25rem',
              }}
            />
            <div
              style={{
                height: '2.25rem',
                backgroundColor: '#1a1a2e',
                border: '1px solid #3a3a4e',
                borderRadius: '0.25rem',
              }}
            />
          </div>
        </div>
      ))}
      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
      `}</style>
    </div>
  )
}
