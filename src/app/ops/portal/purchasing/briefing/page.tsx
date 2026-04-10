'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface BriefingData {
  summary: {
    posArrivingToday: number
    posOverdue: number
    criticallyLowItems: number
    pendingApproval: number
    openPOValue: number
    vendorResponsesPending: number
  }
  arrivingToday: Array<{
    id: string
    poNumber: string
    vendor: { id: string; name: string; code: string }
    itemCount: number
    totalAmount: number
    status: string
  }>
  overduePOs: Array<{
    id: string
    poNumber: string
    vendor: { id: string; name: string; code: string }
    daysOverdue: number
    totalAmount: number
    status: string
  }>
  criticallyLow: Array<{
    id: string
    sku: string
    name: string
    onHand: number
    reorderPoint: number
    lastOrderDate: string | null
  }>
  pendingApproval: Array<{
    id: string
    poNumber: string
    vendor: { id: string; name: string; code: string }
    totalAmount: number
    createdAt: string
    itemCount: number
  }>
  recentReceiving: Array<{
    id: string
    sku: string
    name: string
    quantityReceived: number
    poNumber: string
    receivedDate: string
  }>
}

export default function PurchasingBriefingPage() {
  const router = useRouter()
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  useEffect(() => {
    async function loadBriefing() {
      try {
        const res = await fetch('/api/ops/purchasing-briefing')
        if (res.ok) {
          const data = await res.json()
          setBriefing(data)
        }
      } catch (error) {
        console.error('Failed to load purchasing briefing:', error)
      } finally {
        setLoading(false)
      }
    }

    loadBriefing()
  }, [])

  const handleFollowUp = (po: BriefingData['overduePOs'][0]) => {
    router.push(`/ops/purchasing/${po.id}`)
  }

  const handleApprove = async (po: BriefingData['pendingApproval'][0]) => {
    const confirmed = window.confirm(
      `Approve PO ${po.poNumber} from ${po.vendor.name} for $${po.totalAmount.toLocaleString()}?`
    )

    if (!confirmed) return

    setApprovingId(po.id)
    try {
      const res = await fetch('/api/ops/purchasing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: po.id,
          status: 'APPROVED',
        }),
      })

      if (res.ok) {
        // Reload briefing data after approval
        const briefingRes = await fetch('/api/ops/purchasing-briefing')
        if (briefingRes.ok) {
          const data = await briefingRes.json()
          setBriefing(data)
        }
      } else {
        alert('Failed to approve purchase order')
      }
    } catch (error) {
      console.error('Error approving PO:', error)
      alert('Error approving purchase order')
    } finally {
      setApprovingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E67E22]" />
      </div>
    )
  }

  if (!briefing) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>Failed to load briefing</p>
      </div>
    )
  }

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="space-y-6">
      {/* Header with greeting and date */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Purchasing Briefing
          </h1>
          <p className="text-gray-600 mt-1">{dateStr}</p>
        </div>
        <Link
          href="/ops/portal/purchasing"
          className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* KPI Cards - 6 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl border border-l-4 border-l-[#E67E22] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Arriving Today
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {briefing.summary.posArrivingToday}
          </p>
          <p className="text-xs text-gray-400 mt-1">POs</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-red-600 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Overdue POs
          </p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {briefing.summary.posOverdue}
          </p>
          <p className="text-xs text-gray-400 mt-1">Past due</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-orange-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Low Stock
          </p>
          <p className="text-2xl font-bold text-orange-600 mt-1">
            {briefing.summary.criticallyLowItems}
          </p>
          <p className="text-xs text-gray-400 mt-1">Items</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-yellow-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Pending Approval
          </p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">
            {briefing.summary.pendingApproval}
          </p>
          <p className="text-xs text-gray-400 mt-1">Awaiting sign-off</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Open PO Value
          </p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            ${(briefing.summary.openPOValue / 1000).toFixed(1)}K
          </p>
          <p className="text-xs text-gray-400 mt-1">In transit</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-green-600 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Vendor Responses
          </p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {briefing.summary.vendorResponsesPending}
          </p>
          <p className="text-xs text-gray-400 mt-1">Pending</p>
        </div>
      </div>

      {/* Overdue POs Alert Section (Priority) */}
      {briefing.overduePOs.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-red-700 mb-4">
            ⚠️ Overdue Purchase Orders ({briefing.overduePOs.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {briefing.overduePOs.map((po) => (
              <div key={po.id} className="bg-white rounded-lg border-2 border-red-300 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <Link
                      href={`/ops/purchasing/${po.id}`}
                      className="font-semibold text-[#E67E22] hover:text-[#D35400]"
                    >
                      {po.poNumber}
                    </Link>
                    <p className="text-sm text-gray-600 mt-1">{po.vendor.name}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-red-200 text-red-800 font-semibold">
                    {po.daysOverdue}d overdue
                  </span>
                </div>
                <div className="mb-3 pt-3 border-t border-gray-200">
                  <p className="text-sm font-semibold text-gray-900">
                    ${po.totalAmount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Status: {po.status}</p>
                </div>
                <button
                  onClick={() => handleFollowUp(po)}
                  className="w-full px-3 py-2 text-sm font-medium rounded border border-red-300 text-red-700 hover:bg-red-100 transition-colors"
                >
                  Follow Up
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Arriving Today and Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Arriving Today */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            POs Arriving Today ({briefing.arrivingToday.length})
          </h2>

          {briefing.arrivingToday.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No deliveries expected today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {briefing.arrivingToday.map((po) => (
                <div key={po.id} className="p-4 rounded-lg border border-green-200 bg-green-50">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <Link
                        href={`/ops/purchasing/${po.id}`}
                        className="font-semibold text-[#E67E22] hover:text-[#D35400]"
                      >
                        {po.poNumber}
                      </Link>
                      <p className="text-sm text-gray-600 mt-1">{po.vendor.name}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-green-200 text-green-800 font-semibold">
                      {po.itemCount} items
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    ${po.totalAmount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Critically Low Stock */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Critically Low Stock ({briefing.criticallyLow.length})
          </h2>

          {briefing.criticallyLow.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>All stock levels healthy</p>
            </div>
          ) : (
            <div className="space-y-3">
              {briefing.criticallyLow.map((item) => {
                const stockPercent =
                  item.reorderPoint > 0
                    ? (item.onHand / item.reorderPoint) * 100
                    : 0
                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-lg border border-red-200 bg-red-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">
                          {item.name}
                        </p>
                        <p className="text-xs text-gray-500 font-mono mt-1">
                          {item.sku}
                        </p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded bg-red-200 text-red-800 font-semibold whitespace-nowrap ml-2">
                        {item.onHand} units
                      </span>
                    </div>

                    {/* Stock bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Stock</span>
                        <span className="text-xs font-semibold text-gray-900">
                          {item.onHand} / {item.reorderPoint}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all bg-red-500"
                          style={{ width: `${Math.min(stockPercent, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pending Approval Table */}
      {briefing.pendingApproval.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Pending Approval ({briefing.pendingApproval.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">
                    PO #
                  </th>
                  <th className="text-left py-3 px-3 text-gray-600 font-semibold">
                    Vendor
                  </th>
                  <th className="text-center py-3 px-3 text-gray-600 font-semibold">
                    Items
                  </th>
                  <th className="text-right py-3 px-3 text-gray-600 font-semibold">
                    Total
                  </th>
                  <th className="text-center py-3 px-3 text-gray-600 font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {briefing.pendingApproval.map((po) => (
                  <tr
                    key={po.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-3">
                      <Link
                        href={`/ops/purchasing/${po.id}`}
                        className="font-semibold text-[#E67E22] hover:text-[#D35400]"
                      >
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="py-3 px-3 text-gray-700">{po.vendor.name}</td>
                    <td className="py-3 px-3 text-center text-gray-700">
                      {po.itemCount}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-gray-900">
                      ${po.totalAmount.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => handleApprove(po)}
                          disabled={approvingId === po.id}
                          className="px-3 py-1 bg-[#E67E22] text-white text-xs rounded hover:bg-[#D35400] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {approvingId === po.id ? 'Approving...' : 'Approve'}
                        </button>
                        <Link
                          href={`/ops/purchasing/${po.id}`}
                          className="px-3 py-1 border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50 transition-colors"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Receiving Activity Feed */}
      {briefing.recentReceiving.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Recent Receiving (Last 48 Hours)
          </h2>
          <div className="space-y-3">
            {briefing.recentReceiving.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 text-sm">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500 font-mono mt-1">
                      {item.sku}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      PO: <span className="font-mono">{item.poNumber}</span> · Qty:{' '}
                      <span className="font-semibold">{item.quantityReceived}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">
                      {new Date(item.receivedDate).toLocaleDateString()}
                    </p>
                    <span className="inline-block mt-2 text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-semibold">
                      Received
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
