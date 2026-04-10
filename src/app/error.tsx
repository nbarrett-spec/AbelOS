'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      backgroundColor: '#f9fafb',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{
          fontSize: 64,
          marginBottom: 20,
        }}>
          ⚠️
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>
          Abel Lumber
        </h1>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', marginBottom: 16 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 1.5 }}>
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        {error.digest && (
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16, fontFamily: 'monospace' }}>
            Error ID: {error.digest}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              padding: '10px 24px', borderRadius: 8,
              backgroundColor: '#E67E22', color: 'white',
              fontSize: 14, fontWeight: 600, border: 'none',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
          <a
            href="/"
            style={{
              padding: '10px 24px', borderRadius: 8,
              backgroundColor: '#1B4F72', color: 'white',
              fontSize: 14, fontWeight: 600, border: 'none',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  )
}
