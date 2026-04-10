'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

const PICK_STATUSES = [
  { key: 'PENDING', label: 'Pending', color: '#95A5A6' },
  { key: 'PICKING', label: 'Picking', color: '#F1C40F' },
  { key: 'PICKED', label: 'Picked', color: '#3498DB' },
  { key: 'VERIFIED', label: 'Verified', color: '#27AE60' },
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

interface Job {
  id: string
  jobNumber: string
  builderName: string
  deliveryDate: string
}

export default function PickScannerPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [picks, setPicks] = useState<MaterialPick[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanInput, setScanInput] = useState('')
  const [flashFeedback, setFlashFeedback] = useState<'success' | 'error' | null>(null)
  const [verifying, setVerifying] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Focus scanner input on mount
  useEffect(() => {
    scanInputRef.current?.focus()
  }, [])

  // Load active jobs on mount (simplified - in real app would filter by status)
  useEffect(() => {
    fetchJobs()
  }, [])

  const fetchJobs = async () => {
    try {
      // This would normally come from an API that returns active jobs
      // For now, we'll show a message that jobs would be loaded
      setJobs([])
    } catch (err) {
      console.error('Failed to fetch jobs:', err)
    }
  }

  const handleJobSelect = async (jobId: string) => {
    setSelectedJobId(jobId)
    await fetchPicks(jobId)
    setTimeout(() => scanInputRef.current?.focus(), 100)
  }

  const fetchPicks = async (jobId: string) => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/ops/warehouse/picks-for-job?jobId=${jobId}`)
      if (!response.ok) throw new Error('Failed to fetch picks')
      const data = await response.json()
      setPicks(data.picks || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load picks')
    } finally {
      setLoading(false)
    }
  }

  const playSound = (type: 'success' | 'error') => {
    // Create audio context for beep sounds
    if (!audioRef.current) {
      audioRef.current = new Audio()
    }
    if (type === 'success') {
      // Success beep
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.frequency.value = 800
      oscillator.type = 'sine'
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1)
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.1)
    } else {
      // Error beep
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.frequency.value = 300
      oscillator.type = 'sine'
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15)
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.15)
    }
  }

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scanInput.trim() || !selectedJobId || verifying) return

    setVerifying(true)
    const scannedSku = scanInput.trim()

    try {
      // Find the first unverified pick
      const nextPick = picks.find(p => p.status !== 'VERIFIED')
      if (!nextPick) {
        setFlashFeedback('error')
        playSound('error')
        setError('All items have been verified!')
        setScanInput('')
        setTimeout(() => setFlashFeedback(null), 500)
        setVerifying(false)
        return
      }

      // Verify the pick
      const response = await fetch('/api/ops/warehouse/pick-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickId: nextPick.id,
          scannedSku,
        }),
      })

      const result = await response.json()

      if (result.verified) {
        setFlashFeedback('success')
        playSound('success')
        // Update the local picks list
        setPicks(
          picks.map(p =>
            p.id === nextPick.id ? { ...p, status: 'VERIFIED' } : p
          )
        )
      } else {
        setFlashFeedback('error')
        playSound('error')
        setError(
          `SKU Mismatch: Expected ${result.expected}, Scanned ${result.scanned}`
        )
      }

      setScanInput('')
      setTimeout(() => {
        setFlashFeedback(null)
        scanInputRef.current?.focus()
      }, 500)
    } catch (err) {
      setFlashFeedback('error')
      playSound('error')
      setError(err instanceof Error ? err.message : 'Scan failed')
      setScanInput('')
      setTimeout(() => {
        setFlashFeedback(null)
        scanInputRef.current?.focus()
      }, 500)
    } finally {
      setVerifying(false)
    }
  }

  const verifiedCount = picks.filter(p => p.status === 'VERIFIED').length
  const totalCount = picks.length

  const getStatusColor = (status: string): string => {
    const statusConfig = PICK_STATUSES.find(s => s.key === status)
    return statusConfig?.color || '#95A5A6'
  }

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
            fontSize: '4rem',
            animation: 'fadeOut 0.5s ease-out',
          }}
        >
          {flashFeedback === 'success' ? '✓' : '✗'}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', margin: 0 }}>
          Warehouse Pick Scanner
        </h1>
        <p style={{ color: '#aaa', margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
          Scan SKU barcodes to verify warehouse picks
        </p>
      </div>

      {/* Job Selector */}
      {!selectedJobId ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <p style={{ marginBottom: '1rem', color: '#ccc' }}>
            No jobs loaded. In production, select an active job to begin picking.
          </p>
          <Link href="/ops/manufacturing" style={{ color: '#E67E22' }}>
            ← Back to Manufacturing
          </Link>
        </div>
      ) : (
        <>
          {/* Scan input - extra large for accessibility */}
          <form onSubmit={handleScan} style={{ marginBottom: '2rem' }}>
            <input
              ref={scanInputRef}
              type="text"
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              placeholder="SCAN SKU HERE"
              style={{
                width: '100%',
                padding: '1.5rem',
                fontSize: '1.5rem',
                backgroundColor: '#2a2a3e',
                border: '3px solid #E67E22',
                borderRadius: '0.5rem',
                color: '#fff',
                fontWeight: 'bold',
                textAlign: 'center',
                textTransform: 'uppercase',
              }}
              disabled={verifying}
              autoComplete="off"
            />
          </form>

          {/* Progress Bar */}
          {totalCount > 0 && (
            <div style={{ marginBottom: '2rem' }}>
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
                  {verifiedCount} of {totalCount}
                </span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '2rem',
                  backgroundColor: '#3a3a4e',
                  borderRadius: '0.5rem',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${totalCount > 0 ? (verifiedCount / totalCount) * 100 : 0}%`,
                    backgroundColor: '#27AE60',
                    transition: 'width 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 'bold',
                    fontSize: '0.875rem',
                  }}
                >
                  {totalCount > 0 && verifiedCount > 0 && `${verifiedCount}/${totalCount}`}
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              style={{
                backgroundColor: 'rgba(231, 76, 60, 0.2)',
                border: '2px solid #E74C3C',
                borderRadius: '0.5rem',
                padding: '1rem',
                marginBottom: '1.5rem',
                color: '#FF6B6B',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              {error}
            </div>
          )}

          {/* Pick list - cards for large touch targets */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
              <p>Loading picks...</p>
            </div>
          ) : picks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📦</div>
              <p>No picks for this job</p>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                flex: 1,
                overflowY: 'auto',
              }}
            >
              {picks.map((pick, idx) => {
                const isNext = pick.status !== 'VERIFIED' && idx === picks.findIndex(p => p.status !== 'VERIFIED')
                const statusColor = getStatusColor(pick.status)

                return (
                  <div
                    key={pick.id}
                    style={{
                      backgroundColor: isNext ? '#3a3a4e' : '#2a2a3e',
                      border: isNext ? '3px solid #E67E22' : '1px solid #444',
                      borderRadius: '0.75rem',
                      padding: '1.5rem',
                      opacity: pick.status === 'VERIFIED' ? 0.6 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    {/* SKU - large and bold */}
                    <div
                      style={{
                        fontSize: '1.5rem',
                        fontWeight: 'bold',
                        color: '#E67E22',
                        marginBottom: '0.75rem',
                        fontFamily: 'monospace',
                      }}
                    >
                      {pick.sku}
                    </div>

                    {/* Product name */}
                    <div
                      style={{
                        fontSize: '1rem',
                        color: '#ccc',
                        marginBottom: '0.75rem',
                      }}
                    >
                      {pick.description}
                    </div>

                    {/* Qty and location */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '1rem',
                        marginBottom: '1rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      <div>
                        <div style={{ color: '#999', marginBottom: '0.25rem' }}>QTY NEEDED</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                          {pick.quantity}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#999', marginBottom: '0.25rem' }}>
                          BIN LOCATION
                        </div>
                        <div
                          style={{
                            fontSize: '1.25rem',
                            fontWeight: 'bold',
                            color: '#27AE60',
                          }}
                        >
                          {pick.warehouseZone} {pick.binLocation}
                        </div>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div
                      style={{
                        display: 'inline-block',
                        padding: '0.5rem 1rem',
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
                  </div>
                )
              })}
            </div>
          )}

          {/* Complete button */}
          {totalCount > 0 && verifiedCount === totalCount && (
            <div style={{ marginTop: '2rem' }}>
              <button
                style={{
                  width: '100%',
                  padding: '1.5rem',
                  backgroundColor: '#27AE60',
                  color: '#fff',
                  fontSize: '1.25rem',
                  fontWeight: 'bold',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  // In production, would update job status
                  alert('All items verified! Job ready for next stage.')
                }}
              >
                ✓ All Items Verified — Mark Job Ready
              </button>
            </div>
          )}
        </>
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
