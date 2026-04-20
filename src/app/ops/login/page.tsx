'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'

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
    <div className="min-h-screen flex font-sans">
      {/* Left panel — brand accent (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[45%] bg-abel-walnut relative items-center justify-center overflow-hidden">
        {/* Subtle wood-grain texture overlay */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `repeating-linear-gradient(
            90deg,
            transparent,
            transparent 2px,
            rgba(255,255,255,0.1) 2px,
            rgba(255,255,255,0.1) 4px
          )`,
        }} />
        {/* Content */}
        <div className="relative z-10 px-16 max-w-lg">
          <div className="w-20 h-20 mb-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center shadow-lg">
            <Image
              src="/icon-192.png"
              alt="Abel Lumber"
              width={56}
              height={56}
              className="rounded-lg"
            />
          </div>
          <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">
            Abel Operations
          </h2>
          <p className="text-abel-cream/70 text-base leading-relaxed">
            Doors, trim, and hardware — delivered right, every time. Manage your accounts, orders, and deliveries from one place.
          </p>
          <div className="mt-12 pt-8 border-t border-white/10">
            <p className="text-abel-cream/40 text-xs font-medium tracking-wider uppercase">
              Abel Doors & Trim · DFW
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center bg-abel-cream px-6 sm:px-12 relative">
        {/* Session Expiry Banner */}
        {showSessionExpiredBanner && (
          <div className="absolute top-6 left-6 right-6 flex justify-center z-20">
            <div className="max-w-sm w-full px-4 py-3 bg-warning-100 border border-warning-300 rounded-xl text-warning-800 text-sm font-medium text-center">
              Your session has expired. Please sign in again.
            </div>
          </div>
        )}

        <div className="w-full max-w-sm">
          {/* Mobile logo (visible only on small screens) */}
          <div className="flex lg:hidden items-center gap-3 mb-10">
            <Image
              src="/icon-192.png"
              alt="Abel Lumber"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <span className="text-xl font-bold text-abel-walnut tracking-tight">
              Abel Operations
            </span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-abel-charcoal tracking-tight mb-2">
              Sign in to your account
            </h1>
            <p className="text-sm text-abel-kiln-oak">
              Staff portal access
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-elevation-3 p-8">
            <form onSubmit={handleSubmit}>
              {/* Email */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-abel-charcoal mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@abellumber.com"
                  required
                  className="w-full px-4 py-3 bg-abel-cream/50 border border-gray-200 rounded-xl text-sm text-abel-charcoal outline-none transition-all duration-200 focus:border-abel-amber focus:ring-2 focus:ring-abel-amber/20 placeholder:text-gray-400"
                />
              </div>

              {/* Password */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-abel-charcoal mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full px-4 py-3 bg-abel-cream/50 border border-gray-200 rounded-xl text-sm text-abel-charcoal outline-none transition-all duration-200 focus:border-abel-amber focus:ring-2 focus:ring-abel-amber/20 placeholder:text-gray-400"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-danger-700 text-sm mb-5">
                  {error}
                </div>
              )}

              {/* Forgot Password */}
              <div className="text-right mb-6">
                <a
                  href="/ops/forgot-password"
                  className="text-sm text-abel-amber font-medium hover:text-abel-amber-dark transition-colors"
                >
                  Forgot password?
                </a>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-6 bg-abel-walnut hover:bg-abel-walnut-light text-white font-semibold rounded-xl transition-all duration-200 shadow-elevation-2 hover:shadow-elevation-3 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:shadow-none text-sm tracking-wide"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in…
                  </span>
                ) : 'Sign In'}
              </button>
            </form>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-gray-400 mt-8 font-medium">
            Abel Doors & Trim · Operations Platform
          </p>
        </div>
      </div>
    </div>
  )
}

export default function StaffLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-abel-cream font-sans">
        <div className="flex items-center gap-3 text-abel-kiln-oak">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">Loading…</span>
        </div>
      </div>
    }>
      <StaffLoginInner />
    </Suspense>
  )
}
