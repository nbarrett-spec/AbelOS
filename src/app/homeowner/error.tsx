'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { logClientError } from '@/lib/client-error-log'

export default function HomeownerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Homeowner error:', error)
    }
    if (typeof window !== 'undefined' && (window as any).Sentry?.captureException) {
      ;(window as any).Sentry.captureException(error)
    }
    logClientError('homeowner', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center card p-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-abel-orange/10 text-abel-orange mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-abel-navy mb-2">Couldn&apos;t load your project</h1>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">
          We had trouble loading your homeowner dashboard. Please try again.
        </p>
        {error.digest && (
          <div className="inline-block px-3 py-1.5 bg-gray-100 rounded-md font-mono text-xs text-gray-600 mb-5">
            Error ID: {error.digest}
          </div>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <button onClick={reset} className="btn-accent">Try again</button>
          <Link href="/" className="btn-outline">Go home</Link>
        </div>
        <p className="mt-5 text-xs text-gray-400">
          Still stuck? Email{' '}
          <a href="mailto:support@abellumber.com" className="text-abel-navy hover:underline">
            support@abellumber.com
          </a>
        </p>
      </div>
    </div>
  )
}
