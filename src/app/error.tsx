'use client'

/**
 * Route-level error boundary — Aegis v2 "Drafting Room" styling.
 *
 * Navy canvas, centered card with a 1px ember accent border. Error message
 * in JetBrains Mono so operators can copy/paste it cleanly. Primary gold
 * "Try again" button + ghost "Report issue" button.
 *
 * Preserves the legacy Sentry + internal-beacon logging.
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { logClientError } from '@/lib/client-error-log'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', error)
    if (typeof window !== 'undefined' && (window as { Sentry?: { captureException: (e: unknown) => void } }).Sentry?.captureException) {
      (window as { Sentry?: { captureException: (e: unknown) => void } }).Sentry!.captureException(error)
    }
    logClientError('root', error)
  }, [error])

  const reportMailto = `mailto:support@abellumber.com?subject=${encodeURIComponent(
    `Aegis error${error.digest ? ` · ${error.digest}` : ''}`,
  )}&body=${encodeURIComponent(
    [
      `Error ID: ${error.digest ?? 'n/a'}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : 'n/a'}`,
      `UA: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
      '',
      'What were you doing when this happened?',
      '',
    ].join('\n'),
  )}`

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-16"
      style={{ backgroundColor: 'var(--navy-deep, #050d16)', color: '#f5f1e8' }}
    >
      {/* Drafting grid echo */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(198,162,78,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(198,162,78,0.05) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, transparent 100%)',
        }}
      />

      <div
        className="relative max-w-xl w-full rounded-lg p-10"
        style={{
          background: 'var(--navy, #0a1a28)',
          border: '1px solid rgba(182,78,61,0.35)',
          boxShadow:
            '0 20px 44px rgba(5,13,22,0.65), 0 0 24px rgba(182,78,61,0.12), inset 0 0 0 1px rgba(198,162,78,0.06)',
        }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em] mb-4"
          style={{ color: '#c6a24e' }}
        >
          <span
            aria-hidden
            className="inline-block w-7 h-px align-middle mr-2"
            style={{ background: '#b64e3d' }}
          />
          Aegis · Error
        </p>
        <h1
          className="text-[28px] leading-tight tracking-tight font-semibold"
          style={{ color: '#f5f1e8' }}
        >
          Something went wrong.
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: '#8a9aaa' }}>
          The team has been notified. You can try again or head back to a known-good page.
        </p>

        {error.message && (
          <pre
            className="mt-6 p-3 rounded text-[12px] overflow-x-auto"
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
              background: 'rgba(182,78,61,0.08)',
              border: '1px solid rgba(182,78,61,0.25)',
              color: '#d07564',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
          </pre>
        )}

        {error.digest && (
          <div
            className="mt-4 inline-block px-3 py-1.5 rounded"
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
              fontSize: 11,
              color: '#8a9aaa',
              background: 'rgba(198,162,78,0.06)',
              border: '1px solid rgba(198,162,78,0.18)',
            }}
          >
            ID: {error.digest}
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center h-10 px-5 rounded-md font-semibold text-[13px]"
            style={{
              background: 'linear-gradient(3deg, #c6a24e, #a88a3a)',
              color: '#050d16',
              border: '1px solid transparent',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 16px rgba(198,162,78,0.12)',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <a
            href={reportMailto}
            className="inline-flex items-center justify-center h-10 px-5 rounded-md font-medium text-[13px] transition-colors"
            style={{
              background: 'transparent',
              color: '#f5f1e8',
              border: '1px solid rgba(198,162,78,0.25)',
            }}
          >
            Report issue
          </a>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-10 px-5 rounded-md font-medium text-[13px]"
            style={{ color: '#8a9aaa' }}
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
