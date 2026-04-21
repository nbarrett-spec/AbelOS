'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface PurchaseOrder {
  id: string
  poNumber: string
  vendor: string
  vendorName: string
  createdDate: string
  expectedDate: string
  amount: number
  total: number
  status: string
}

interface APSummary {
  totalOpenAP: number
  dueThisWeek: number
  dueNext2Weeks: number
  overdue: number
  avgVendorLeadTime: number
}

interface VendorData {
  vendor: string
  openPOCount: number
  totalAmount: number
  avgLeadTime: number
  lastOrderDate: string
}

interface StatusCount {
  status: string
  count: number
}

export default function APManagementPage() {
  const [summary, setSummary] = useState<APSummary | null>(null)
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [vendors, setVendors] = useState<VendorData[]>([])
  const [upcomingPayments, setUpcomingPayments] = useState<PurchaseOrder[]>([])
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])
  const [recentActivity, setRecentActivity] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter and sort states
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [vendorFilter, setVendorFilter] = useState<string>('ALL')
  const [sortColumn, setSortColumn] = useState<string>('expectedDate')
  const [sortAsc, setSortAsc] = useState(true)

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getDaysUntilDue = (expectedDate: string) => {
    const today = new Date()
    const dueDate = new Date(expectedDate)
    const diffTime = dueDate.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-900 text-gray-100 border-gray-800',
      PENDING_APPROVAL: 'bg-amber-900 text-amber-100 border-amber-700',
      APPROVED: 'bg-blue-900 text-blue-100 border-blue-700',
      SENT_TO_VENDOR: 'bg-sky-900 text-sky-100 border-sky-700',
      PARTIALLY_RECEIVED: 'bg-purple-900 text-purple-100 border-purple-700',
      RECEIVED: 'bg-emerald-900 text-emerald-100 border-emerald-700',
      CANCELLED: 'bg-red-900 text-red-100 border-red-700',
    }
    return colors[status] || 'bg-gray-900 text-gray-100 border-gray-800'
  }

  const getStatusBgColor = (status: string) => {
    const bgColors: Record<string, string> = {
      DRAFT: 'bg-gray-500',
      PENDING_APPROVAL: 'bg-signal',
      APPROVED: 'bg-blue-500',
      SENT_TO_VENDOR: 'bg-sky-500',
      PARTIALLY_RECEIVED: 'bg-purple-500',
      RECEIVED: 'bg-emerald-500',
      CANCELLED: 'bg-red-500',
    }
    return bgColors[status] || 'bg-gray-500'
  }

  useEffect(() => {
    async function loadAPData() {
      try {
        setLoading(true)
        const response = await fetch('/api/ops/accounting-command?section=ap-detail')

        if (!response.ok) {
          throw new Error('Failed to fetch AP data')
        }

        const data = await response.json()

        // Process the data
        const today = new Date()
        const oneWeekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        const twoWeeksFromNow = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)

        const allPOs = data.orders || []

        // Filter for open POs only (not RECEIVED or CANCELLED)
        const openPOs = allPOs.filter((po: PurchaseOrder) =>
          po.status !== 'RECEIVED' && po.status !== 'CANCELLED'
        )

        // Calculate summary
        const totalOpen = openPOs.reduce((sum: number, po: PurchaseOrder) => sum + (po.total || po.amount || 0), 0)
        const dueThisWeek = openPOs.filter((po: PurchaseOrder) => {
          const dueDate = new Date(po.expectedDate)
          return dueDate >= today && dueDate <= oneWeekFromNow
        }).length
        const dueNext2Weeks = openPOs.filter((po: PurchaseOrder) => {
          const dueDate = new Date(po.expectedDate)
          return dueDate > oneWeekFromNow && dueDate <= twoWeeksFromNow
        }).length
        const overdue = openPOs.filter((po: PurchaseOrder) => {
          const dueDate = new Date(po.expectedDate)
          return dueDate < today
        }).length

        const leadTimes = openPOs
          .map((po: PurchaseOrder) => {
            const created = new Date(po.createdDate)
            const expected = new Date(po.expectedDate)
            return Math.ceil((expected.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
          })
          .filter((days: number) => days > 0)
        const avgLeadTime = leadTimes.length > 0 ? Math.round(leadTimes.reduce((a: number, b: number) => a + b, 0) / leadTimes.length) : 0

        setSummary({
          totalOpenAP: totalOpen,
          dueThisWeek,
          dueNext2Weeks,
          overdue,
          avgVendorLeadTime: avgLeadTime,
        })

        // Get status counts
        const statusMap = new Map<string, number>()
        const allStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']
        allStatuses.forEach((status: string) => {
          const count = allPOs.filter((po: PurchaseOrder) => po.status === status).length
          if (count > 0) statusMap.set(status, count)
        })
        setStatusCounts(Array.from(statusMap, ([status, count]) => ({ status, count })))

        // Set all purchase orders
        setPurchaseOrders(allPOs)

        // Calculate vendor summary
        const vendorMap = new Map<string, VendorData>()
        openPOs.forEach((po: PurchaseOrder) => {
          const vendorName = po.vendorName || po.vendor || 'Unknown'
          const existing = vendorMap.get(vendorName)
          const leadDays = Math.ceil((new Date(po.expectedDate).getTime() - new Date(po.createdDate).getTime()) / (1000 * 60 * 60 * 24))

          if (existing) {
            vendorMap.set(vendorName, {
              vendor: vendorName,
              openPOCount: existing.openPOCount + 1,
              totalAmount: existing.totalAmount + (po.total || po.amount || 0),
              avgLeadTime: Math.round((existing.avgLeadTime + leadDays) / 2),
              lastOrderDate: new Date(po.createdDate) > new Date(existing.lastOrderDate) ? po.createdDate : existing.lastOrderDate,
            })
          } else {
            vendorMap.set(vendorName, {
              vendor: vendorName,
              openPOCount: 1,
              totalAmount: po.total || po.amount || 0,
              avgLeadTime: leadDays > 0 ? leadDays : 0,
              lastOrderDate: po.createdDate,
            })
          }
        })

        const vendorList = Array.from(vendorMap.values()).sort((a: VendorData, b: VendorData) => b.totalAmount - a.totalAmount)
        setVendors(vendorList)

        // Get upcoming payments (due soon)
        const upcoming = openPOs
          .filter((po: PurchaseOrder) => {
            const dueDate = new Date(po.expectedDate)
            return dueDate >= today && dueDate <= twoWeeksFromNow
          })
          .sort((a: PurchaseOrder, b: PurchaseOrder) => new Date(a.expectedDate).getTime() - new Date(b.expectedDate).getTime())
          .slice(0, 10)
        setUpcomingPayments(upcoming)

        // Get recent activity (last 10 completed/received POs)
        const recent = allPOs
          .filter((po: PurchaseOrder) => po.status === 'RECEIVED')
          .sort((a: PurchaseOrder, b: PurchaseOrder) => new Date(b.expectedDate).getTime() - new Date(a.expectedDate).getTime())
          .slice(0, 10)
        setRecentActivity(recent)

        setError(null)
      } catch (err) {
        console.error('Failed to load AP data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load AP data')
      } finally {
        setLoading(false)
      }
    }

    loadAPData()
  }, [])

  // Filter and sort POs
  const filteredPOs = purchaseOrders
    .filter((po: PurchaseOrder) => statusFilter === 'ALL' || po.status === statusFilter)
    .filter((po: PurchaseOrder) => vendorFilter === 'ALL' || (po.vendorName || po.vendor) === vendorFilter)
    .sort((a: PurchaseOrder, b: PurchaseOrder) => {
      let aVal: any = a[sortColumn as keyof PurchaseOrder]
      let bVal: any = b[sortColumn as keyof PurchaseOrder]

      if (sortColumn === 'expectedDate' || sortColumn === 'createdDate') {
        aVal = new Date(aVal).getTime()
        bVal = new Date(bVal).getTime()
      } else if (sortColumn === 'amount' || sortColumn === 'total') {
        aVal = Number(aVal) || 0
        bVal = Number(bVal) || 0
      }

      return sortAsc ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) : (aVal > bVal ? -1 : aVal < bVal ? 1 : 0)
    })

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortAsc(!sortAsc)
    } else {
      setSortColumn(column)
      setSortAsc(true)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-950 border border-red-800 text-red-100 px-6 py-4 rounded-lg">
        <p className="font-semibold">Error loading AP data</p>
        <p className="text-sm text-red-200 mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Accounts Payable</h1>
          <div className="flex items-center gap-2 mt-2">
            <Link
              href="/ops/portal/accounting"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              ← Back to Accounting
            </Link>
          </div>
        </div>
      </div>

      {/* AP Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total Open AP</p>
            <p className="text-2xl font-bold text-gray-100 mt-2">
              {formatCurrency(summary.totalOpenAP)}
            </p>
            <p className="text-xs text-gray-500 mt-1">{purchaseOrders.filter(po => po.status !== 'RECEIVED' && po.status !== 'CANCELLED').length} POs</p>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Due This Week</p>
            <p className="text-2xl font-bold text-yellow-400 mt-2">{summary.dueThisWeek}</p>
            <p className="text-xs text-gray-500 mt-1">POs due soon</p>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Due Next 2 Weeks</p>
            <p className="text-2xl font-bold text-blue-400 mt-2">{summary.dueNext2Weeks}</p>
            <p className="text-xs text-gray-500 mt-1">Upcoming payment</p>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Overdue</p>
            <p className={`text-2xl font-bold mt-2 ${summary.overdue > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {summary.overdue}
            </p>
            <p className="text-xs text-gray-500 mt-1">Past expected date</p>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Avg Lead Time</p>
            <p className="text-2xl font-bold text-purple-400 mt-2">{summary.avgVendorLeadTime}d</p>
            <p className="text-xs text-gray-500 mt-1">Average days</p>
          </div>
        </div>
      )}

      {/* PO Status Overview */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">PO Status Overview</h2>
        <div className="flex flex-wrap gap-2">
          {statusCounts.map(({ status, count }: StatusCount) => (
            <div key={status} className={`${getStatusBgColor(status)} px-4 py-2 rounded-lg text-gray-900 font-semibold text-sm`}>
              {status.replace(/_/g, ' ')}: {count}
            </div>
          ))}
        </div>
      </div>

      {/* AP by Vendor Table */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">AP by Vendor</h2>
        {vendors.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No vendor data available</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Vendor Name</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Open POs</th>
                  <th className="text-right py-3 px-4 text-gray-400 font-semibold">Total Amount</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Avg Lead Time</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Order</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((vendor: VendorData, idx: number) => (
                  <tr key={idx} className="border-b border-gray-800 hover:bg-gray-850 transition-colors">
                    <td className="py-3 px-4 text-gray-200">{vendor.vendor}</td>
                    <td className="py-3 px-4 text-center text-gray-200">{vendor.openPOCount}</td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-100">{formatCurrency(vendor.totalAmount)}</td>
                    <td className="py-3 px-4 text-center text-gray-200">{vendor.avgLeadTime} days</td>
                    <td className="py-3 px-4 text-gray-200">{formatDate(vendor.lastOrderDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upcoming Payments */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">Upcoming Payments (Due Soon)</h2>
        {upcomingPayments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No payments due soon</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">PO #</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Vendor</th>
                  <th className="text-right py-3 px-4 text-gray-400 font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Expected Date</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Days Until Due</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {upcomingPayments.map((po: PurchaseOrder) => {
                  const daysUntilDue = getDaysUntilDue(po.expectedDate)
                  const isOverdue = daysUntilDue < 0
                  const isDueSoon = daysUntilDue >= 0 && daysUntilDue <= 7

                  return (
                    <tr key={po.id} className={`border-b border-gray-800 transition-colors ${
                      isOverdue ? 'bg-red-950 hover:bg-red-900' : isDueSoon ? 'bg-amber-950 hover:bg-amber-900' : 'hover:bg-gray-850'
                    }`}>
                      <td className="py-3 px-4 font-semibold text-blue-400">{po.poNumber}</td>
                      <td className="py-3 px-4 text-gray-200">{po.vendorName || po.vendor}</td>
                      <td className="py-3 px-4 text-right font-semibold text-gray-100">{formatCurrency(po.total || po.amount)}</td>
                      <td className="py-3 px-4 text-gray-200">{formatDate(po.expectedDate)}</td>
                      <td className={`py-3 px-4 text-center font-semibold ${
                        isOverdue ? 'text-red-400' : isDueSoon ? 'text-yellow-400' : 'text-gray-200'
                      }`}>
                        {isOverdue ? `${Math.abs(daysUntilDue)} days overdue` : `${daysUntilDue} days`}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getStatusColor(po.status)}`}>
                          {po.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* All Open Purchase Orders */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">All Open Purchase Orders</h2>

        <div className="mb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-2">Filter by Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm"
            >
              <option value="ALL">All Statuses</option>
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map(status => (
                <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-2">Filter by Vendor</label>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm"
            >
              <option value="ALL">All Vendors</option>
              {vendors.map((vendor: VendorData) => (
                <option key={vendor.vendor} value={vendor.vendor}>{vendor.vendor}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredPOs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No purchase orders match the selected filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th
                    className="text-left py-3 px-4 text-gray-400 font-semibold cursor-pointer hover:text-gray-200 transition-colors"
                    onClick={() => handleSort('poNumber')}
                  >
                    PO # {sortColumn === 'poNumber' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th
                    className="text-left py-3 px-4 text-gray-400 font-semibold cursor-pointer hover:text-gray-200 transition-colors"
                    onClick={() => handleSort('vendor')}
                  >
                    Vendor {sortColumn === 'vendor' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th
                    className="text-left py-3 px-4 text-gray-400 font-semibold cursor-pointer hover:text-gray-200 transition-colors"
                    onClick={() => handleSort('createdDate')}
                  >
                    Created {sortColumn === 'createdDate' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th
                    className="text-left py-3 px-4 text-gray-400 font-semibold cursor-pointer hover:text-gray-200 transition-colors"
                    onClick={() => handleSort('expectedDate')}
                  >
                    Expected {sortColumn === 'expectedDate' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th
                    className="text-right py-3 px-4 text-gray-400 font-semibold cursor-pointer hover:text-gray-200 transition-colors"
                    onClick={() => handleSort('amount')}
                  >
                    Amount {sortColumn === 'amount' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Age (days)</th>
                </tr>
              </thead>
              <tbody>
                {filteredPOs.map((po: PurchaseOrder) => {
                  const createdDate = new Date(po.createdDate)
                  const today = new Date()
                  const ageDays = Math.ceil((today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24))
                  const daysUntilDue = getDaysUntilDue(po.expectedDate)
                  const isOverdue = daysUntilDue < 0

                  return (
                    <tr key={po.id} className={`border-b border-gray-800 transition-colors ${
                      isOverdue ? 'bg-red-950 hover:bg-red-900' : 'hover:bg-gray-850'
                    }`}>
                      <td className="py-3 px-4 font-semibold text-blue-400">{po.poNumber}</td>
                      <td className="py-3 px-4 text-gray-200">{po.vendorName || po.vendor}</td>
                      <td className="py-3 px-4 text-gray-200">{formatDate(po.createdDate)}</td>
                      <td className="py-3 px-4 text-gray-200">{formatDate(po.expectedDate)}</td>
                      <td className="py-3 px-4 text-right font-semibold text-gray-100">{formatCurrency(po.total || po.amount)}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getStatusColor(po.status)}`}>
                          {po.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-gray-200">{ageDays}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vendor Payment History */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">Vendor Payment History (Last 10 Completed)</h2>
        {recentActivity.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No completed POs yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Vendor</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">PO #</th>
                  <th className="text-right py-3 px-4 text-gray-400 font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Received Date</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((po: PurchaseOrder) => (
                  <tr key={po.id} className="border-b border-gray-800 hover:bg-gray-850 transition-colors">
                    <td className="py-3 px-4 text-gray-200">{po.vendorName || po.vendor}</td>
                    <td className="py-3 px-4 font-semibold text-blue-400">{po.poNumber}</td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-100">{formatCurrency(po.total || po.amount)}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getStatusColor(po.status)}`}>
                        {po.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-200">{formatDate(po.expectedDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
