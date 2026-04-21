'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { logClientError } from '@/lib/client-error-log'

// ──────────────────────────────────────────────────────────────────────────
// Shared fallback UI for Next.js error.tsx boundaries.
//
// Every section boundary (/admin/error.tsx, /ops/error.tsx, etc.) renders
// this component so they stay consistent — Abel branding, error digest,
// Try Again + Home buttons, Sentry capture, and the internal client-error
// beacon to /api/client-errors.
// ──────────────────────────────────────────────────────────────────────────

export interface ErrorFallbackProps {
  /** Error object passed from the Next.js error boundary. */
  error: Error & { digest?: string }
  /** Reset handler from the Next.js error boundary. */
  reset: () => void
  /** Short scope label shown above the headline (e.g. "Admin", "Operations"). */
  scope: string
  /** Headline copy shown to the user. */
  title?: string
  /** Body copy shown below the headline. */
  description?: string
  /** Destination of the "home" button — defaults to "/". */
  homeHref?: string
  /** Label for the "home" button — defaults to "Go home". */
  homeLabel?: string
}

export default function ErrorFallback({
  error,
  reset,
  scope,
  title = 'Something went wrong',
  description = "We hit an error loading this page. The team has been notified.",
  homeHref = '/',
  homeLabel = 'Go home',
}: ErrorFallbackProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error(`[${scope}] error:`, error)
    }
    // Ship to Sentry if present
    if (typeof window !== 'undefined' && (window as any).Sentry?.captureException) {
      ;(window as any).Sentry.captureException(error)
    }
    // Always ship to our internal beacon so we have a record even without Sentry
    logClientError(scope.toLowerCase(), error)
  }, [error, scope])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center card p-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-signal/10 text-signal mb-5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="text-xs font-semibold tracking-wider text-signal uppercase mb-2">
          {scope}
        </p>
        <h1 className="text-xl font-bold text-brand mb-2">{title}</h1>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">
          {error.message && process.env.NODE_ENV !== 'production'
            ? error.message
            : description}
        </p>
        {error.digest && (
          <div className="inline-block px-3 py-1.5 bg-gray-100 rounded-md font-mono text-xs text-gray-600 mb-5">
            Error ID: {error.digest}
          </div>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <button onClick={reset} className="btn-accent">
            Try again
          </button>
          <Link href={homeHref} className="btn-outline">
            {homeLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}
