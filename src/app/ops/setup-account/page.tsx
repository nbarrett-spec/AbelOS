'use client'

import { useState, useEffect, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import Progress from '@/components/ui/Progress'

const inputBase =
  'w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none transition-all focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal/60 focus-visible:outline-none'

function getPasswordStrength(pw: string): { score: number; label: string; color: 'danger' | 'warning' | 'green' } {
  let score = 0
  if (pw.length >= 8) score += 25
  if (/[A-Z]/.test(pw)) score += 25
  if (/[0-9]/.test(pw)) score += 25
  if (/[^A-Za-z0-9]/.test(pw)) score += 25

  let label = 'Weak'
  let color: 'danger' | 'warning' | 'green' = 'danger'
  if (score >= 100) {
    label = 'Strong'
    color = 'green'
  } else if (score >= 75) {
    label = 'Good'
    color = 'green'
  } else if (score >= 50) {
    label = 'Fair'
    color = 'warning'
  } else {
    label = 'Weak'
    color = 'danger'
  }
  return { score, label, color }
}

function SetupAccountInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState(false)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [handbookAgreed, setHandbookAgreed] = useState(false)
  const [signature, setSignature] = useState('')
  const [signatureDate, setSignatureDate] = useState('')
  const [showHandbook, setShowHandbook] = useState(false)

  const strength = useMemo(() => getPasswordStrength(password), [password])

  // Set today's date as default
  useEffect(() => {
    const today = new Date()
    const dateStr = today.toISOString().split('T')[0]
    setSignatureDate(dateStr)
  }, [])

  // Validate token on load
  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link. Missing token parameter.')
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validate form
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    if (!signature.trim()) {
      setError('Please enter your signature')
      setLoading(false)
      return
    }

    if (!handbookAgreed) {
      setError('You must agree to the employee handbook')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/ops/auth/setup-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          handbookAgreed,
          signatureName: signature,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Setup failed')
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/ops/login?message=Account setup complete. Please log in.')
      }, 2000)
    } catch (err) {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-navy-mid p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 dark:bg-danger-900/20">
            <AlertCircle className="w-6 h-6 text-danger-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Invalid Invitation</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This invitation link is invalid or has expired. Please contact your administrator.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* ── Left panel: Drafting Room hero (matches login) ────────── */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-navy overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-navy-deep via-navy to-navy-mid" />
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `linear-gradient(rgba(198,162,78,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(198,162,78,0.3) 1px, transparent 1px)`,
              backgroundSize: '40px 40px',
            }}
          />
          <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-gold/15 rounded-full blur-[120px]" />
          <div className="absolute top-1/4 -left-20 w-[300px] h-[300px] bg-navy-light/30 rounded-full blur-[100px]" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div className="animate-enter">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="Abel Lumber" width={40} height={40} className="rounded-xl" />
              <span className="text-xl font-bold text-white tracking-tight">Abel Lumber</span>
            </div>
          </div>

          <div className="max-w-md">
            <h1 className="animate-enter animate-enter-delay-1 text-4xl xl:text-5xl font-bold text-white leading-[1.1] tracking-tight">
              Welcome to
              <span className="block mt-1 text-transparent bg-clip-text bg-gradient-to-r from-gold to-gold-light">
                the team.
              </span>
            </h1>
            <p className="animate-enter animate-enter-delay-2 mt-6 text-lg text-white/60 leading-relaxed max-w-sm">
              Set your password and review the employee handbook to finish setting up your operations account.
            </p>
          </div>

          <div className="animate-enter animate-enter-delay-4 text-sm text-white/30">
            Door & Trim Specialists &middot; Gainesville, TX
          </div>
        </div>
      </div>

      {/* ── Right panel: setup form ────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-canvas p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 animate-enter">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="Abel Lumber" width={36} height={36} className="rounded-xl" />
              <span className="text-lg font-bold text-gray-900 dark:text-white">Abel Lumber</span>
            </div>
          </div>

          <div className="animate-enter animate-enter-delay-1">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              Complete your setup
            </h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Welcome to Abel Operations
            </p>
          </div>

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mt-6 flex items-start gap-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-xl px-4 py-3.5 animate-[slideDown_200ms_ease-out]"
            >
              <AlertCircle className="w-5 h-5 text-danger-500 shrink-0 mt-0.5" />
              <p className="text-sm text-danger-700 dark:text-danger-400">{error}</p>
            </div>
          )}

          {success ? (
            <div className="mt-8 animate-enter animate-enter-delay-2 rounded-xl border border-success-200 dark:border-success-700 bg-success-50 dark:bg-success-900/20 p-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-100 dark:bg-success-900/40 border-2 border-success-500">
                <CheckCircle2 className="w-8 h-8 text-success-500" />
              </div>
              <h3 className="text-lg font-semibold text-success-700 dark:text-success-300 mb-1">Success!</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Your account is ready. Redirecting to login...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-5 animate-enter animate-enter-delay-2" noValidate>
              {/* Password */}
              <div>
                <label htmlFor="setup-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Create password
                </label>
                <input
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  className={inputBase}
                />
                {password.length > 0 && (
                  <div className="mt-2">
                    <Progress
                      value={strength.score}
                      color={strength.color}
                      size="xs"
                      animated
                    />
                    <p
                      className={
                        'mt-1.5 text-xs font-medium ' +
                        (strength.color === 'green'
                          ? 'text-success-600 dark:text-success-400'
                          : strength.color === 'warning'
                          ? 'text-warning-600 dark:text-warning-400'
                          : 'text-danger-600 dark:text-danger-400')
                      }
                      aria-live="polite"
                    >
                      Password strength: {strength.label}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label htmlFor="setup-confirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Confirm password
                </label>
                <input
                  id="setup-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  required
                  className={inputBase}
                />
              </div>

              {/* Handbook Agreement */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/40 dark:bg-gray-900/40 p-4">
                <label className="flex items-start gap-3 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={handbookAgreed}
                    onChange={(e) => setHandbookAgreed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded-md bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-signal focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:outline-none cursor-pointer transition"
                  />
                  <span>
                    I have read and agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setShowHandbook(true)}
                      className="font-medium text-signal hover:text-signal-hover underline underline-offset-2 transition-colors"
                    >
                      Abel Lumber Employee Handbook
                    </button>
                  </span>
                </label>
              </div>

              {/* Digital signature */}
              <div>
                <label htmlFor="setup-signature" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Digital signature
                </label>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 min-h-[80px] flex items-center justify-center">
                  <input
                    id="setup-signature"
                    type="text"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    placeholder="Type your full name"
                    autoComplete="name"
                    required
                    style={{ fontFamily: 'cursive' }}
                    className="w-full bg-transparent border-none text-3xl text-center text-gray-900 dark:text-white outline-none focus-visible:outline-none"
                  />
                </div>
              </div>

              {/* Date */}
              <div>
                <label htmlFor="setup-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Date
                </label>
                <input
                  id="setup-date"
                  type="date"
                  value={signatureDate}
                  onChange={(e) => setSignatureDate(e.target.value)}
                  required
                  className={inputBase}
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-signal hover:bg-signal-hover disabled:opacity-60 disabled:cursor-not-allowed px-6 py-3.5 text-base font-semibold text-accent-fg shadow-lg shadow-gold/20 hover:shadow-xl hover:shadow-gold/30 hover:scale-[1.01] active:scale-[0.99] transition-all focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:outline-none"
              >
                {loading ? 'Setting up...' : 'Complete Setup'}
              </button>
            </form>
          )}

          <p className="animate-enter animate-enter-delay-5 mt-10 text-center text-xs text-gray-400 dark:text-gray-500">
            Abel Door &amp; Trim &middot; Operations Platform
          </p>
        </div>
      </div>

      {/* Handbook Modal */}
      {showHandbook && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-5">
          <div className="flex w-full max-w-3xl max-h-[90vh] flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-navy-mid shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Employee Handbook</h2>
              <button
                onClick={() => setShowHandbook(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                aria-label="Close handbook"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <iframe
                src="/api/ops/handbook"
                className="w-full h-[600px] rounded-lg border-0 bg-gray-50 dark:bg-gray-900"
                title="Abel Lumber Employee Handbook"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700 px-6 py-4">
              <button
                onClick={() => setShowHandbook(false)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:outline-none"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SetupAccountPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    }>
      <SetupAccountInner />
    </Suspense>
  )
}
