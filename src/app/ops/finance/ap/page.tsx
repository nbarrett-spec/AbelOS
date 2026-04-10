'use client'

import { useEffect, useState } from 'react'

interface PurchaseOrder {
  id: string
  poNumber: string
  vendorId: string
  vendorName: string
  amount: number
  status: string
  expectedDate: string
  items: number
}

interface APData {
  openPOSummary: {
    draft: number
    pendingApproval: number
    approved: number
    sent: number
    received: number
  }
  vendorSpend: Array<{
    vendorId: string
    vendorName: string
    totalPOs: number
    paidAmount: number
    outstandingAmount: number
    status: string
  }>
  purchaseOrders: PurchaseOrder[]
  billPayQueue: Array<{
    poNumber: string
    vendorName: string
    amount: number
    expectedDate: string
  }>
}

export default function AccountsPayablePage() {
  const [data, setData] = useState<APData | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortColumn, setSortColumn] = useState<string>('expectedDate')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const response = await fetch('/api/ops/finance/ap')
      if (!response.ok) throw new Error('Failed to fetch AP data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US')
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading AP data...</div>
      </div>
    )
  }

  let filteredPOs = data.purchaseOrders
  if (statusFilter !== 'all') {
    filteredPOs = filteredPOs.filter(po => po.status.toLowerCase() === statusFilter.toLowerCase())
  }

  filteredPOs = [...filteredPOs].sort((a, b) => {
    let aVal: any = a[sortColumn as keyof PurchaseOrder]
    let bVal: any = b[sortColumn as keyof PurchaseOrder]

    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase()
      bVal = (bVal as string).toLowerCase()
    }

    const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0
    return sortDirection === 'asc' ? comparison : -comparison
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Accounts Payable</h1>
        <p className="text-gray-500 mt-1">Manage purchase orders, vendor payments, and AP aging</p>
      </div>

      {/* PO Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gray-400">
          <div className="text-gray-500 text-xs font-semibold uppercase">Draft</div>
          <div className="text-2xl font-bold text-gray-900 mt-2">{data.openPOSummary.draft}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-yellow-500">
          <div className="text-gray-500 text-xs font-semibold uppercase">Pending Approval</div>
          <div className="text-2xl font-bold text-gray-900 mt-2">{data.openPOSummary.pendingApproval}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <div className="text-gray-500 text-xs font-semibold uppercase">Approved</div>
          <div className="text-2xl font-bold text-gray-900 mt-2">{data.openPOSummary.approved}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
          <div className="text-gray-500 text-xs font-semibold uppercase">Sent to Vendor</div>
          <div className="text-2xl font-bold text-gray-900 mt-2">{data.openPOSummary.sent}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <div className="text-gray-500 text-xs font-semibold uppercase">Received</div>
          <div className="text-2xl font-bold text-gray-900 mt-2">{data.openPOSummary.received}</div>
        </div>
      </div>

      {/* Vendor Spend Table */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Vendor Spend Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b-2 border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Vendor Name</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Total POs</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Paid Amount</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Outstanding</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.vendorSpend.slice(0, 15).map((vendor, idx) => (
                <tr key={vendor.vendorId} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-3 px-4 text-gray-900 font-medium">{vendor.vendorName}</td>
                  <td className="text-right py-3 px-4 text-gray-600">{vendor.totalPOs}</td>
                  <td className="text-right py-3 px-4 font-semibold text-green-600">{formatCurrency(vendor.paidAmount)}</td>
                  <td className="text-right py-3 px-4 font-semibold text-red-600">{formatCurrency(vendor.outstandingAmount)}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      vendor.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {vendor.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill Pay Queue */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Bill Pay Queue (Ready to Pay)</h3>
        {data.billPayQueue.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No POs ready for payment</div>
        ) : (
          <div className="space-y-3">
            {data.billPayQueue.map((po, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                <div>
                  <div className="font-semibold text-gray-900">{po.poNumber}</div>
                  <div className="text-sm text-gray-500">{po.vendorName} • Due {formatDate(po.expectedDate)}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">{formatCurrency(po.amount)}</div>
                  <button className="mt-1 text-sm text-[#E67E22] hover:text-[#E67E22] font-semibold">Mark Paid →</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter & Controls */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
        <label className="flex items-center gap-2 font-medium text-gray-700">
          Filter by Status:
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="sent_to_vendor">Sent to Vendor</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
          </select>
        </label>
      </div>

      {/* Purchase Orders List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th
                  className="text-left py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('poNumber')}
                >
                  PO # {sortColumn === 'poNumber' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="text-left py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('vendorName')}
                >
                  Vendor {sortColumn === 'vendorName' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('amount')}
                >
                  Amount {sortColumn === 'amount' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Items</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                <th
                  className="text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('expectedDate')}
                >
                  Expected {sortColumn === 'expectedDate' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPOs.map((po, idx) => (
                <tr key={po.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td className="py-3 px-4 font-bold text-[#1B4F72]">{po.poNumber}</td>
                  <td className="py-3 px-4 text-gray-900">{po.vendorName}</td>
                  <td className="text-right py-3 px-4 font-bold text-gray-900">{formatCurrency(po.amount)}</td>
                  <td className="text-right py-3 px-4 text-gray-600">{po.items}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      po.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                      po.status === 'APPROVED' ? 'bg-blue-100 text-blue-800' :
                      po.status === 'PENDING_APPROVAL' ? 'bg-yellow-100 text-yellow-800' :
                      po.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                      'bg-purple-100 text-purple-800'
                    }`}>
                      {po.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="text-right py-3 px-4 text-gray-600">{po.expectedDate ? formatDate(po.expectedDate) : '—'}</td>
                  <td className="py-3 px-4 text-xs">
                    {po.status === 'PENDING_APPROVAL' && <button className="text-[#E67E22] hover:text-[#E67E22] font-semibold">Approve →</button>}
                    {po.status === 'RECEIVED' && <button className="text-[#27AE60] hover:text-[#27AE60] font-semibold">Close</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredPOs.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No purchase orders found with the selected filters.
        </div>
      )}
    </div>
  )
}
