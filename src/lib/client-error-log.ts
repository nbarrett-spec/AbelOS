// ──────────────────────────────────────────────────────────────────────────
// Client-side error beacon.
//
// Called from error boundaries to persist an unhandled React error to the
// server-side ClientError table. Uses navigator.sendBeacon when available so
// the request survives a page reset/reload; falls back to fetch keepalive.
//
// Safe to call from a useEffect — never throws.
// ──────────────────────────────────────────────────────────────────────────

export interface ClientErrorReport {
  digest?: string
  message?: string
  stack?: string
  scope?: string          // 'admin' | 'ops' | 'crew' | 'dashboard' | ...
  path?: string           // window.location.pathname
  userAgent?: string
}

export function logClientError(scope: string, error: Error & { digest?: string }): void {
  if (typeof window === 'undefined') return

  try {
    const payload: ClientErrorReport = {
      digest: error.digest,
      message: error.message?.slice(0, 2000),
      stack: error.stack?.slice(0, 4000),
      scope,
      path: window.location.pathname + window.location.search,
      userAgent: navigator.userAgent?.slice(0, 500),
    }

    const body = JSON.stringify(payload)
    const url = '/api/client-errors'

    // Prefer sendBeacon — survives page unload / navigation
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      const queued = navigator.sendBeacon(url, blob)
      if (queued) return
    }

    // Fallback: fetch with keepalive
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Swallow — we already surfaced the error in the UI
    })
  } catch {
    // Never let the logger itself throw inside an error boundary
  }
}
