'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface PurchaseOrder {
  id: string
  poNumber: string
  vendor: string
  totalAmount: number
  status: string
  createdDate: string
  dueDate?: string
}

interface StockAlert {
  id: string
  name: string
  sku: string
  category: string
  onHand: number
  reorderPoint: number
}

interface Vendor {
  id: string
  name: string
  code: string
  contactName: string | null
  email: string | null
  phone: string | null
  poCount: number
  lastOrderDate: string | null
  active: boolean
}

interface VendorPerformance {
  id: number
  vendorId: string
  vendorName: string
  month: string
  onTimeRate: number
  qualityScore: number
  responseTime: number
  totalOrders: number
  lateOrders: number
  returnedOrders: number
  ytdSpend: number
  createdAt: string
}

export default function PurchasingPortal() {
  const router = useRouter()
  const { addToast } = useToast()
  const [posPending, setPosPending] = useState<PurchaseOrder[]>([])
  const [lowStockItems, setLowStockItems] = useState<StockAlert[]>([])
  const [recentPos, setRecentPos] = useState<PurchaseOrder[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorPerformance, setVendorPerformance] = useState<Record<string, VendorPerformance>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [posRes, vendorsRes, inventoryRes, performanceRes] = await Promise.all([
          fetch('/api/ops/purchasing?limit=20'),
          fetch('/api/ops/vendors?limit=10'),
          fetch('/api/ops/inventory?stock=low&limit=6'),
          fetch('/api/ops/vendors/performance'),
        ])

        const [posData, vendorsData, inventoryData, performanceData] = await Promise.all([
          posRes.ok ? posRes.json() : { orders: [] },
          vendorsRes.ok ? vendorsRes.json() : [],
          inventoryRes.ok ? inventoryRes.json() : { products: [] },
          performanceRes.ok ? performanceRes.json() : [],
        ])

        // Separate POs by status
        const allPos = posData.orders || []
        const pending = allPos.filter((po: any) => po.status === 'PENDING_APPROVAL').slice(0, 5)
        const recent = allPos.slice(0, 8)

        setPosPending(pending)
        setRecentPos(recent)

        // Real low stock items from inventory API
        const lowItems: StockAlert[] = (inventoryData.products || [])
          .filter((p: any) => p.onHand > 0 && p.onHand <= Math.max(p.reorderPoint, 10))
          .slice(0, 6)
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            category: p.category,
            onHand: p.onHand,
            reorderPoint: p.reorderPoint,
          }))
        setLowStockItems(lowItems)

        // Real vendor data from vendors API
        const vendorList: Vendor[] = (Array.isArray(vendorsData) ? vendorsData : vendorsData.vendors || []).slice(0, 8)
        setVendors(vendorList)

        // Build performance lookup map
        const performanceMap: Record<string, VendorPerformance> = {}
        if (Array.isArray(performanceData)) {
          performanceData.forEach((perf: VendorPerformance) => {
            performanceMap[perf.vendorId] = perf
          })
        }
        setVendorPerformance(performanceMap)
      } catch (error) {
        console.error('Failed to load purchasing data:', error)
        setError('Failed to load data. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const statusColors: Record<string, string> = {
    PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-blue-100 text-blue-700',
    PARTIAL_RECEIPT: 'bg-purple-100 text-purple-700',
    RECEIVED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-gray-100 text-gray-700',
  }

  const handleApprove = async (po: PurchaseOrder) => {
    const confirmed = window.confirm(
      `Approve PO ${po.poNumber} from ${po.vendor} for $${po.totalAmount.toLocaleString()}?`
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
        // Remove approved PO from pending list
        setPosPending((prev) => prev.filter((p) => p.id !== po.id))
        // Refresh full data to update recent POs and other sections
        router.refresh()
      } else {
        addToast({ type: 'error', title: 'Approval Failed', message: 'Failed to approve purchase order' })
      }
    } catch (error) {
      console.error('Error approving PO:', error)
      addToast({ type: 'error', title: 'Error', message: 'Error approving purchase order' })
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

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-gray-600 font-medium">{error}</p>
        <button onClick={() => { setError(null); window.location.reload() }} className="mt-4 px-4 py-2 bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] text-sm">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Purchasing Dashboard</h1>
          <p className="text-gray-600 mt-1">Purchase orders, inventory, and vendor management</p>
        </div>
        <div className="flex gap-2">
          <Link href="/ops/purchasing" className="px-4 py-2 bg-[#E67E22] text-white rounded-lg hover:bg-[#D35400] transition-colors text-sm font-medium">
            + Create PO
          </Link>
          <Link href="/ops/reports" className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
            📊 Reports
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-l-4 border-l-[#E67E22] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">POs Pending Approval</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{posPending.length}</p>
          <p className="text-xs text-gray-400 mt-1">Awaiting signature</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-red-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Low Stock Items</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{lowStockItems.length}</p>
          <p className="text-xs text-gray-400 mt-1">Below reorder point</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Recent POs</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{recentPos.length}</p>
          <p className="text-xs text-gray-400 mt-1">Last 20 orders</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-[#27AE60] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Active Vendors</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{vendors.filter(v => v.active).length}</p>
          <p className="text-xs text-gray-400 mt-1">In current use</p>
        </div>
      </div>

      {/* Main Grid: POs needing approval + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* POs Needing Approval */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">POs Needing Approval</h2>
            <Link href="/ops/purchasing" className="text-sm text-[#E67E22] hover:text-[#D35400]">
              View All →
            </Link>
          </div>

          {posPending.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">✅</p>
              <p>All purchase orders approved!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-3 text-gray-600 font-semibold">PO #</th>
                    <th className="text-left py-3 px-3 text-gray-600 font-semibold">Vendor</th>
                    <th className="text-right py-3 px-3 text-gray-600 font-semibold">Amount</th>
                    <th className="text-center py-3 px-3 text-gray-600 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {posPending.map((po) => (
                    <tr key={po.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-3">
                        <Link href={`/ops/purchasing/${po.id}`} className="font-semibold text-[#E67E22] hover:text-[#D35400]">
                          {po.poNumber}
                        </Link>
                      </td>
                      <td className="py-3 px-3 text-gray-700">{po.vendor}</td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-900">
                        ${po.totalAmount.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => handleApprove(po)}
                          disabled={approvingId === po.id}
                          className="px-3 py-1 bg-[#E67E22] text-white text-xs rounded hover:bg-[#D35400] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {approvingId === po.id ? 'Approving...' : 'Approve'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link href="/ops/purchasing" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-orange-50 hover:border-[#E67E22] transition-all text-sm font-medium text-gray-900">
              🆕 Create PO
            </Link>
            <Link href="/ops/inventory" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-500 transition-all text-sm font-medium text-gray-900">
              📦 Check Stock
            </Link>
            <Link href="/ops/organizations" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-[#27AE60] transition-all text-sm font-medium text-gray-900">
              📞 Contact Vendor
            </Link>
            <Link href="/ops/reports" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all text-sm font-medium text-gray-900">
              📊 PO Reports
            </Link>
          </div>
        </div>
      </div>

      {/* Low Stock Alerts */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Low Stock Alerts</h2>
          <Link href="/ops/inventory" className="text-sm text-[#E67E22] hover:text-[#D35400]">
            Full Inventory →
          </Link>
        </div>

        {lowStockItems.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">📦</p>
            <p>All stock levels healthy</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {lowStockItems.map((item) => {
              const stockPercent = item.reorderPoint > 0 ? (item.onHand / item.reorderPoint) * 100 : 50
              return (
                <div key={item.id} className="p-4 rounded-lg border border-red-200 bg-red-50">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                    <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-medium whitespace-nowrap ml-2">
                      ⚠️ LOW
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-1 font-mono">{item.sku}</p>
                  <p className="text-sm text-gray-600 mb-3">{item.category}</p>

                  {/* Stock level bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-600">Stock Level</span>
                      <span className="text-xs font-semibold text-gray-900">
                        {item.onHand} / {item.reorderPoint} units
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          stockPercent > 50 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(stockPercent, 100)}%` }}
                      />
                    </div>
                  </div>

                  <Link href="/ops/purchasing" className="block w-full text-xs py-2 rounded border border-red-300 hover:bg-red-100 text-red-700 font-medium transition-colors text-center">
                    Reorder Now
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Top Vendors */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Top Vendors</h2>
          <Link href="/ops/vendors" className="text-sm text-[#E67E22] hover:text-[#D35400]">
            All Vendors →
          </Link>
        </div>
        {vendors.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">🏭</p>
            <p>No vendors found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {vendors.map((vendor) => {
              const perf = vendorPerformance[vendor.id]
              return (
                <div key={vendor.id || vendor.name} className="p-4 rounded-lg border border-gray-200 hover:border-[#E67E22] transition-all">
                  <p className="font-semibold text-gray-900 text-sm mb-1">{vendor.name}</p>
                  {vendor.code && (
                    <p className="text-xs text-gray-400 font-mono mb-3">{vendor.code}</p>
                  )}

                  {/* Contact info */}
                  {vendor.contactName && (
                    <p className="text-xs text-gray-600 mb-1">👤 {vendor.contactName}</p>
                  )}
                  {vendor.email && (
                    <p className="text-xs text-gray-600 mb-1 truncate">📧 {vendor.email}</p>
                  )}
                  {vendor.phone && (
                    <p className="text-xs text-gray-600 mb-3">📞 {vendor.phone}</p>
                  )}

                  {/* Performance Metrics - if available */}
                  {perf && (
                    <div className="mb-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                      <p className="text-xs text-gray-600 font-semibold mb-2">Performance Metrics</p>

                      {/* On-Time Rate */}
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-600">On-Time Rate</span>
                          <span className="text-xs font-semibold text-gray-900">{perf.onTimeRate.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              perf.onTimeRate >= 95 ? 'bg-green-500' : perf.onTimeRate >= 85 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(perf.onTimeRate, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Quality Score */}
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-600">Quality Score</span>
                          <span className="text-xs font-semibold text-gray-900">{perf.qualityScore.toFixed(1)}/100</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              perf.qualityScore >= 90 ? 'bg-green-500' : perf.qualityScore >= 75 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(perf.qualityScore, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Additional metrics */}
                      <div className="text-xs space-y-1 pt-2 border-t border-blue-100">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Orders</span>
                          <span className="font-semibold">{perf.totalOrders}</span>
                        </div>
                        {perf.lateOrders > 0 && (
                          <div className="flex justify-between text-red-700">
                            <span>Late Orders</span>
                            <span className="font-semibold">{perf.lateOrders}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="space-y-1 pt-3 border-t border-gray-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Purchase Orders</span>
                      <span className="font-semibold text-gray-900">{vendor.poCount}</span>
                    </div>
                    {vendor.lastOrderDate && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Last Order</span>
                        <span className="font-semibold text-gray-900">{new Date(vendor.lastOrderDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Status</span>
                      <span className={`font-semibold ${vendor.active ? 'text-green-600' : 'text-gray-400'}`}>
                        {vendor.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent POs */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Recent Purchase Orders</h2>
          <Link href="/ops/purchasing" className="text-sm text-[#E67E22] hover:text-[#D35400]">
            All Orders →
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-3 text-gray-600 font-semibold">PO #</th>
                <th className="text-left py-3 px-3 text-gray-600 font-semibold">Vendor</th>
                <th className="text-right py-3 px-3 text-gray-600 font-semibold">Amount</th>
                <th className="text-center py-3 px-3 text-gray-600 font-semibold">Status</th>
                <th className="text-left py-3 px-3 text-gray-600 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentPos.map((po) => (
                <tr key={po.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3">
                    <Link href={`/ops/purchasing/${po.id}`} className="font-semibold text-[#E67E22] hover:text-[#D35400]">
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-gray-700">{po.vendor}</td>
                  <td className="py-3 px-3 text-right font-semibold text-gray-900">
                    ${po.totalAmount.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${statusColors[po.status] || 'bg-gray-100 text-gray-700'}`}>
                      {po.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-gray-600">
                    {new Date(po.createdDate).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
