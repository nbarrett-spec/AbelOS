'use client'

import { useEffect } from 'react'

/**
 * DriverServiceWorker — ensures the platform service worker (public/sw.js)
 * is registered when a driver opens the portal on a phone or tablet. The SW
 * caches /api/ops/delivery/today with a network-first / cache-fallback
 * strategy so a driver who loses signal in the middle of a run still sees
 * their stops.
 *
 * The shared <PWARegister/> component is only rendered on some layouts;
 * the driver portal has its own layout, so we double-register here. Browsers
 * are idempotent — re-registering the same scope is a no-op.
 */
export default function DriverServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[driver-sw] register failed', err)
        }
      })
  }, [])

  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Offline completion queue — localStorage-backed.
// Used by the detail page to retry POSTs when connection returns.
// ──────────────────────────────────────────────────────────────────────────

const QUEUE_KEY = 'abel.driver.pendingCompletions'

export interface PendingCompletion {
  id: string // deliveryId — one pending job per delivery
  payload: Record<string, unknown>
  queuedAt: string
  attempts: number
}

export function readQueue(): PendingCompletion[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as PendingCompletion[]
  } catch {
    return []
  }
}

export function writeQueue(items: PendingCompletion[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
  } catch {
    // Quota exceeded — we'd rather keep the pending job than crash. A real
    // fix here is IndexedDB but localStorage is good enough for <5MB total
    // across a small driver fleet.
  }
}

export function enqueueCompletion(item: PendingCompletion) {
  const q = readQueue().filter((x) => x.id !== item.id)
  q.push(item)
  writeQueue(q)
}

export function dequeueCompletion(id: string) {
  const q = readQueue().filter((x) => x.id !== id)
  writeQueue(q)
}

export function queueCount(): number {
  return readQueue().length
}

/**
 * Attempt to flush the queue. Called on mount and whenever `online` fires.
 * Returns the count of successfully flushed items.
 */
export async function flushQueue(): Promise<number> {
  if (typeof window === 'undefined') return 0
  if (!navigator.onLine) return 0
  const q = readQueue()
  if (q.length === 0) return 0

  let flushed = 0
  const remaining: PendingCompletion[] = []

  for (const item of q) {
    try {
      const res = await fetch(`/api/ops/delivery/${item.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      })
      if (res.ok) {
        flushed++
      } else if (res.status >= 400 && res.status < 500) {
        // Permanent failure (bad data, missing delivery). Drop it to avoid
        // looping forever; the driver will see the stop still open and can
        // try again manually.
        flushed++ // treat as removed
      } else {
        remaining.push({ ...item, attempts: item.attempts + 1 })
      }
    } catch {
      remaining.push({ ...item, attempts: item.attempts + 1 })
    }
  }

  writeQueue(remaining)
  return flushed
}
