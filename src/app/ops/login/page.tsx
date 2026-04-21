'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import AegisBackground from '@/components/AegisBackground'

function StaffLoginInner() {
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/ops'

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/ops/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      router.push(redirect)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  const showSessionExpiredBanner = redirect && redirect !== '/ops'

  return (
    <div className="min-h-screen flex font-sans bg-canvas">
      {/* Left panel — brand */}
      <div
        className="hidden lg:flex lg:w-[44%] relative items-center justify-center overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #080D1A 0%, #0F1629 50%, #151D35 100%)' }}
      >
        <AegisBackground variant="full" orbCount={3} doorBlueprint doorSeed={7} />
        {/* 4-stop gradient accent line */}
        <div className="absolute top-0 left-0 right-0 h-px z-10" style={{ background: 'linear-gradient(90deg, transparent, var(--c1), var(--c2), var(--c3), var(--c4), transparent)' }} />
        <div className="absolute top-16 left-16 flex items-center gap-2 z-10">
          <div className="w-1.5 h-1.5 rounded-full bg-c1 animate-pulse-soft" />
          <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-c1/80">
            Aegis · v3
          </span>
        </div>

        <div className="relative z-10 px-16 max-w-lg">
          <div className="w-14 h-14 mb-10 rounded-xl glass-card flex items-center justify-center">
            <Image src="/icon-192.png" alt="Abel Lumber" width={40} height={40} className="rounded" />
          </div>
          <h2 className="text-[28px] font-semibold text-white mb-4 tracking-tight leading-tight">
            The operations platform
            <br />
            for <span className="text-gradient">Abel Lumber.</span>
          </h2>
          <p className="text-white/60 text-[13px] leading-relaxed max-w-md">
            Orders, MRP, collections, sales, and supply chain — one surface, built for the people who run the business.
          </p>
          <div className="mt-12 pt-6 border-t border-white/10 flex items-center gap-6 text-[10px] font-mono tracking-wider uppercase text-white/40">
            <span>Abel Doors & Trim</span>
            <span className="w-1 h-1 rounded-full bg-white/20" />
            <span>DFW</span>
            <span className="w-1 h-1 rounded-full bg-white/20" />
            <span>Est. 2021</span>
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center bg-canvas px-6 sm:px-12 relative">
        {showSessionExpiredBanner && (
          <div className="absolute top-6 left-6 right-6 flex justify-center z-20">
            <div className="max-w-sm w-full px-3 py-2 bg-data-warning-bg border border-data-warning/30 rounded-md text-data-warning-fg text-xs font-medium text-center">
              Your session has expired. Please sign in again.
            </div>
          </div>
        )}

        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2.5 mb-10">
            <Image src="/icon-192.png" alt="Abel Lumber" width={32} height={32} className="rounded-md" />
            <span className="text-sm font-semibold text-fg tracking-tight">Aegis</span>
          </div>

          <div className="mb-8">
            <div className="eyebrow mb-2">Staff Portal</div>
            <h1 className="text-display-lg text-fg mb-1">Sign in</h1>
            <p className="text-sm text-fg-muted">Abel Lumber operations · abellumber.com</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@abellumber.com"
                required
                autoFocus
                className="input"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label !mb-0">Password</label>
                <a href="/ops/forgot-password" className="text-xs text-accent hover:text-accent-hover transition-colors">
                  Forgot?
                </a>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="input"
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-data-negative-bg border border-data-negative/20 rounded-md text-data-negative-fg text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn w-full btn-lg bg-grad text-white hover:opacity-90"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="text-center text-[11px] text-fg-subtle mt-8 font-mono tracking-wider">
            Abel Doors & Trim · Aegis v3.0
          </p>
        </div>
      </div>
    </div>
  )
}

export default function StaffLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-canvas">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
        </div>
      }
    >
      <StaffLoginInner />
    </Suspense>
  )
}
