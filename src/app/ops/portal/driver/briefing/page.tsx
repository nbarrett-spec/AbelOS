'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useStaffAuth } from '@/hooks/useStaffAuth'

// ──────────────────────────────────────────────────────────────────────────
// Driver Morning Briefing
//
// Structured prose summary of the day's route + an audio "play briefing"
// button that streams ElevenLabs TTS via the driver voice-briefing endpoint.
// Falls back to text-only if TTS isn't configured.
// ──────────────────────────────────────────────────────────────────────────

interface Stop {
  id: string
  deliveryNumber: string
  address: string | null
  builderName: string | null
  orderTotal: number | null
  window: string | null
  routeOrder: number
}

export default function DriverBriefingPage() {
  const { staff } = useStaffAuth()
  const [stops, setStops] = useState<Stop[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [generatingAudio, setGeneratingAudio] = useState(false)
  const [scriptFallback, setScriptFallback] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/delivery/today')
      if (!res.ok) return
      const data = await res.json()
      // Find current driver's bucket, default to first
      let mine = null
      for (const bucket of data.drivers || []) {
        if (staff && bucket.driverId === staff.id) {
          mine = bucket
          break
        }
      }
      if (!mine) mine = (data.drivers || [])[0] || null
      setStops(mine?.deliveries || [])
    } finally {
      setLoading(false)
    }
  }, [staff])

  useEffect(() => {
    load()
  }, [load])

  // Rough heuristics — not a real routing engine. Longest drive is first vs
  // the furthest address out of the list as a proxy. Total miles is a very
  // rough estimate from stop count until we wire a routing API.
  const { totalMiles, longestDriveMinutes, longestDriveDestination, firstStop } = useMemo(() => {
    if (!stops || stops.length === 0) {
      return {
        totalMiles: 0,
        longestDriveMinutes: 0,
        longestDriveDestination: null as string | null,
        firstStop: null as Stop | null,
      }
    }
    // Placeholder calc: 18 mi average per hop between stops
    const hops = Math.max(0, stops.length - 1)
    const totalMiles = Math.round(hops * 18 + 10) // + leaving/returning miles
    // Longest drive: mark whichever stop has "Celina", "Prosper", "Forney"
    // in the address as the "far" one; otherwise use the last stop. This is
    // intentionally crude — a real routing pass replaces this.
    const farCities = ['celina', 'prosper', 'forney', 'mckinney', 'waxahachie', 'granbury']
    let farStop: Stop | undefined
    let farMinutes = 0
    for (const s of stops) {
      if (!s.address) continue
      const lower = s.address.toLowerCase()
      for (const city of farCities) {
        if (lower.includes(city)) {
          farStop = s
          farMinutes = Math.max(farMinutes, city === 'celina' ? 42 : 35)
        }
      }
    }
    if (!farStop) farStop = stops[stops.length - 1]
    if (farMinutes === 0) farMinutes = 30

    return {
      totalMiles,
      longestDriveMinutes: farMinutes,
      longestDriveDestination: farStop?.builderName || farStop?.address?.split(',')[1]?.trim() || null,
      firstStop: stops[0] || null,
    }
  }, [stops])

  async function playBriefing() {
    if (!stops || stops.length === 0) return
    setGeneratingAudio(true)
    setAudioError(null)
    setScriptFallback(null)
    try {
      const res = await fetch('/api/ops/portal/driver/voice-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffName: staff?.firstName || 'driver',
          stops: stops.map((s) => ({
            address: s.address,
            window: s.window,
            builderName: s.builderName,
          })),
          totalMiles,
          longestDriveMinutes,
          longestDriveDestination,
        }),
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        // Auto-play
        setTimeout(() => {
          audioRef.current?.play().catch(() => {
            // Some browsers block autoplay — user can tap play manually
          })
        }, 50)
      } else if (res.status === 503) {
        const data = await res.json()
        setScriptFallback(data.script || null)
        setAudioError('Voice not configured — showing script.')
      } else {
        const data = await res.json().catch(() => ({}))
        setScriptFallback(data.script || null)
        setAudioError(data.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      setAudioError(e?.message || 'Network error')
    } finally {
      setGeneratingAudio(false)
    }
  }

  const firstWindow = firstStop?.window
    ? new Date(firstStop.window).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 32 }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--canvas, #0e1113)',
          borderBottom: '1px solid var(--border, #2a2722)',
          padding: '12px 16px',
        }}
      >
        <Link
          href="/ops/portal/driver"
          style={{ fontSize: 13, color: 'var(--fg-muted, #a39a8a)', textDecoration: 'none' }}
        >
          ← Route
        </Link>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
          Morning briefing
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', marginTop: 2 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </header>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 14 }}>Loading…</div>
      ) : !stops || stops.length === 0 ? (
        <div style={{ padding: 24, fontSize: 14, color: 'var(--fg-muted, #a39a8a)' }}>
          No stops on your route today. Enjoy the breather.
        </div>
      ) : (
        <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Hero line */}
          <section
            style={{
              padding: 20,
              background: 'var(--surface, #161a1d)',
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 14,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--fg-muted, #a39a8a)' }}>
              Good morning{staff?.firstName ? `, ${staff.firstName}` : ''}.
            </div>
            <div style={{ fontSize: 18, marginTop: 6, lineHeight: 1.5 }}>
              {stops.length} stop{stops.length === 1 ? '' : 's'} today
              {firstWindow ? <>, first at <strong>{firstWindow}</strong></> : null}
              {longestDriveDestination ? (
                <>, longest drive is <strong>{longestDriveDestination}</strong> (~{longestDriveMinutes} min)</>
              ) : null}
              , total miles ~<strong>{totalMiles}</strong>.
            </div>
          </section>

          {/* Play briefing */}
          <button
            onClick={playBriefing}
            disabled={generatingAudio}
            style={{
              minHeight: 64,
              padding: '18px 20px',
              fontSize: 17,
              fontWeight: 700,
              background: 'var(--accent-fg, #c6a24e)',
              color: '#0e1113',
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              opacity: generatingAudio ? 0.7 : 1,
            }}
          >
            {generatingAudio ? 'Preparing audio…' : '▶  Play briefing'}
          </button>
          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              style={{ width: '100%', marginTop: -4 }}
            />
          )}
          {audioError && (
            <div style={{ fontSize: 12, color: '#f5c168' }}>{audioError}</div>
          )}
          {scriptFallback && (
            <div
              style={{
                padding: 16,
                background: 'var(--surface-muted, #1f2326)',
                border: '1px solid var(--border, #2a2722)',
                borderRadius: 10,
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {scriptFallback}
            </div>
          )}

          {/* Stop list preview */}
          <section style={{ marginTop: 8 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-muted, #a39a8a)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 10,
              }}
            >
              Today's stops
            </div>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stops.map((s, i) => (
                <li
                  key={s.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '12px 14px',
                    background: 'var(--surface, #161a1d)',
                    border: '1px solid var(--border, #2a2722)',
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      background: 'var(--surface-muted, #1f2326)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.builderName || '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', marginTop: 2 }}>
                      {s.address || 'no address'}
                    </div>
                  </div>
                  {s.window && (
                    <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', flexShrink: 0 }}>
                      {new Date(s.window).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </main>
      )}
    </div>
  )
}
