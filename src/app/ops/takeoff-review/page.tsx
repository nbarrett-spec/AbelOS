'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function TakeoffReviewListPage() {
  const [takeoffs, setTakeoffs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchTakeoffs()
  }, [statusFilter, search])

  async function fetchTakeoffs() {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/ops/takeoffs?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setTakeoffs(data.takeoffs || [])
        setStatusCounts(data.statusCounts || {})
      }
    } finally {
      setLoading(false)
    }
  }

  const statuses = ['NEEDS_REVIEW', 'APPROVED', 'REVISED']
  const statusLabels: Record<string, string> = {
    NEEDS_REVIEW: 'Needs Review',
    APPROVED: 'Approved',
    REVISED: 'Revised',
  }
  const statusColors: Record<string, string> = {
    NEEDS_REVIEW: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-green-100 text-green-800',
    REVISED: 'bg-blue-100 text-blue-800',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Takeoff Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review AI-generated takeoffs, adjust items, and push to quotes
          </p>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setStatusFilter('')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            !statusFilter ? 'bg-[#3E2A1E] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All ({Object.values(statusCounts).reduce((s, v) => s + v, 0)})
        </button>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              statusFilter === s ? 'bg-[#3E2A1E] text-white' : `${statusColors[s] || 'bg-gray-100 text-gray-600'} hover:opacity-80`
            }`}
          >
            {statusLabels[s] || s} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by project or builder name..."
          value={search}
          onChange={e => { setSearch(e.target.value); setLoading(true) }}
          className="w-full max-w-md px-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
        />
      </div>

      {/* Takeoff List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : takeoffs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No takeoffs found. Takeoffs are created when builders upload blueprints.
        </div>
      ) : (
        <div className="space-y-3">
          {takeoffs.map(t => (
            <Link
              key={t.id}
              href={`/ops/takeoff-review/${t.id}`}
              className="block bg-white rounded-xl border p-4 hover:border-[#3E2A1E]/30 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{t.projectName}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColors[t.status] || 'bg-gray-100 text-gray-600'}`}>
                      {statusLabels[t.status] || t.status}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      t.confidence >= 0.92 ? 'bg-green-50 text-green-600' :
                      t.confidence >= 0.85 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-600'
                    }`}>
                      {Math.round(t.confidence * 100)}% confidence
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {t.builderName} &middot; {t.planName || 'No plan'} &middot; {t.sqFootage?.toLocaleString() || '—'} sf
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {t.itemCount} items ({t.matchedCount} matched) &middot; {new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-400">
                    {t.matchedCount}/{t.itemCount} matched
                  </p>
                  <svg className="w-5 h-5 text-gray-300 ml-auto mt-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
