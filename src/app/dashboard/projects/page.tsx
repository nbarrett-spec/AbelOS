'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

interface Project {
  id: string
  name: string
  address: string
  community: string | null
  status: string
  orderCount: number
  totalSpend: number
  upcomingDeliveryCount: number
  nextDeliveryDate: string | null
  createdAt: string
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function daysUntil(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  ON_HOLD: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

export default function ProjectsPage() {
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (builder) {
      fetchProjects()
    }
  }, [builder])

  async function fetchProjects() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to load projects')
      const data = await res.json()
      setProjects(data.projects || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600 text-sm mt-1">Manage your construction and renovation projects</p>
        </div>
        <Link
          href="/projects/new"
          className="px-4 py-2 bg-[#C6A24E] hover:bg-[#A8882A] text-white font-semibold rounded-lg transition-colors"
        >
          + New Project
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-5xl mb-4">🏗️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Projects Yet</h2>
          <p className="text-gray-600 mb-6">
            Start by creating your first project to organize your orders and deliveries.
          </p>
          <Link
            href="/projects/new"
            className="inline-block bg-[#0f2a3e] hover:bg-[#0f2a3e]/90 text-white font-bold py-3 px-6 rounded-lg transition"
          >
            Create Your First Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-[#C6A24E] transition-all group cursor-pointer"
            >
              {/* Card Header */}
              <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white group-hover:from-[#C6A24E]/5 group-hover:to-white transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-gray-900 line-clamp-2 group-hover:text-[#0f2a3e] transition-colors">{project.name}</h3>
                    {project.address && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-1">{project.address}</p>
                    )}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-700'}`}>
                    {project.status}
                  </span>
                </div>
              </div>

              {/* Card Content */}
              <div className="p-5 space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Orders</p>
                    <p className="text-lg font-bold text-[#0f2a3e]">{project.orderCount}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Total Spend</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(project.totalSpend)}</p>
                  </div>
                </div>

                {/* Community */}
                {project.community && (
                  <div className="bg-blue-50 rounded-lg p-2.5">
                    <p className="text-xs text-blue-700">
                      <span className="font-semibold">Community:</span> {project.community}
                    </p>
                  </div>
                )}

                {/* Next Delivery */}
                {project.nextDeliveryDate ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs text-amber-700 font-semibold">Next Delivery</p>
                    <p className="text-sm text-amber-900 mt-0.5">
                      {daysUntil(project.nextDeliveryDate)} days • {formatDate(project.nextDeliveryDate)}
                    </p>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-600">No upcoming deliveries</p>
                  </div>
                )}

                {/* Created */}
                <p className="text-xs text-gray-400">
                  Created {formatDate(project.createdAt)}
                </p>
              </div>

              {/* Card Footer - Hover Effect */}
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between group-hover:bg-[#C6A24E]/5 transition-colors">
                <span className="text-xs font-medium text-gray-600 group-hover:text-[#0f2a3e]">
                  View Details
                </span>
                <span className="text-lg group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
