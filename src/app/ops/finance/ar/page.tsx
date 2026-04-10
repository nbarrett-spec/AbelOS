'use client'

import { useEffect, useState } from 'react'

interface Invoice {
  id: string
  invoiceNumber: string
  builderId: string
  builderName: string
  amount: number
  status: string
  dueDate: string
  issuedAt: string
  daysOutstanding: number
  amountPaid: number
  balanceDue: number
}

interface ARData {
  agingBuckets: {
    current: { count: number; amount: number }
    days1to30: { count: number; amount: number }
    days31to60: { count: number; amount: number }
    days60plus: { count: number; amount: number }
  }
  invoices: Invoice[]
  builderSummary: Array<{
    builderId: string
    builderName: string
    totalOutstanding: number
    invoiceCount: number
  }>
}

export default function AccountsReceivablePage() {
  const [data, setData] = useState<ARData | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortColumn, setSortColumn] = useState<string>('dueDate')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const response = await fetch('/api/ops/finance/ar')
      if (!response.ok) throw new Error('Failed to fetch AR data')
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
        <div className="text-gray-500">Loading AR data...</div>
      </div>
    )
  }

  let filteredInvoices = data.invoices
  if (statusFilter !== 'all') {
    filteredInvoices = filteredInvoices.filter(inv => inv.status.toLowerCase() === statusFilter.toLowerCase())
  }

  // Sort invoices
  filteredInvoices = [...filteredInvoices].sort((a, b) => {
    let aVal: any = a[sortColumn as keyof Invoice]
    let bVal: any = b[sortColumn as keyof Invoice]

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
        <h1 className="text-3xl font-bold text-gray-900">Accounts Receivable</h1>
        <p className="text-gray-500 mt-1">Manage invoices, AR aging, and payment tracking</p>
      </div>

      {/* Aging Buckets */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Current',
            amount: data.agingBuckets.current.amount,
            count: data.agingBuckets.current.count,
            color: 'border-green-500'
          },
          {
            label: '1-30 Days',
            amount: data.agingBuckets.days1to30.amount,
            count: data.agingBuckets.days1to30.count,
            color: 'border-yellow-500'
          },
          {
            label: '31-60 Days',
            amount: data.agingBuckets.days31to60.amount,
            count: data.agingBuckets.days31to60.count,
            color: 'border-orange-500'
          },
          {
            label: '60+ Days',
            amount: data.agingBuckets.days60plus.amount,
            count: data.agingBuckets.days60plus.count,
            color: 'border-red-500'
          },
        ].map((bucket) => (
          <div key={bucket.label} className={`bg-white rounded-lg shadow p-4 border-l-4 ${bucket.color}`}>
            <div className="text-gray-500 text-xs font-semibold uppercase">{bucket.label}</div>
            <div className="text-xl font-bold text-gray-900 mt-2">{formatCurrency(bucket.amount)}</div>
            <div className="text-sm text-gray-500 mt-1">{bucket.count} invoices</div>
          </div>
        ))}
      </div>

      {/* Builder AR Summary */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Builder AR Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b-2 border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Builder Name</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Outstanding</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Invoice Count</th>
              </tr>
            </thead>
            <tbody>
              {data.builderSummary.map((builder, idx) => (
                <tr key={builder.builderId} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-3 px-4 text-gray-900 font-medium">{builder.builderName}</td>
                  <td className="text-right py-3 px-4 font-bold text-red-600">{formatCurrency(builder.totalOutstanding)}</td>
                  <td className="text-right py-3 px-4 text-gray-600">{builder.invoiceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <option value="issued">Issued</option>
            <option value="sent">Sent</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
      </div>

      {/* Invoice Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th
                  className="text-left py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('invoiceNumber')}
                >
                  Invoice # {sortColumn === 'invoiceNumber' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="text-left py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('builderName')}
                >
                  Builder {sortColumn === 'builderName' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('amount')}
                >
                  Amount {sortColumn === 'amount' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('balanceDue')}
                >
                  Balance Due {sortColumn === 'balanceDue' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                <th
                  className="text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('dueDate')}
                >
                  Due Date {sortColumn === 'dueDate' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('daysOutstanding')}
                >
                  Days Outstanding {sortColumn === 'daysOutstanding' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((invoice, idx) => (
                <tr key={invoice.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td className="py-3 px-4 font-bold text-[#1B4F72]">{invoice.invoiceNumber}</td>
                  <td className="py-3 px-4 text-gray-900">{invoice.builderName}</td>
                  <td className="text-right py-3 px-4 font-bold text-gray-900">{formatCurrency(invoice.amount)}</td>
                  <td className={`text-right py-3 px-4 font-bold ${invoice.balanceDue > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(invoice.balanceDue)}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      invoice.status === 'PAID' ? 'bg-green-100 text-green-800' :
                      invoice.status === 'OVERDUE' ? 'bg-red-100 text-red-800' :
                      invoice.status === 'PARTIALLY_PAID' ? 'bg-yellow-100 text-yellow-800' :
                      invoice.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="text-right py-3 px-4 text-gray-600">{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</td>
                  <td className={`text-right py-3 px-4 font-semibold ${invoice.daysOutstanding > 60 ? 'text-red-600' : invoice.daysOutstanding > 30 ? 'text-orange-600' : 'text-gray-600'}`}>
                    {invoice.daysOutstanding}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <button className="text-[#E67E22] hover:text-[#E67E22] font-semibold">Send Reminder</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredInvoices.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No invoices found with the selected filters.
        </div>
      )}
    </div>
  )
}
