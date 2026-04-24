'use client'

import { useState, Suspense, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { AlertCircle, CheckCircle2, KeyRound, ArrowRight } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Progress from '@/components/ui/Progress'

// ── Password strength (visual-only, does NOT gate submission) ─────────────
// Formula per Tier 1.4:
//   length >= 8        → +25%
//   has uppercase      → +25%
//   has number         → +25%
//   has special char   → +25%
function calcStrength(pw: string): number {
  if (!pw) return 0
  let pct = 0
  if (pw.length >= 8) pct += 25
  if (/[A-Z]/.test(pw)) pct += 25
  if (/\d/.test(pw)) pct += 25
  if (/[!@#$%^&*(),.?":{}|<>]/.test(pw)) pct += 25
  return pct
}

function strengthMeta(pct: number): { label: string; color: 'danger' | 'warning' | 'orange' | 'green' } {
  if (pct === 0) return { label: '', color: 'danger' }
  if (pct <= 25) return { label: 'Weak', color: 'danger' }
  if (pct <= 50) return { label: 'Fair', color: 'warning' }
  if (pct <= 75) return { label: 'Good', color: 'orange' }
  return { label: 'Strong', color: 'green' }
}

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const strengthPct = useMemo(() => calcStrength(password), [password])
  const meta = strengthMeta(strengthPct)
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

  // ── Invalid / missing token ─────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen flex relative overflow-hidden">
        <div className="flex-1 flex items-center justify-center bg-canvas p-6 sm:p-10">
          <div className="w-full max-w-md text-center animate-enter">
            <div className="w-16 h-16 mx-auto bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-full flex items-center justify-center mb-5">
              <AlertCircle className="w-8 h-8 text-danger-500" aria-hidden="true" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              Invalid reset link
            </h1>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              This password reset link is missing or invalid. It may have expired.
              Please request a new one.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Link href="/forgot-password">
                <Button variant="accent" size="lg">
                  Request new link
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* ── Left panel: immersive Drafting Room experience ────────── */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-navy overflow-hidden">
        {/* Layered background */}
        <div className="absolute inset-0">
          {/* Gradient base */}
          <div className="absolute inset-0 bg-gradient-to-br from-navy-deep via-navy to-navy-mid" />

          {/* Drafting grid */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `linear-gradient(rgba(198,162,78,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(198,162,78,0.3) 1px, transparent 1px)`,
              backgroundSize: '40px 40px',
            }}
          />

          {/* Warm gold glow from bottom-right */}
          <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-gold/15 rounded-full blur-[120px]" />
          <div className="absolute top-1/4 -left-20 w-[300px] h-[300px] bg-navy-light/30 rounded-full blur-[100px]" />

          {/* Floating wood grain lines */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grain" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
                <path d="M0 20 Q50 15 100 22 Q150 30 200 18" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 60 Q40 55 90 65 Q140 70 200 58" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 100 Q60 95 110 105 Q160 110 200 98" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 140 Q30 135 80 145 Q130 150 200 138" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 180 Q50 175 100 185 Q150 190 200 178" stroke="white" strokeWidth="0.5" fill="none" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grain)" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          {/* Logo */}
          <div className="animate-enter">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="Abel Lumber" width={40} height={40} className="rounded-xl" />
              <span className="text-xl font-bold text-white tracking-tight">Abel Lumber</span>
            </div>
          </div>

          {/* Hero copy */}
          <div className="max-w-md">
            <h1 className="animate-enter animate-enter-delay-1 text-4xl xl:text-5xl font-bold text-white leading-[1.1] tracking-tight">
              Set a new
              <span className="block mt-1 text-transparent bg-clip-text bg-gradient-to-r from-gold to-gold-light">
                password,
              </span>
              <span className="block mt-1">stay protected.</span>
            </h1>
            <p className="animate-enter animate-enter-delay-2 mt-6 text-lg text-white/60 leading-relaxed max-w-sm">
              Choose a strong password. A mix of letters, numbers and symbols is best.
            </p>
          </div>

          {/* Footer */}
          <div className="animate-enter animate-enter-delay-4 text-sm text-white/30">
            Door & Trim Specialists &middot; Gainesville, TX
          </div>
        </div>
      </div>

      {/* ── Right panel: reset form ────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-canvas p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 animate-enter">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="Abel Lumber" width={36} height={36} className="rounded-xl" />
              <span className="text-lg font-bold text-gray-900 dark:text-white">Abel Lumber</span>
            </div>
          </div>

          {success ? (
            <div className="text-center animate-enter">
              <div className="w-16 h-16 mx-auto bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 rounded-full flex items-center justify-center mb-5">
                <CheckCircle2 className="w-8 h-8 text-success-500" aria-hidden="true" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                Password updated
              </h1>
              <p className="mt-2 text-gray-500 dark:text-gray-400">
                Your password has been reset successfully. Redirecting you to sign in&hellip;
              </p>
              <div className="mt-8">
                <Link href="/login">
                  <Button variant="accent" size="lg" fullWidth>
                    Sign in now
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <>
              {/* Form header */}
              <div className="animate-enter animate-enter-delay-1">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                  Create new password
                </h2>
                <p className="mt-2 text-gray-500 dark:text-gray-400">
                  Use at least 8 characters. Mix letters, numbers and symbols for best protection.
                </p>
              </div>

              {/* Error */}
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

              {/* Form */}
              <form onSubmit={handleSubmit} className="mt-8 space-y-5 animate-enter animate-enter-delay-2" noValidate>
                <div>
                  <Input
                    label="New password"
                    type="password"
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
                    size="lg"
                  />

                  {/* Strength bar — visual only, does not block submit */}
                  {password.length > 0 && (
                    <div className="mt-2.5" aria-live="polite">
                      <Progress
                        value={strengthPct}
                        color={meta.color}
                        size="sm"
                        animated
                      />
                      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        Strength: <span className="font-medium text-gray-700 dark:text-gray-300">{meta.label}</span>
                      </p>
                    </div>
                  )}

                  {capsLockOn && (
                    <p className="mt-1.5 text-xs text-warning-600 dark:text-warning-400 flex items-center gap-1.5" aria-live="polite">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning-500 animate-pulse" />
                      Caps Lock is on
                    </p>
                  )}
                </div>

                <div>
                  <Input
                    label="Confirm password"
                    type="password"
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
                    size="lg"
                  />
                  {mismatch && (
                    <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-400" aria-live="polite">
                      Passwords don&apos;t match yet.
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="accent"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={loading || password.length < 8 || password !== confirmPassword}
                  icon={!loading ? <KeyRound className="w-4.5 h-4.5" /> : undefined}
                  className="mt-2 !py-3.5 text-base font-semibold shadow-lg shadow-gold/20 hover:shadow-xl hover:shadow-gold/30 hover:scale-[1.01] active:scale-[0.99] transition-all"
                >
                  {loading ? 'Resetting…' : 'Reset password'}
                </Button>
              </form>

              {/* Divider */}
              <div className="animate-enter animate-enter-delay-3 mt-8 flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Remember your password?</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </div>

              {/* Back to sign in */}
              <div className="animate-enter animate-enter-delay-4 mt-6">
                <Link
                  href="/login"
                  className="group flex items-center justify-center gap-2 w-full px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                >
                  Back to sign in
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>

              {/* Footer */}
              <p className="animate-enter animate-enter-delay-5 mt-10 text-center text-xs text-gray-400 dark:text-gray-500">
                By resetting your password, you agree to our Terms of Service and Privacy Policy
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
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-canvas">
          <p className="text-fg-muted text-sm">Loading…</p>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  )
}
