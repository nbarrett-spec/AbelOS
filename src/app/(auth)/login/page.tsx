'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LogIn, ArrowRight, AlertCircle, TreePine } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const emailRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const prefill = searchParams?.get('email')
    if (prefill) setEmail(prefill)
    const t = setTimeout(() => emailRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [searchParams])

  const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'))
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, rememberMe }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Login failed (${res.status})`)

      const next = searchParams?.get('next')
      router.push(next && next.startsWith('/') ? next : '/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* ── Left panel: immersive brand experience ─────────────────── */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-abel-navy overflow-hidden">
        {/* Layered background */}
        <div className="absolute inset-0">
          {/* Gradient base */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0d2840] via-abel-navy to-[#1a3a5c]" />

          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />

          {/* Warm glow from bottom-right */}
          <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-abel-orange/15 rounded-full blur-[120px]" />
          <div className="absolute top-1/4 -left-20 w-[300px] h-[300px] bg-abel-navy-light/20 rounded-full blur-[100px]" />

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
              <div className="w-10 h-10 rounded-xl bg-abel-orange flex items-center justify-center">
                <TreePine className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">Abel Lumber</span>
            </div>
          </div>

          {/* Hero copy */}
          <div className="max-w-md">
            <h1 className="animate-enter animate-enter-delay-1 text-4xl xl:text-5xl font-bold text-white leading-[1.1] tracking-tight">
              Built for the
              <span className="block mt-1 text-transparent bg-clip-text bg-gradient-to-r from-abel-orange to-abel-orange-light">
                builders who
              </span>
              <span className="block mt-1">build Texas.</span>
            </h1>
            <p className="animate-enter animate-enter-delay-2 mt-6 text-lg text-white/60 leading-relaxed max-w-sm">
              Manage orders, track deliveries, and grow your business — all in one place.
            </p>

            {/* Stats strip */}
            <div className="animate-enter animate-enter-delay-3 mt-10 flex gap-8">
              {[
                { value: '2,400+', label: 'Orders managed' },
                { value: '150+', label: 'Active builders' },
                { value: '99.9%', label: 'Uptime' },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-sm text-white/40 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="animate-enter animate-enter-delay-4 text-sm text-white/30">
            Door & Trim Specialists &middot; Gainesville, TX
          </div>
        </div>
      </div>

      {/* ── Right panel: login form ────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 animate-enter">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-abel-navy flex items-center justify-center">
                <TreePine className="w-4.5 h-4.5 text-white" />
              </div>
              <span className="text-lg font-bold text-gray-900 dark:text-white">Abel Lumber</span>
            </div>
          </div>

          {/* Form header */}
          <div className="animate-enter animate-enter-delay-1">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              Welcome back
            </h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Sign in to access your projects and orders
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
          <form onSubmit={handleLogin} className="mt-8 space-y-5 animate-enter animate-enter-delay-2" noValidate>
            <Input
              ref={emailRef}
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
              size="lg"
            />

            <div>
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={handleCapsLock}
                onKeyDown={handleCapsLock}
                required
                aria-required="true"
                size="lg"
              />
              {capsLockOn && (
                <p className="mt-1.5 text-xs text-warning-600 dark:text-warning-400 flex items-center gap-1.5" aria-live="polite">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning-500 animate-pulse" />
                  Caps Lock is on
                </p>
              )}
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer group select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded-md bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-abel-navy focus:ring-abel-navy/30 cursor-pointer transition"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                  Remember me
                </span>
              </label>
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-abel-navy dark:text-abel-navy-light hover:text-abel-navy-dark dark:hover:text-white transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              variant="accent"
              size="lg"
              fullWidth
              loading={loading}
              disabled={!email || !password}
              icon={!loading ? <LogIn className="w-4.5 h-4.5" /> : undefined}
              className="mt-2 !py-3.5 text-base font-semibold shadow-lg shadow-abel-orange/20 hover:shadow-xl hover:shadow-abel-orange/30 hover:scale-[1.01] active:scale-[0.99] transition-all"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          {/* Divider */}
          <div className="animate-enter animate-enter-delay-3 mt-8 flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">New to Abel Lumber?</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          </div>

          {/* Sign up */}
          <div className="animate-enter animate-enter-delay-4 mt-6">
            <Link
              href="/apply"
              className="group flex items-center justify-center gap-2 w-full px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
            >
              Apply for a builder account
              <ArrowRight className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          {/* Footer */}
          <p className="animate-enter animate-enter-delay-5 mt-10 text-center text-xs text-gray-400 dark:text-gray-500">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  )
}
