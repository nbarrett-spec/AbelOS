'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface PO {
  id: string
  poNumber: string
  vendorName: string
  expectedDate: string
  receivedAt?: string
  total: number
  itemCount: number
  daysUntilDue?: number
  daysOverdue?: number
  receivedCount?: number
}

interface VendorPerf {
  vendorName: string
  poCount: number
  avgLeadTimeDays: number
  onTimePercent: number
  totalSpend: number
}

interface SummaryStats {
  totalAwaiting: number
  totalPartiallyReceived: number
  totalOverdue: number
  receivedThisWeek: number
  receivedThisMonth: number
}

interface ReceivingData {
  awaitingReceipt: PO[]
  partiallyReceived: PO[]
  recentlyReceived: PO[]
  overdue: PO[]
  summary: SummaryStats
  vendorPerformance: VendorPerf[]
}

export default function ReceivingPage() {
  const [data, setData] = useState<ReceivingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('awaiting')
  const [submitting, setSubmitting] = useState(false)

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  }

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const loadData = async (): Promise<void> => {
    try {
      setLoading(true)
      const staffId = localStorage.getItem('staffId') || ''
      const staffRole = localStorage.getItem('staffRole') || ''

      const response = await fetch('/api/ops/manufacturing-command/receiving', {
        headers: {
          'x-staff-id': staffId,
          'x-staff-role': staffRole,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch receiving data')
      }

      const result = await response.json()
      setData(result)
    } catch (err: any) {
      setError(err.message || 'Failed to load receiving data')
    } finally {
      setLoading(false)
    }
  }

  useEffect((): void => {
    loadData()
  }, [])

  const handleMarkReceived = async (poId: string): Promise<void> => {
    try {
      setSubmitting(true)
      const staffId = localStorage.getItem('staffId') || ''
      const staffRole = localStorage.getItem('staffRole') || ''

      const response = await fetch('/api/ops/manufacturing-command/receiving', {
        method: 'PATCH',
        headers: {
          'x-staff-id': staffId,
          'x-staff-role': staffRole,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ poId, action: 'mark_received' }),
      })

      if (!response.ok) {
        throw new Error('Failed to mark as received')
      }

      await loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to update PO')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMarkPartial = async (poId: string): Promise<void> => {
    try {
      setSubmitting(true)
      const staffId = localStorage.getItem('staffId') || ''
      const staffRole = localStorage.getItem('staffRole') || ''

      const response = await fetch('/api/ops/manufacturing-command/receiving', {
        method: 'PATCH',
        headers: {
          'x-staff-id': staffId,
          'x-staff-role': staffRole,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ poId, action: 'mark_partial' }),
      })

      if (!response.ok) {
        throw new Error('Failed to mark as partial')
      }

      await loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to update PO')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="text-center text-gray-400">Loading receiving data...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="text-center text-red-400">{error || 'Failed to load data'}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/ops/portal/manufacturing" className="text-blue-400 hover:text-blue-300 text-sm mb-2 inline-block">
              ← Back to Manufacturing
            </Link>
            <h1 className="text-3xl font-bold">Receiving & Putaway</h1>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="border-b border-gray-800 bg-gray-900 p-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-blue-900 border border-blue-700 rounded p-4">
            <div className="text-blue-300 text-xs font-semibold mb-1">AWAITING RECEIPT</div>
            <div className="text-2xl font-bold text-blue-100">{data.summary.totalAwaiting}</div>
          </div>

          <div className="bg-amber-900 border border-amber-700 rounded p-4">
            <div className="text-amber-300 text-xs font-semibold mb-1">PARTIALLY RECEIVED</div>
            <div className="text-2xl font-bold text-amber-100">{data.summary.totalPartiallyReceived}</div>
          </div>

          <div className={`${data.summary.totalOverdue > 0 ? 'animate-pulse' : ''} bg-red-900 border border-red-700 rounded p-4`}>
            <div className="text-red-300 text-xs font-semibold mb-1">OVERDUE</div>
            <div className="text-2xl font-bold text-red-100">{data.summary.totalOverdue}</div>
          </div>

          <div className="bg-emerald-900 border border-emerald-700 rounded p-4">
            <div className="text-emerald-300 text-xs font-semibold mb-1">THIS WEEK</div>
            <div className="text-2xl font-bold text-emerald-100">{data.summary.receivedThisWeek}</div>
          </div>

          <div className="bg-emerald-900 border border-emerald-700 rounded p-4">
            <div className="text-emerald-300 text-xs font-semibold mb-1">THIS MONTH</div>
            <div className="text-2xl font-bold text-emerald-100">{data.summary.receivedThisMonth}</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-800 bg-gray-900">
        <div className="flex overflow-x-auto px-6">
          {['awaiting', 'overdue', 'partial', 'recent', 'vendors'].map((tab: string) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab === 'awaiting' && 'Awaiting'}
              {tab === 'overdue' && 'Overdue'}
              {tab === 'partial' && 'Partial'}
              {tab === 'recent' && 'Recent'}
              {tab === 'vendors' && 'Vendors'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {/* AWAITING TAB */}
        {activeTab === 'awaiting' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">PO #</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Vendor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Expected Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Days Until Due</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-300">Amount</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">Items</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.awaitingReceipt.map((po: PO) => (
                  <tr key={po.id} className="border-b border-gray-800 hover:bg-gray-900">
                    <td className="py-3 px-4 font-mono text-blue-400">{po.poNumber}</td>
                    <td className="py-3 px-4">{po.vendorName}</td>
                    <td className="py-3 px-4">{formatDate(po.expectedDate)}</td>
                    <td className="py-3 px-4">
                      <span className={po.daysUntilDue && po.daysUntilDue < 3 ? 'text-amber-300' : 'text-gray-300'}>
                        {po.daysUntilDue || '—'} days
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">{formatCurrency(po.total)}</td>
                    <td className="py-3 px-4 text-center">{po.itemCount}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleMarkReceived(po.id)}
                          disabled={submitting}
                          className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-sm rounded transition"
                        >
                          Mark Received
                        </button>
                        <button
                          onClick={() => handleMarkPartial(po.id)}
                          disabled={submitting}
                          className="px-3 py-1 bg-amber-700 hover:bg-signal disabled:bg-gray-700 text-sm rounded transition"
                        >
                          Mark Partial
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.awaitingReceipt.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-500">
                      No purchase orders awaiting receipt
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* OVERDUE TAB */}
        {activeTab === 'overdue' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">PO #</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Vendor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Expected Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Days Overdue</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-300">Amount</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">Items</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.overdue.map((po: PO) => (
                  <tr key={po.id} className="border-b border-gray-800 hover:bg-red-950 bg-red-950 bg-opacity-20">
                    <td className="py-3 px-4 font-mono text-red-400">{po.poNumber}</td>
                    <td className="py-3 px-4">{po.vendorName}</td>
                    <td className="py-3 px-4 text-red-300">{formatDate(po.expectedDate)}</td>
                    <td className="py-3 px-4 text-red-400 font-semibold">{po.daysOverdue || '—'} days</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(po.total)}</td>
                    <td className="py-3 px-4 text-center">{po.itemCount}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleMarkReceived(po.id)}
                          disabled={submitting}
                          className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-sm rounded transition"
                        >
                          Mark Received
                        </button>
                        <button
                          onClick={() => handleMarkPartial(po.id)}
                          disabled={submitting}
                          className="px-3 py-1 bg-amber-700 hover:bg-signal disabled:bg-gray-700 text-sm rounded transition"
                        >
                          Mark Partial
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.overdue.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-500">
                      No overdue purchase orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* PARTIAL TAB */}
        {activeTab === 'partial' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">PO #</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Vendor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Expected Date</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">Received / Total</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-300">Amount</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.partiallyReceived.map((po: PO) => (
                  <tr key={po.id} className="border-b border-gray-800 hover:bg-gray-900">
                    <td className="py-3 px-4 font-mono text-purple-400">{po.poNumber}</td>
                    <td className="py-3 px-4">{po.vendorName}</td>
                    <td className="py-3 px-4">{formatDate(po.expectedDate)}</td>
                    <td className="py-3 px-4 text-center text-purple-300">
                      {po.receivedCount} / {po.itemCount}
                    </td>
                    <td className="py-3 px-4 text-right">{formatCurrency(po.total)}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleMarkReceived(po.id)}
                        disabled={submitting}
                        className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-sm rounded transition"
                      >
                        Mark Received
                      </button>
                    </td>
                  </tr>
                ))}
                {data.partiallyReceived.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-500">
                      No partially received purchase orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* RECENT TAB */}
        {activeTab === 'recent' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">PO #</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Vendor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Received Date</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-300">Amount</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">Items</th>
                </tr>
              </thead>
              <tbody>
                {data.recentlyReceived.map((po: PO) => (
                  <tr key={po.id} className="border-b border-gray-800 hover:bg-gray-900">
                    <td className="py-3 px-4 font-mono text-emerald-400">{po.poNumber}</td>
                    <td className="py-3 px-4">{po.vendorName}</td>
                    <td className="py-3 px-4 text-emerald-300">{formatDate(po.receivedAt || '')}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(po.total)}</td>
                    <td className="py-3 px-4 text-center">{po.itemCount}</td>
                  </tr>
                ))}
                {data.recentlyReceived.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      No recently received purchase orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* VENDORS TAB */}
        {activeTab === 'vendors' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 font-semibold text-gray-300">Vendor</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">PO Count</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">Avg Lead Time</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-300">On-Time %</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-300">Total Spend</th>
                </tr>
              </thead>
              <tbody>
                {data.vendorPerformance.map((vendor: VendorPerf) => (
                  <tr key={vendor.vendorName} className="border-b border-gray-800 hover:bg-gray-900">
                    <td className="py-3 px-4">{vendor.vendorName}</td>
                    <td className="py-3 px-4 text-center">{vendor.poCount}</td>
                    <td className="py-3 px-4 text-center text-gray-300">{vendor.avgLeadTimeDays} days</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={vendor.onTimePercent >= 85 ? 'text-emerald-300' : vendor.onTimePercent >= 70 ? 'text-amber-300' : 'text-red-300'}
                      >
                        {vendor.onTimePercent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">{formatCurrency(vendor.totalSpend)}</td>
                  </tr>
                ))}
                {data.vendorPerformance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      No vendor performance data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
