'use client'

import { useState, Suspense, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// Password strength scoring — simple heuristic, no dependency
function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'bg-gray-200' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  const bounded = Math.min(4, score) as 0 | 1 | 2 | 3 | 4
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const
  const colors = ['bg-gray-200', 'bg-red-500', 'bg-signal', 'bg-blue-500', 'bg-green-500']
  return { score: bounded, label: labels[bounded], color: colors[bounded] }
}

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const strength = useMemo(() => scorePassword(password), [password])
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword

  const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || `Reset failed (${res.status})`)
      }

      setSuccess(true)
      setTimeout(() => router.push('/login'), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-navy mb-2">Invalid Reset Link</h1>
          <p className="text-gray-500 mb-6">
            This password reset link is missing or invalid. It may have expired. Please request a new one.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/forgot-password" className="btn-accent inline-block">
              Request New Link
            </Link>
            <Link href="/login" className="btn-outline inline-block">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    )
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
            Set a new password
          </h2>
          <p className="mt-4 text-white/60 text-lg">
            Choose a strong password for your account.
          </p>
        </div>
        <div className="text-white/30 text-sm">
          Abel Lumber &middot; Builder Platform
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-navy mb-2">Password updated!</h1>
              <p className="text-gray-500 mb-6">
                Your password has been reset successfully. Redirecting you to sign in…
              </p>
              <Link href="/login" className="btn-accent inline-block">
                Sign In Now
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-navy mb-1">Create new password</h1>
              <p className="text-gray-500 mb-8">
                Use at least 8 characters. A mix of letters, numbers and symbols is strongest.
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
                  <label htmlFor="password" className="label">New password</label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      className="input pr-12"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={handleCapsLock}
                      onKeyDown={handleCapsLock}
                      required
                      minLength={8}
                      aria-required="true"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      tabIndex={-1}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-signal transition"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {/* Strength bar */}
                  {password.length > 0 && (
                    <div className="mt-2" aria-live="polite">
                      <div className="flex gap-1 h-1.5" aria-hidden="true">
                        {[1, 2, 3, 4].map(i => (
                          <div
                            key={i}
                            className={`flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : 'bg-gray-200'}`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Strength: <span className="font-medium text-gray-700">{strength.label}</span>
                      </p>
                    </div>
                  )}
                  {capsLockOn && (
                    <p className="mt-1.5 text-xs text-signal" aria-live="polite">
                      <span className="inline-block w-2 h-2 rounded-full bg-signal mr-1.5 align-middle" />
                      Caps Lock is on
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="label">Confirm password</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Type it again"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyUp={handleCapsLock}
                    onKeyDown={handleCapsLock}
                    required
                    minLength={8}
                    aria-required="true"
                    aria-invalid={mismatch}
                  />
                  {mismatch && (
                    <p className="mt-1.5 text-xs text-red-600" aria-live="polite">
                      Passwords don&apos;t match yet.
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || password.length < 8 || password !== confirmPassword}
                  className="btn-accent w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Resetting…' : 'Reset Password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>}>
      <ResetPasswordInner />
    </Suspense>
  )
}
