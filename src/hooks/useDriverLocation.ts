'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// useDriverLocation — GPS ping hook for the driver portal
//
// Uses navigator.geolocation.watchPosition with a 30s post throttle. On each
// successful fix (after throttle), POSTs to /api/ops/fleet/location. Gracefully
// degrades when the browser denies permission or GPS isn't available.
//
// Usage:
//   const gps = useDriverLocation({ crewId, enabled, activeDeliveryId })
//   gps.status       // 'idle' | 'prompting' | 'active' | 'denied' | 'error' | 'unsupported'
//   gps.lastFix      // { lat, lng, accuracy, at }
//   gps.lastPostAt   // Date | null
//   gps.error        // string | null
// ──────────────────────────────────────────────────────────────────────────

export type DriverLocationStatus =
  | 'idle'
  | 'prompting'
  | 'active'
  | 'denied'
  | 'error'
  | 'unsupported'

export interface DriverLocationFix {
  lat: number
  lng: number
  accuracy: number
  heading: number | null
  speed: number | null
  at: string
}

export interface UseDriverLocationOptions {
  crewId: string | null
  enabled: boolean
  activeDeliveryId?: string | null
  throttleMs?: number
}

export interface UseDriverLocationResult {
  status: DriverLocationStatus
  lastFix: DriverLocationFix | null
  lastPostAt: Date | null
  error: string | null
  postCount: number
}

export function useDriverLocation(opts: UseDriverLocationOptions): UseDriverLocationResult {
  const { crewId, enabled, activeDeliveryId, throttleMs = 30_000 } = opts

  const [status, setStatus] = useState<DriverLocationStatus>('idle')
  const [lastFix, setLastFix] = useState<DriverLocationFix | null>(null)
  const [lastPostAt, setLastPostAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [postCount, setPostCount] = useState(0)

  const watchIdRef = useRef<number | null>(null)
  const lastPostMsRef = useRef<number>(0)

  const postFix = useCallback(
    async (fix: DriverLocationFix) => {
      if (!crewId) return
      try {
        const res = await fetch('/api/ops/fleet/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            crewId,
            latitude: fix.lat,
            longitude: fix.lng,
            heading: fix.heading,
            speed: fix.speed,
            status: 'EN_ROUTE',
            activeDeliveryId: activeDeliveryId || null,
          }),
        })
        if (res.ok) {
          setLastPostAt(new Date())
          setPostCount((c) => c + 1)
          setError(null)
        } else {
          // Non-fatal — we just missed a ping
          setError(`ping failed (${res.status})`)
        }
      } catch (e: any) {
        setError(e?.message || 'network error')
      }
    },
    [crewId, activeDeliveryId]
  )

  useEffect(() => {
    if (!enabled) {
      // Tear down watcher if running
      if (watchIdRef.current != null && typeof navigator !== 'undefined') {
        navigator.geolocation?.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      setStatus('idle')
      return
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported')
      return
    }

    setStatus('prompting')

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: DriverLocationFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading ?? null,
          speed: pos.coords.speed ?? null,
          at: new Date(pos.timestamp).toISOString(),
        }
        setLastFix(fix)
        setStatus('active')

        const now = Date.now()
        if (now - lastPostMsRef.current >= throttleMs) {
          lastPostMsRef.current = now
          postFix(fix)
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied')
          setError('Location permission denied')
        } else {
          setStatus('error')
          setError(err.message || 'Location error')
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 30_000,
      }
    )

    watchIdRef.current = id

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [enabled, throttleMs, postFix])

  return { status, lastFix, lastPostAt, error, postCount }
}
