'use client'

import { useEffect, useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SystemPulse } from '@/components/SystemPulse'

interface Stats {
  totalBuilders: number
  totalProducts: number
  totalProjects: number
  totalQuotes: number
  totalRevenue: number
}

interface Quote {
  id: string
  quoteNumber: string
  builderName: string
  total: number
  status: string
  createdAt: string
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/admin/stats')
        if (!res.ok) throw new Error('Failed to fetch stats')
        const data = await res.json()
        setStats(data.stats)
        setRecentQuotes(data.recentQuotes)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching stats')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  if (error) {
    return <div className="text-center py-12 text-red-600">{error}</div>
  }

  const statCards = [
    {
      label: 'Total Builders',
      value: stats?.totalBuilders || 0,
      color: 'bg-blue-50 border-blue-200',
      textColor: 'text-blue-900',
    },
    {
      label: 'Active Projects',
      value: stats?.totalProjects || 0,
      color: 'bg-green-50 border-green-200',
      textColor: 'text-green-900',
    },
    {
      label: 'Quotes Generated',
      value: stats?.totalQuotes || 0,
      color: 'bg-purple-50 border-purple-200',
      textColor: 'text-purple-900',
    },
    {
      label: 'Total Revenue',
      value: formatCurrency(stats?.totalRevenue || 0),
      color: 'bg-amber-50 border-amber-200',
      textColor: 'text-amber-900',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-2">Overview of your Abel platform metrics</p>
      </div>

      {/* Stats + Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          {statCards.map((stat, idx) => (
            <div
              key={idx}
              className={`card p-6 border ${stat.color}`}
            >
              <p className="text-sm font-medium text-gray-600">{stat.label}</p>
              <p className={`text-3xl font-bold mt-2 ${stat.textColor}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
        <div className="lg:col-span-1">
          <SystemPulse />
        </div>
      </div>

      {/* Recent Quotes Table */}
      <div className="card p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Quotes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Quote #</th>
                <th className="text-left py-3 px-4">Builder</th>
                <th className="text-left py-3 px-4">Total</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentQuotes.length > 0 ? (
                recentQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="py-3 px-4 font-medium text-abel-navy">
                      {quote.quoteNumber}
                    </td>
                    <td className="py-3 px-4">{quote.builderName}</td>
                    <td className="py-3 px-4 font-semibold">
                      {formatCurrency(quote.total)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                          quote.status === 'APPROVED'
                            ? 'bg-green-100 text-green-800'
                            : quote.status === 'SENT'
                            ? 'bg-blue-100 text-blue-800'
                            : quote.status === 'DRAFT'
                            ? 'bg-gray-100 text-gray-800'
                            : 'bg-orange-100 text-orange-800'
                        }`}
                      >
                        {quote.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {formatDate(quote.createdAt)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    No quotes yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
