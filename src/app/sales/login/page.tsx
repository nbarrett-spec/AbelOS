'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function SalesLoginInner() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/sales'

  async function handleSubmit(e: FormEvent) {
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

      // Redirect to intended page or dashboard
      router.push(redirect)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div
        className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#1e3a5f] via-[#2c5aa0] to-[#1a2f4e] flex-col items-center justify-center p-12 relative overflow-hidden"
      >
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#e67e22] opacity-10 rounded-full -mr-48 -mt-48" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#e67e22] opacity-5 rounded-full -ml-48 -mb-48" />

        <div className="relative z-10 text-center">
          <div className="mb-8">
            <div className="w-24 h-24 rounded-xl bg-[#e67e22] flex items-center justify-center mx-auto shadow-lg">
              <span className="text-5xl font-bold text-white">A</span>
            </div>
          </div>

          <h1 className="text-4xl font-bold text-white mb-4">Abel Sales Portal</h1>
          <p className="text-xl text-[#e67e22] font-semibold mb-2">Track. Close. Win.</p>
          <p className="text-white/70 text-lg">
            Your dedicated platform for managing deals and growing your pipeline
          </p>

          <div className="mt-12 space-y-4 text-left">
            <div className="flex items-start gap-3">
              <span className="text-[#e67e22] text-2xl">✓</span>
              <div>
                <p className="font-semibold text-white">Real-time Pipeline Visibility</p>
                <p className="text-white/60 text-sm">Track all your deals at a glance</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#e67e22] text-2xl">✓</span>
              <div>
                <p className="font-semibold text-white">Deal Management Tools</p>
                <p className="text-white/60 text-sm">Organize and manage your opportunities</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#e67e22] text-2xl">✓</span>
              <div>
                <p className="font-semibold text-white">Instant Document Access</p>
                <p className="text-white/60 text-sm">Get contracts and materials when you need them</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-8 bg-white">
        <div className="w-full max-w-md">
          {/* Mobile header */}
          <div className="lg:hidden mb-8 text-center">
            <div className="w-16 h-16 rounded-lg bg-[#e67e22] flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold text-white">A</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Abel Sales</h1>
            <p className="text-[#e67e22] font-semibold">Track. Close. Win.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
            <p className="text-gray-600 text-sm mb-6">
              Sign in to your sales dashboard
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@abellumber.com"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e67e22] focus:border-transparent transition"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e67e22] focus:border-transparent transition"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#1e3a5f] hover:bg-[#1a2f4e] text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            {/* Footer */}
            <p className="text-center text-xs text-gray-500 mt-6">
              Abel Lumber Sales Portal
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SalesLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>}>
      <SalesLoginInner />
    </Suspense>
  )
}
