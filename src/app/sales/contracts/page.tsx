'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Contract {
  id: string
  contractNumber: string
  title: string
  type: string
  status: string
  dealId: string
  dealCompanyName: string
  startDate: string
  endDate: string
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  SIGNED: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // In a real implementation, this would fetch contracts from the API
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#e67e22]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
          <p className="text-gray-500 mt-1">Manage all your contracts and agreements</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <div className="text-4xl mb-4">📋</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Contracts Yet</h3>
        <p className="text-gray-500 mb-6">
          Your contracts will appear here as you create new deals
        </p>
        <Link
          href="/sales/deals"
          className="inline-block px-6 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1a2f4e] font-medium transition"
        >
          View My Deals
        </Link>
      </div>
    </div>
  )
}
