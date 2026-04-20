'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Document {
  id: string
  title: string
  type: string
  dealId: string
  dealCompanyName: string
  status: string
  uploadedAt: string
  fileSize: number
}

const TYPE_COLORS: Record<string, string> = {
  PROPOSAL: 'bg-blue-100 text-blue-800',
  SPECIFICATION: 'bg-purple-100 text-purple-800',
  QUOTE: 'bg-yellow-100 text-yellow-800',
  CONTRACT: 'bg-green-100 text-green-800',
  REPORT: 'bg-orange-100 text-orange-800',
  OTHER: 'bg-gray-100 text-gray-800',
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // In a real implementation, this would fetch documents from the API
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C9822B]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-500 mt-1">View and manage project documents</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <div className="text-4xl mb-4">📁</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Documents Yet</h3>
        <p className="text-gray-500 mb-6">
          Project documents and materials will appear here as you progress through deals
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
