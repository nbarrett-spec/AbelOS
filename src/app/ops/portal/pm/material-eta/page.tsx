'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function MaterialETAPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(14)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/material-eta?days=${days}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch material ETA:', err)
        setError('Failed to load material ETA data. Please try refreshing.')
      })
      .finally(() => setLoading(false))
  }, [days])

  const formatDate = (d: string | null) => {
    if (!d) return 'TBD'
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p>{error}</p>
          <button onClick={() => { setError(null); window.location.reload() }} className="text-red-900 underline text-sm mt-1">
            Try again
          </button>
        </div>
      </div>
    )
  }

  const s = data?.summary || { totalPendingItems: 0, overdueItems: 0, arrivingSoonItems: 0, uniquePOs: 0 }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbound Material ETA</h1>
          <p className="text-sm text-gray-500 mt-1">Track PO arrivals and material availability</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${days === d ? 'bg-white shadow text-[#0f2a3e]' : 'text-gray-500 hover:text-gray-700'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold text-[#0f2a3e]">{s.uniquePOs}</p>
          <p className="text-xs text-gray-500">Open POs</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold text-gray-700">{s.totalPendingItems}</p>
          <p className="text-xs text-gray-500">Pending Items</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold" style={{ color: s.overdueItems > 0 ? '#E74C3C' : '#27AE60' }}>{s.overdueItems}</p>
          <p className="text-xs text-gray-500">Overdue</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold text-[#C6A24E]">{s.arrivingSoonItems}</p>
          <p className="text-xs text-gray-500">Arriving Soon</p>
        </div>
      </div>

      {/* Alerts */}
      {s.overdueItems > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-bold text-red-800">{s.overdueItems} overdue material item{s.overdueItems !== 1 ? 's' : ''} — follow up with vendors</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* POs */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="font-semibold text-gray-900">Purchase Orders</h2>
          {(data?.byPO || []).length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center text-gray-400">No pending POs</div>
          ) : (data.byPO || []).map((po: any) => (
            <div key={po.poNumber} className={`bg-white rounded-xl border p-4 ${po.urgency === 'OVERDUE' ? 'border-red-300 bg-red-50' : po.urgency === 'ARRIVING_SOON' ? 'border-orange-300 bg-orange-50' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{po.poNumber}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    po.urgency === 'OVERDUE' ? 'bg-red-200 text-red-800' :
                    po.urgency === 'ARRIVING_SOON' ? 'bg-orange-200 text-orange-800' :
                    'bg-green-100 text-green-700'
                  }`}>{po.urgency.replace(/_/g, ' ')}</span>
                </div>
                <span className="text-xs text-gray-500">ETA: {formatDate(po.expectedDate)}</span>
              </div>
              {po.vendorName && <p className="text-xs text-gray-600 mb-2">Vendor: {po.vendorName}</p>}
              <div className="space-y-1">
                {po.items.map((item: any) => (
                  <div key={item.productId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{item.sku} — {item.productName}</span>
                    <span className="text-gray-500">{item.receivedQty}/{item.orderedQty} received</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Vendor summary */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">By Vendor</h2>
          <div className="space-y-2">
            {(data?.byVendor || []).map((v: any) => (
              <div key={v.vendorName} className="bg-white rounded-xl border p-3">
                <p className="text-sm font-medium text-gray-900">{v.vendorName}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  <span>{v.poCount} POs</span>
                  <span>{v.itemCount} items</span>
                  {v.overdueCount > 0 && <span className="text-red-600 font-medium">{v.overdueCount} overdue</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
