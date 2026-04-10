'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface Builder {
  id: string
  companyName: string
  contactName: string
  email: string
  phone?: string
  paymentTerm: string
  status: string
  totalProjects: number
  totalQuotes: number
  totalRevenue: number
}

export default function BuildersPage() {
  const [builders, setBuilders] = useState<Builder[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchBuilders() {
      try {
        const res = await fetch('/api/admin/builders')
        if (!res.ok) throw new Error('Failed to fetch builders')
        const data = await res.json()
        setBuilders(data.builders)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching builders')
      } finally {
        setLoading(false)
      }
    }

    fetchBuilders()
  }, [])

  const filteredBuilders = builders.filter(
    (builder) =>
      builder.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      builder.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      builder.contactName.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  if (error) {
    return <div className="text-center py-12 text-red-600">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Builders</h1>
        <p className="text-gray-600 mt-2">Manage all builder accounts</p>
      </div>

      {/* Search Bar */}
      <div>
        <input
          type="text"
          placeholder="Search by company name, email, or contact..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input max-w-md"
        />
      </div>

      {/* Builders Table */}
      <div className="card p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Company Name</th>
                <th className="text-left py-3 px-4 hidden sm:table-cell">Contact</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Email</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Payment Term</th>
                <th className="text-left py-3 px-4 hidden sm:table-cell">Projects</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Quotes</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filteredBuilders.length > 0 ? (
                filteredBuilders.map((builder) => (
                  <tr
                    key={builder.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="py-3 px-4 font-medium text-abel-navy">
                      {builder.companyName}
                    </td>
                    <td className="py-3 px-4 hidden sm:table-cell">{builder.contactName}</td>
                    <td className="py-3 px-4 text-gray-600 hidden md:table-cell">{builder.email}</td>
                    <td className="py-3 px-4 hidden lg:table-cell">
                      <span className="bg-blue-50 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                        {builder.paymentTerm}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center hidden sm:table-cell">
                      {builder.totalProjects}
                    </td>
                    <td className="py-3 px-4 text-center hidden md:table-cell">
                      {builder.totalQuotes}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                          builder.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800'
                            : builder.status === 'PENDING'
                            ? 'bg-yellow-100 text-yellow-800'
                            : builder.status === 'SUSPENDED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {builder.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/admin/builders/${builder.id}`}
                        className="text-abel-navy hover:underline font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-500">
                    {searchTerm
                      ? 'No builders match your search'
                      : 'No builders yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
