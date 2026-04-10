'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  const handleReset = async () => {
    // Clear all service worker caches to fix stale bundle issues
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map(name => caches.delete(name)))
      } catch (e) {
        console.warn('Failed to clear caches:', e)
      }
    }
    // Unregister stale service workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map(r => r.unregister()))
      } catch (e) {
        console.warn('Failed to unregister SW:', e)
      }
    }
    reset()
  }

  return (
    <html lang="en">
      <body style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        margin: 0, minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#f8f9fa',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 480, padding: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            backgroundColor: '#FEE2E2', color: '#DC2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 700, margin: '0 auto 20px',
          }}>!</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>
            Abel Platform Error
          </h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 1.6 }}>
            A rendering error occurred. This is usually caused by stale cached files.
            Click below to clear caches and reload.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={handleReset}
              style={{
                padding: '10px 24px', borderRadius: 8,
                backgroundColor: '#1B4F72', color: 'white',
                fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
              }}
            >
              Clear Cache &amp; Retry
            </button>
            <button
              onClick={() => window.location.href = '/'}
              style={{
                padding: '10px 24px', borderRadius: 8,
                backgroundColor: '#E67E22', color: 'white',
                fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
              }}
            >
              Go Home
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
