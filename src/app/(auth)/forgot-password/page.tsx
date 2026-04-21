'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || `Something went wrong (${res.status})`)
      }

      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-signal rounded-xl flex items-center justify-center font-bold text-white">
            AB
          </div>
          <span className="text-white font-semibold text-xl">Abel Builder</span>
        </div>
        <div>
          <h2 className="text-4xl font-bold text-white leading-tight">
            Reset your password
          </h2>
          <p className="mt-4 text-white/60 text-lg">
            We&apos;ll send you a link to get back into your account.
          </p>
        </div>
        <div className="text-white/30 text-sm">
          Abel Lumber &middot; Builder Platform
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-navy mb-2">Check your email</h1>
              <p className="text-gray-500 mb-6">
                If an account exists for <strong>{email}</strong>, we&apos;ve sent a password reset link. Check your inbox and spam folder.
              </p>
              <p className="text-sm text-gray-400 mb-8">
                The link will expire in 1 hour.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/login" className="btn-accent inline-block">
                  Back to Sign In
                </Link>
                <button
                  type="button"
                  onClick={() => { setSent(false); setError('') }}
                  className="btn-outline inline-block"
                >
                  Try a different email
                </button>
              </div>
              <p className="mt-8 text-xs text-gray-400">
                Didn&apos;t get the email? Check spam, or email{' '}
                <a href="mailto:support@abellumber.com" className="text-brand hover:underline">
                  support@abellumber.com
                </a>
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-navy mb-1">Forgot your password?</h1>
              <p className="text-gray-500 mb-8">
                Enter your email and we&apos;ll send you a reset link.
              </p>

              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100"
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="email" className="label">Email address</label>
                  <input
                    id="email"
                    name="email"
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    aria-required="true"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="btn-accent w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-gray-500">
                Remember your password?{' '}
                <Link href="/login" className="text-signal font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
