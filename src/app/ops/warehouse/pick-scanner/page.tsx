'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import QRScanner from '@/components/ui/QRScanner'
import { decodeTag } from '@/lib/qr-tags'

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
    fetchJobs()
  }

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
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
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

        {jobsLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>Loading</div>
            <p>Fetching ready-to-pick jobs...</p>
          </div>
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
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>No jobs</div>
            <p style={{ color: '#ccc', fontSize: '1rem' }}>
              No jobs are ready for picking. Jobs appear here when status is
              IN_PRODUCTION or MATERIALS_LOCKED with a generated pick list.
            </p>
          </div>
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
              return (
                <div
                  key={j.id}
                  style={{
                    backgroundColor: '#2a2a3e',
                    border: '1px solid #444',
                    borderRadius: '0.75rem',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
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
              onClick={() => setScanMode('camera')}
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
            <QRScanner
              active={!!selectedJob && !verifying}
              onScan={code => {
                void runScan(code)
              }}
              onError={err => console.error('[QRScanner]', err)}
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
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Loading picks...</p>
        </div>
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
