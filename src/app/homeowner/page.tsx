'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomeownerLanding() {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!token.trim()) {
      setError('Please enter your access token')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/homeowner/${token}`)
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Invalid access token')
        setLoading(false)
        return
      }
      router.push(`/homeowner/${token}`)
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto pt-8">
      {/* Welcome Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#3E2A1E] to-[#5A4233] px-6 py-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Welcome to Your Selection Portal</h2>
          <p className="text-white/80 text-sm">Customize the doors and hardware for your new home</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
              Access Token
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Enter the access token from your email invitation
            </p>
            <input
              id="token"
              type="text"
              placeholder="e.g., abc123token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={loading}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3E2A1E]/30 focus:border-[#3E2A1E] disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#C9822B] text-white rounded-lg font-semibold text-sm hover:bg-[#A86B1F] transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Validating...
              </span>
            ) : (
              'Access My Project'
            )}
          </button>
        </form>
      </div>

      {/* How It Works */}
      <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">How It Works</h3>
        <div className="space-y-3">
          {[
            { step: '1', title: 'View Your Selections', desc: 'See your project details and default door/hardware options' },
            { step: '2', title: 'Browse Upgrades', desc: 'Choose from available upgrade options for each location' },
            { step: '3', title: 'See Pricing', desc: 'View the additional cost for each upgrade' },
            { step: '4', title: 'Confirm', desc: "Lock in your selections and we'll deliver your perfect doors" },
          ].map(item => (
            <div key={item.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-[#3E2A1E] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {item.step}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{item.title}</p>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
