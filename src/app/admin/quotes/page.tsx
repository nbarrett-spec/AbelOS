'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Quote {
  id: string
  quoteNumber: string
  project: {
    name: string
  }
  total: number
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
  }>
}

interface KPIData {
  totalQuotes: number
  pendingApproval: number
  totalValue: number
}

type StatusFilter = 'ALL' | 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [kpis, setKpis] = useState<KPIData>({
    totalQuotes: 0,
    pendingApproval: 0,
    totalValue: 0,
  })
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchQuotes() {
      try {
        const res = await fetch('/api/ops/quotes?limit=100')
        if (!res.ok) throw new Error('Failed to fetch quotes')
        const data = await res.json()
        setQuotes(data.data || [])

        // Calculate KPIs
        const quotes_list = data.data || []
        const total = quotes_list.length
        const pending = quotes_list.filter(
          (q: Quote) => q.status === 'PENDING'
        ).length
        const totalValue = quotes_list.reduce(
          (sum: number, q: Quote) => sum + q.total,
          0
        )

        setKpis({
          totalQuotes: total,
          pendingApproval: pending,
          totalValue: totalValue,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching quotes')
      } finally {
        setLoading(false)
      }
    }

    fetchQuotes()
  }, [])

  const filteredQuotes = quotes.filter((quote) => {
    if (activeFilter === 'ALL') return true
    return quote.status === activeFilter
  })

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return 'bg-emerald-100 text-emerald-800'
      case 'PENDING':
        return 'bg-amber-100 text-amber-800'
      case 'DRAFT':
        return 'bg-slate-100 text-slate-800'
      case 'REJECTED':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const filterTabs: { label: string; value: StatusFilter; count: number }[] = [
    {
      label: 'All',
      value: 'ALL',
      count: kpis.totalQuotes,
    },
    {
      label: 'Draft',
      value: 'DRAFT',
      count: quotes.filter((q) => q.status === 'DRAFT').length,
    },
    {
      label: 'Pending',
      value: 'PENDING',
      count: kpis.pendingApproval,
    },
    {
      label: 'Approved',
      value: 'APPROVED',
      count: quotes.filter((q) => q.status === 'APPROVED').length,
    },
    {
      label: 'Rejected',
      value: 'REJECTED',
      count: quotes.filter((q) => q.status === 'REJECTED').length,
    },
  ]

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading quotes...</div>
  }

  if (error) {
    return <div className="text-center py-12 text-red-600">{error}</div>
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Quotes</h1>
        <p className="text-gray-600 mt-2">View and manage all your quotes</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Quotes Card */}
        <div className="card p-6 border border-gray-200 rounded-lg bg-white">
          <p className="text-sm font-medium text-gray-600">Total Quotes</p>
          <p className="text-4xl font-bold mt-2 text-brand">
            {kpis.totalQuotes}
          </p>
          <p className="text-xs text-gray-500 mt-2">All time</p>
        </div>

        {/* Pending Approval Card */}
        <div className="card p-6 border border-amber-200 rounded-lg bg-amber-50">
          <p className="text-sm font-medium text-amber-900">Pending Approval</p>
          <p className="text-4xl font-bold mt-2 text-amber-700">
            {kpis.pendingApproval}
          </p>
          <p className="text-xs text-amber-700 mt-2">Awaiting review</p>
        </div>

        {/* Total Value Card */}
        <div className="card p-6 border border-emerald-200 rounded-lg bg-emerald-50">
          <p className="text-sm font-medium text-emerald-900">Total Value</p>
          <p className="text-3xl font-bold mt-2 text-emerald-700">
            {formatCurrency(kpis.totalValue)}
          </p>
          <p className="text-xs text-emerald-700 mt-2">Combined quote value</p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="card p-0 rounded-lg bg-white border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap border-b border-gray-200">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveFilter(tab.value)}
              className={`flex-1 min-w-24 px-4 py-4 text-sm font-medium transition-colors border-b-2 ${
                activeFilter === tab.value
                  ? 'border-b-signal text-brand bg-blue-50'
                  : 'border-b-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>{tab.label}</span>
              <span className="ml-2 text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Quotes Table */}
      <div className="card p-6 border border-gray-200 rounded-lg bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="text-gray-700 font-semibold">
                <th className="text-left py-4 px-4">Quote #</th>
                <th className="text-left py-4 px-4">Project</th>
                <th className="text-right py-4 px-4">Total</th>
                <th className="text-center py-4 px-4">Status</th>
                <th className="text-left py-4 px-4">Created Date</th>
                <th className="text-center py-4 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuotes.length > 0 ? (
                filteredQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition cursor-pointer"
                  >
                    <td className="py-4 px-4 font-semibold text-brand">
                      {quote.quoteNumber}
                    </td>
                    <td className="py-4 px-4 text-gray-900">
                      {quote.project?.name || 'N/A'}
                    </td>
                    <td className="py-4 px-4 font-semibold text-right text-gray-900">
                      {formatCurrency(quote.total)}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(
                          quote.status
                        )}`}
                      >
                        {quote.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-gray-600">
                      {formatDate(quote.createdAt)}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <Link
                        href={`/quotes/${quote.id}`}
                        className="text-brand hover:text-navy-deep hover:underline font-medium transition"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-500">
                    {activeFilter === 'ALL'
                      ? 'No quotes found'
                      : `No ${activeFilter.toLowerCase()} quotes`}
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
