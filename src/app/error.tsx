'use client'

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
    console.error('Unhandled error:', error)
    // Ship to Sentry if present
    if (typeof window !== 'undefined' && (window as any).Sentry?.captureException) {
      (window as any).Sentry.captureException(error)
    }
    // Ship to internal beacon — always have a record
    logClientError('root', error)
  }, [error])

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6 py-16 bg-gray-50">
      <div className="max-w-lg w-full text-center card p-8 sm:p-10">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-abel-orange/10 text-abel-orange mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-sm font-semibold tracking-wider text-abel-orange uppercase mb-2">Abel Lumber</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">Something went wrong</h1>
        <p className="text-gray-600 mb-6 leading-relaxed">
          We hit an unexpected error. The team has been notified. You can try again or head back to a known-good page.
        </p>
        {error.digest && (
          <div className="inline-block px-3 py-1.5 bg-gray-100 rounded-md font-mono text-xs text-gray-600 mb-6">
            Error ID: {error.digest}
          </div>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <button onClick={reset} className="btn-accent">
            Try again
          </button>
          <Link href="/" className="btn-outline">
            Go home
          </Link>
        </div>
        <p className="mt-6 text-sm text-gray-500">
          Still broken? Email{' '}
          <a href="mailto:support@abellumber.com" className="text-abel-navy hover:underline font-medium">
            support@abellumber.com
          </a>
          {error.digest && ` with error ID above.`}
        </p>
      </div>
    </div>
  )
}
