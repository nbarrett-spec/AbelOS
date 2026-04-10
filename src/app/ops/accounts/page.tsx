'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface BuilderAccount {
  id: string
  companyName: string
  contactName: string
  email: string
  phone: string | null
  city: string | null
  state: string | null
  paymentTerm: string
  status: string
  creditLimit: number | null
  accountBalance: number
  createdAt: string
  organizationName?: string
  divisionName?: string
  _count: {
    projects: number
    orders: number
    customPricing: number
  }
}

const TERM_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  CLOSED: 'bg-gray-100 text-gray-500',
}

export default function BuilderAccountsPage() {
  const [builders, setBuilders] = useState<BuilderAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [termFilter, setTermFilter] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (search) params.append('search', search)
        if (statusFilter !== 'ALL') params.append('status', statusFilter)
        if (termFilter !== 'ALL') params.append('paymentTerm', termFilter)
        if (dateFrom) params.append('dateFrom', dateFrom)
        if (dateTo) params.append('dateTo', dateTo)
        params.append('sortBy', sortBy)
        params.append('sortDir', sortDir)
        params.append('page', page.toString())
        params.append('limit', '50')

        const resp = await fetch(`/api/ops/builders?${params.toString()}`)
        const data = await resp.json()
        setBuilders(data.builders || [])
        if (data.pagination) {
          setTotal(data.pagination.total)
          setTotalPages(data.pagination.pages)
        }
      } catch (err) {
        console.error('Failed to load builders:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [search, statusFilter, termFilter, dateFrom, dateTo, sortBy, sortDir, page])

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-[10px]">{sortBy === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Builder Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">
            CRM view — manage relationships, pricing programs, and account health
          </p>
        </div>
        <button className="px-3 py-1.5 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360]">
          + Add Builder
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Total Accounts</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Page Results</p>
          <p className="text-2xl font-bold text-green-600">{builders.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Current Page</p>
          <p className="text-2xl font-bold text-gray-900">{page} of {totalPages}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Total Records</p>
          <p className="text-2xl font-bold text-[#E67E22]">{total}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by company, contact, email, city..."
            className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#1B4F72]/20 focus:border-[#1B4F72]"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select
            value={termFilter}
            onChange={(e) => { setTermFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="ALL">All Terms</option>
            <option value="PAY_AT_ORDER">Pay at Order</option>
            <option value="PAY_ON_DELIVERY">Pay on Delivery</option>
            <option value="NET_15">Net 15</option>
            <option value="NET_30">Net 30</option>
          </select>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {builders.length} of {total} accounts
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">From</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72]" />
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">To</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72]" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
              className="text-xs text-red-500 hover:text-red-700 font-medium">Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('companyName')}>
                Company<SortIcon col="companyName" />
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('contactName')}>
                Contact<SortIcon col="contactName" />
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Location
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Org / Division
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('paymentTerm')}>
                Terms<SortIcon col="paymentTerm" />
              </th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Projects
              </th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Pricing
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('status')}>
                Status<SortIcon col="status" />
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {builders.map((builder) => (
              <tr key={builder.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/ops/accounts/${builder.id}`}
                    className="font-medium text-gray-900 hover:text-[#1B4F72]"
                  >
                    {builder.companyName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-gray-600">{builder.contactName}</div>
                  <div className="text-xs text-gray-400">{builder.email}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {builder.city && builder.state
                    ? `${builder.city}, ${builder.state}`
                    : builder.city || builder.state || '—'}
                </td>
                <td className="px-4 py-3">
                  {builder.organizationName ? (
                    <div>
                      <div className="text-sm text-gray-900 font-medium">{builder.organizationName}</div>
                      {builder.divisionName && (
                        <div className="text-xs text-gray-400">{builder.divisionName}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                    {TERM_LABELS[builder.paymentTerm] || builder.paymentTerm}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-sm">
                  {builder._count.projects}
                </td>
                <td className="px-4 py-3 text-center text-sm">
                  {builder._count.customPricing > 0 ? (
                    <span className="text-[#E67E22] font-medium">
                      {builder._count.customPricing}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      STATUS_COLORS[builder.status] || 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {builder.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/ops/accounts/${builder.id}`}
                    className="text-xs text-[#1B4F72] hover:text-[#E67E22]"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {builders.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12">
            No builders match your filters
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-white rounded-xl border p-4 flex items-center justify-between">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium border rounded-lg disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 text-sm font-medium border rounded-lg disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
