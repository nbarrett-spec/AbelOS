'use client'

/**
 * Global error — replaces the root layout, so it must be self-contained.
 * Inline styles only (no Tailwind / globals.css applied here).
 *
 * Aegis v2: full-screen navy, centered Abel mark, gold error headline,
 * JetBrains Mono error detail. Includes a "Clear cache & retry" fallback
 * for stale-bundle crashes.
 */

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
    // eslint-disable-next-line no-console
    console.error('[global-error]', error)
    logClientError('global', error)
  }, [error])

  const handleReset = async () => {
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map((n) => caches.delete(n)))
      } catch {
        /* noop */
      }
    }
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((r) => r.unregister()))
      } catch {
        /* noop */
      }
    }
    reset()
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: '#050d16',
          color: '#f5f1e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            width: '100%',
            textAlign: 'center',
            padding: '48px 32px',
            background: '#0a1a28',
            border: '1px solid rgba(198,162,78,0.18)',
            borderRadius: 12,
            boxShadow: '0 20px 44px rgba(0,0,0,0.65), 0 0 40px rgba(198,162,78,0.08)',
          }}
        >
          {/* Abel monogram in gold */}
          <svg
            width="56"
            height="56"
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ margin: '0 auto 24px', display: 'block' }}
            aria-hidden="true"
          >
            <rect x="2" y="2" width="36" height="36" rx="8" fill="#050d16" stroke="#c6a24e" strokeWidth="1" />
            <path
              d="M13 28 L20 10 L27 28 M16 22 H24"
              stroke="#c6a24e"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>

          <p
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: '#c6a24e',
              margin: 0,
            }}
          >
            Aegis · Platform Error
          </p>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: '#e4c77a',
              margin: '12px 0 8px',
              letterSpacing: '-0.01em',
            }}
          >
            Something broke hard.
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#8a9aaa', marginBottom: 24 }}>
            A rendering error crashed the root layout. This is usually caused by a
            stale cached bundle. Clear your cache and reload — if it keeps happening,
            email support with the error ID below.
          </p>

          {error.digest && (
            <div
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                fontSize: 11,
                color: '#8a9aaa',
                background: 'rgba(198,162,78,0.06)',
                border: '1px solid rgba(198,162,78,0.18)',
                borderRadius: 4,
                marginBottom: 24,
              }}
            >
              ID: {error.digest}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleReset}
              style={{
                padding: '10px 22px',
                borderRadius: 6,
                background: 'linear-gradient(3deg, #c6a24e, #a88a3a)',
                color: '#050d16',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 16px rgba(198,162,78,0.12)',
              }}
            >
              Clear cache &amp; retry
            </button>
            <button
              onClick={() => {
                window.location.href = '/'
              }}
              style={{
                padding: '10px 22px',
                borderRadius: 6,
                background: 'transparent',
                color: '#f5f1e8',
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid rgba(198,162,78,0.25)',
                cursor: 'pointer',
              }}
            >
              Go home
            </button>
          </div>

          <p style={{ marginTop: 24, fontSize: 11, color: '#5a6a7a' }}>
            Support:{' '}
            <a href="mailto:support@abellumber.com" style={{ color: '#c6a24e', textDecoration: 'none' }}>
              support@abellumber.com
            </a>
          </p>
        </div>
      </body>
    </html>
  )
}
