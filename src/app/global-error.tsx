'use client'

// NOTE: global-error.tsx replaces the root layout, so it cannot rely on Tailwind
// base styles. Inline styles are intentional here.

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { logClientError } from '@/lib/client-error-log'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    // Also log to console for local dev visibility
    // eslint-disable-next-line no-console
    console.error('[global-error]', error)
    // Ship to internal beacon — global-error means the root layout crashed,
    // so we want an authoritative record even if Sentry isn't wired up.
    logClientError('global', error)
  }, [error])

  const handleReset = async () => {
    // Clear all service worker caches to fix stale bundle issues
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map(name => caches.delete(name)))
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to clear caches:', e)
      }
    }
    // Unregister stale service workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map(r => r.unregister()))
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to unregister SW:', e)
      }
    }
    reset()
  }

  return (
    <html lang="en">
      <body style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        margin: 0, minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#f8f9fa', color: '#1f2937',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 520, padding: '32px 24px' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            backgroundColor: '#FEE2E2', color: '#DC2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, fontWeight: 700, margin: '0 auto 24px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          }}>!</div>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#E67E22', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Abel Lumber
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', marginBottom: 12, margin: 0 }}>
            Platform error
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 12, marginBottom: 20, lineHeight: 1.6 }}>
            A rendering error occurred. This is usually caused by a stale cached file.
            Try clearing your cache and reloading. If it keeps happening, email support with the error ID below.
          </p>
          {error.digest && (
            <div style={{
              display: 'inline-block', padding: '6px 12px',
              background: '#f3f4f6', borderRadius: 6,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 12, color: '#4b5563', marginBottom: 20,
            }}>
              Error ID: {error.digest}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleReset}
              style={{
                padding: '10px 22px', borderRadius: 10,
                backgroundColor: '#1B4F72', color: 'white',
                fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
              }}
            >
              Clear cache &amp; retry
            </button>
            <button
              onClick={() => window.location.href = '/'}
              style={{
                padding: '10px 22px', borderRadius: 10,
                backgroundColor: 'white', color: '#374151',
                fontSize: 14, fontWeight: 600,
                border: '1px solid #d1d5db', cursor: 'pointer',
              }}
            >
              Go home
            </button>
          </div>
          <p style={{ marginTop: 24, fontSize: 13, color: '#9ca3af' }}>
            Support:{' '}
            <a href="mailto:support@abellumber.com" style={{ color: '#1B4F72', textDecoration: 'none', fontWeight: 500 }}>
              support@abellumber.com
            </a>
          </p>
        </div>
      </body>
    </html>
  )
}
