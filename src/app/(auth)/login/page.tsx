'use client'

/**
 * Login — Aegis v2 "Drafting Room" composition.
 *
 * Left 2/3: navy canvas with a seed-picked architectural blueprint animation
 * (drawn over 9 seconds, then breathes). Right 1/3: cream "mylar" form on a
 * Wes Anderson vertical-center grid. On successful auth the left panel
 * slides off-screen over 320ms (--ease-spring) before router.push().
 *
 * All legacy form behavior is preserved: searchParams prefill, caps-lock
 * detection, remember-me, forgot-password, apply-for-account. Blueprint
 * picks from 12 designs via day-of-year seed — different door every day.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, LogIn } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import BlueprintAnimation from '@/components/BlueprintAnimation'

function dayOfYearSeed(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86400000)
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  /** Triggers the left-panel slide-away once auth succeeds. */
  const [authed, setAuthed] = useState(false)
  /** Stable seed for SSR → client — pick once. */
  const [seed] = useState<number>(() => dayOfYearSeed())
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

      // Kick the slide-away, then navigate after the transition.
      setAuthed(true)
      const next = searchParams?.get('next')
      const dest = next && next.startsWith('/') ? next : '/dashboard'
      window.setTimeout(() => router.push(dest), 320)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-canvas">
      {/* ── Left 2/3: navy blueprint canvas ───────────────────────────────── */}
      <aside
        aria-hidden="true"
        className="hidden lg:flex lg:w-2/3 relative overflow-hidden"
        style={{
          backgroundColor: 'var(--navy-deep)',
          transform: authed ? 'translateX(-110%)' : 'translateX(0)',
          transition: 'transform 320ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1))',
        }}
      >
        {/* Drafting grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(198,162,78,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(198,162,78,0.07) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse 75% 70% at 50% 50%, black 0%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 75% 70% at 50% 50%, black 0%, transparent 100%)',
          }}
        />

        {/* Soft gold bloom behind the drawing */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 45% 55% at 50% 50%, rgba(198,162,78,0.08), transparent 70%)',
          }}
        />

        {/* Top-left logo */}
        <div className="absolute top-10 left-10 z-10 flex items-center gap-3">
          {/* Inline mark — SVG so no image-decode flicker */}
          <svg
            width="34"
            height="34"
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="36" height="36" rx="8" fill="#0a1a28" stroke="#c6a24e" strokeWidth="1" />
            <path
              d="M13 28 L20 10 L27 28 M16 22 H24"
              stroke="#c6a24e"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-[#f5f1e8]">Abel Lumber</p>
            <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#c6a24e]">Aegis</p>
          </div>
        </div>

        {/* Blueprint — centered, gold currentColor */}
        <div
          className="relative z-[1] flex-1 flex items-center justify-center px-16"
          style={{ color: 'var(--gold)' }}
        >
          <BlueprintAnimation
            seed={seed}
            loop
            duration={9000}
            strokeWidth={1.1}
            className="w-full max-w-[480px] h-auto drop-shadow-[0_0_18px_rgba(198,162,78,0.15)]"
            ariaLabel="Door plan blueprint — daily drawing"
          />
        </div>

        {/* Footer caption */}
        <p className="absolute bottom-10 left-10 right-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[#c6a24e]/70">
          Gainesville, TX · Doors, trim & hardware for the builders who build Texas
        </p>
      </aside>

      {/* ── Right 1/3: cream login form ───────────────────────────────────── */}
      <section
        className="flex-1 flex items-center justify-center px-6 sm:px-10 py-10"
        style={{ backgroundColor: 'var(--mylar)' }}
      >
        <div className="w-full max-w-sm">
          {/* Mobile mark — only shows when the left panel is hidden */}
          <div className="lg:hidden mb-10 flex items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="2" y="2" width="36" height="36" rx="8" fill="#0a1a28" />
              <path
                d="M13 28 L20 10 L27 28 M16 22 H24"
                stroke="#c6a24e"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ color: 'var(--walnut-600)' }}
            >
              Abel Lumber
            </span>
          </div>

          <header className="mb-8">
            <p
              className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3"
              style={{ color: 'var(--gold-dark)' }}
            >
              <span
                aria-hidden
                className="inline-block w-7 h-px align-middle mr-2"
                style={{ background: 'var(--gold-dark)' }}
              />
              Aegis · Sign in
            </p>
            <h1
              className="font-display italic text-4xl leading-[1.05] tracking-tight"
              style={{
                fontFamily: 'var(--font-display, Georgia, serif)',
                color: 'var(--walnut-700)',
                fontStyle: 'italic',
              }}
            >
              Welcome back
            </h1>
            <p className="mt-3 text-[13px]" style={{ color: 'var(--walnut-500)' }}>
              Sign in to access your projects, quotes, and orders.
            </p>
          </header>

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 flex items-start gap-3 px-4 py-3 rounded-md"
              style={{
                backgroundColor: 'rgba(182,78,61,0.08)',
                border: '1px solid rgba(182,78,61,0.25)',
                color: '#7a2a1c',
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-[13px] leading-snug">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4" noValidate>
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
                <p
                  className="mt-1.5 text-[11px] flex items-center gap-1.5 font-mono uppercase tracking-wider"
                  aria-live="polite"
                  style={{ color: 'var(--gold-dark)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--gold-dark)' }} />
                  Caps lock is on
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer group select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-400 cursor-pointer"
                  style={{ accentColor: 'var(--gold-dark)' }}
                />
                <span className="text-[12px]" style={{ color: 'var(--walnut-500)' }}>
                  Remember me
                </span>
              </label>
              <Link
                href="/forgot-password"
                className="text-[12px] font-medium transition-colors hover:underline"
                style={{ color: 'var(--gold-dark)' }}
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={!email || !password}
              icon={!loading ? <LogIn className="w-4 h-4" /> : undefined}
              className="mt-2"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <footer className="mt-10 text-center">
            <p
              className="font-mono text-[10px] uppercase tracking-[0.18em] mb-3"
              style={{ color: 'var(--walnut-400)' }}
            >
              New to Abel Lumber
            </p>
            <Link
              href="/apply"
              className="inline-block text-[12px] font-medium hover:underline"
              style={{ color: 'var(--walnut-600)' }}
            >
              Apply for a builder account →
            </Link>
            <p className="mt-8 text-[10px]" style={{ color: 'var(--walnut-400)' }}>
              By signing in, you agree to our Terms of Service and Privacy Policy.
            </p>
          </footer>
        </div>
      </section>
    </div>
  )
}
