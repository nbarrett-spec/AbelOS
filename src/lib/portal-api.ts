/**
 * Builder Portal — data fetching helpers.
 *
 * Phase 0.6 of BUILDER-PORTAL-SPEC.md (§0.4).
 *
 * Two callers:
 *   1. Client components → `usePortalData<T>(url)` hook (handles loading,
 *      error, refetch). Redirects to /login on 401 (cookie expired).
 *   2. Server components → call `portalFetch<T>(url, { headers: {cookie} })`
 *      directly with the request cookie forwarded.
 *
 * No SWR / React Query dependency — matches the rest of the codebase's
 * native fetch pattern.
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// portalFetch — thin fetch wrapper with auth + error normalization
// ──────────────────────────────────────────────────────────────────────────

export class PortalApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'PortalApiError'
    this.status = status
  }
}

export async function portalFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
  })

  if (res.status === 401) {
    // Cookie expired or never set — kick to /login. Only do this client-side
    // (no `window` on server) so server callers see the error and decide.
    if (typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?next=${next}`
    }
    throw new PortalApiError('UNAUTHORIZED', 401)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.error || body?.message || ''
    } catch {
      /* non-json body */
    }
    throw new PortalApiError(
      `API ${res.status}${detail ? ` — ${detail}` : ''}`,
      res.status,
    )
  }

  return res.json() as Promise<T>
}

// ──────────────────────────────────────────────────────────────────────────
// usePortalData — hook for client components
// ──────────────────────────────────────────────────────────────────────────

export interface UsePortalDataResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Fetch JSON from a builder-portal endpoint and track loading + error
 * state. Pass `null` for the URL to suspend the fetch (useful when an
 * argument isn't ready yet — e.g. waiting on a builderId).
 */
export function usePortalData<T>(url: string | null): UsePortalDataResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(url !== null)
  const [error, setError] = useState<string | null>(null)
  // Used to force a refetch from refetch() while still keying on `url`.
  const [bump, setBump] = useState(0)
  // Cancel stale responses if `url` changes mid-flight.
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    portalFetch<T>(url)
      .then((d) => {
        if (cancelled || !aliveRef.current) return
        setData(d)
      })
      .catch((e: unknown) => {
        if (cancelled || !aliveRef.current) return
        // Don't surface 401 — the fetch wrapper already redirected.
        if (e instanceof PortalApiError && e.status === 401) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled || !aliveRef.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [url, bump])

  const refetch = useCallback(() => setBump((n) => n + 1), [])

  return { data, loading, error, refetch }
}
