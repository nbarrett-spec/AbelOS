'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, AlertCircle, MailCheck, KeyRound } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

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
              <pattern id="grain-forgot" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
                <path d="M0 20 Q50 15 100 22 Q150 30 200 18" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 60 Q40 55 90 65 Q140 70 200 58" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 100 Q60 95 110 105 Q160 110 200 98" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 140 Q30 135 80 145 Q130 150 200 138" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 180 Q50 175 100 185 Q150 190 200 178" stroke="white" strokeWidth="0.5" fill="none" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grain-forgot)" />
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
              Reset your
              <span className="block mt-1 text-transparent bg-clip-text bg-gradient-to-r from-gold to-gold-light">
                password and
              </span>
              <span className="block mt-1">get back to work.</span>
            </h1>
            <p className="animate-enter animate-enter-delay-2 mt-6 text-lg text-white/60 leading-relaxed max-w-sm">
              Enter the email tied to your account and we&apos;ll send a secure reset link.
            </p>
          </div>

          {/* Footer */}
          <div className="animate-enter animate-enter-delay-4 text-sm text-white/30">
            Door &amp; Trim Specialists &middot; Gainesville, TX
          </div>
        </div>
      </div>

      {/* ── Right panel: forgot password form ──────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-canvas p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 animate-enter">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="Abel Lumber" width={36} height={36} className="rounded-xl" />
              <span className="text-lg font-bold text-gray-900 dark:text-white">Abel Lumber</span>
            </div>
          </div>

          {sent ? (
            <div className="animate-enter">
              <div className="w-14 h-14 rounded-2xl bg-signal-subtle border border-signal/30 flex items-center justify-center mb-6">
                <MailCheck className="w-7 h-7 text-signal" aria-hidden="true" />
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                Check your email
              </h1>
              <p className="mt-2 text-gray-500 dark:text-gray-400">
                If an account exists for <strong className="text-gray-700 dark:text-gray-200">{email}</strong>, we&apos;ve sent a password reset link. Check your inbox and spam folder.
              </p>
              <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
                The link will expire in 1 hour.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link href="/login" className="flex-1">
                  <Button
                    type="button"
                    variant="accent"
                    size="lg"
                    fullWidth
                    className="!py-3.5 text-base font-semibold shadow-lg shadow-gold/20 hover:shadow-xl hover:shadow-gold/30 hover:scale-[1.01] active:scale-[0.99] transition-all"
                  >
                    Back to sign in
                  </Button>
                </Link>
                <button
                  type="button"
                  onClick={() => { setSent(false); setError('') }}
                  className="flex-1 group flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:outline-none transition-all"
                >
                  Try a different email
                </button>
              </div>

              <p className="mt-10 text-center text-xs text-gray-400 dark:text-gray-500">
                Didn&apos;t get the email? Check spam, or email{' '}
                <a href="mailto:support@abellumber.com" className="text-signal hover:text-signal-hover transition-colors">
                  support@abellumber.com
                </a>
              </p>
            </div>
          ) : (
            <>
              {/* Form header */}
              <div className="animate-enter animate-enter-delay-1">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                  Forgot your password?
                </h2>
                <p className="mt-2 text-gray-500 dark:text-gray-400">
                  Enter your email and we&apos;ll send you a reset link.
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
                <Input
                  id="email"
                  name="email"
                  label="Email address"
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
                  size="lg"
                />

                {/* Submit */}
                <Button
                  type="submit"
                  variant="accent"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={loading || !email.trim()}
                  icon={!loading ? <KeyRound className="w-4.5 h-4.5" /> : undefined}
                  className="mt-2 !py-3.5 text-base font-semibold shadow-lg shadow-gold/20 hover:shadow-xl hover:shadow-gold/30 hover:scale-[1.01] active:scale-[0.99] transition-all"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
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
                  className="group flex items-center justify-center gap-2 w-full px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:outline-none transition-all"
                >
                  Back to sign in
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>

              {/* Footer */}
              <p className="animate-enter animate-enter-delay-5 mt-10 text-center text-xs text-gray-400 dark:text-gray-500">
                Need help? Email{' '}
                <a href="mailto:support@abellumber.com" className="text-signal hover:text-signal-hover transition-colors">
                  support@abellumber.com
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
