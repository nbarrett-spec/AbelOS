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
  ACTIVE:    'bg-data-positive-bg text-data-positive-fg',
  PENDING:   'bg-data-warning-bg text-data-warning-fg',
  ON_HOLD:   'bg-data-warning-bg text-data-warning-fg',
  COMPLETED: 'bg-data-info-bg text-data-info-fg',
  CANCELLED: 'bg-data-negative-bg text-data-negative-fg',
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
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-fg">Your projects</h1>
          <p className="text-fg-muted text-sm mt-1">Organize orders and deliveries by job.</p>
        </div>
        <Link
          href="/projects/new"
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-fg-on-accent font-semibold rounded-lg transition-colors"
        >
          + New project
        </Link>
      </div>

      {error && (
        <div className="bg-data-negative-bg border border-data-negative rounded-lg p-4 mb-6">
          <p className="text-sm text-data-negative-fg">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {projects.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center">
          <h2 className="text-2xl font-bold text-fg mb-2">No projects yet</h2>
          <p className="text-fg-muted mb-6">
            Create a project to group orders and deliveries for one job.
          </p>
          <Link
            href="/projects/new"
            className="inline-block bg-brand hover:bg-brand-hover text-fg-on-accent font-bold py-3 px-6 rounded-lg transition"
          >
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="bg-surface rounded-xl border border-border overflow-hidden hover:shadow-lg hover:border-accent transition-all group cursor-pointer"
            >
              {/* Card Header */}
              <div className="p-5 border-b border-border bg-gradient-to-r from-surface-muted to-surface group-hover:from-accent-subtle group-hover:to-surface transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-fg line-clamp-2 group-hover:text-brand transition-colors">{project.name}</h3>
                    {project.address && (
                      <p className="text-sm text-fg-muted mt-1 line-clamp-1">{project.address}</p>
                    )}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${STATUS_COLORS[project.status] || 'bg-surface-muted text-fg-muted'}`}>
                    {project.status}
                  </span>
                </div>
              </div>

              {/* Card Content */}
              <div className="p-5 space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-muted rounded-lg p-3">
                    <p className="text-xs text-fg-muted uppercase font-semibold">Orders</p>
                    <p className="text-lg font-bold text-brand">{project.orderCount}</p>
                  </div>
                  <div className="bg-surface-muted rounded-lg p-3">
                    <p className="text-xs text-fg-muted uppercase font-semibold">Total spend</p>
                    <p className="text-lg font-bold text-fg">{formatCurrency(project.totalSpend)}</p>
                  </div>
                </div>

                {/* Community */}
                {project.community && (
                  <div className="bg-data-info-bg rounded-lg p-2.5">
                    <p className="text-xs text-data-info-fg">
                      <span className="font-semibold">Community:</span> {project.community}
                    </p>
                  </div>
                )}

                {/* Next Delivery */}
                {project.nextDeliveryDate ? (
                  <div className="bg-accent-subtle border border-accent rounded-lg p-3">
                    <p className="text-xs text-accent-fg font-semibold">Next delivery</p>
                    <p className="text-sm text-accent-fg mt-0.5">
                      {daysUntil(project.nextDeliveryDate)} days • {formatDate(project.nextDeliveryDate)}
                    </p>
                  </div>
                ) : (
                  <div className="bg-surface-muted rounded-lg p-3">
                    <p className="text-xs text-fg-muted">No upcoming deliveries</p>
                  </div>
                )}

                {/* Created */}
                <p className="text-xs text-fg-subtle">
                  Created {formatDate(project.createdAt)}
                </p>
              </div>

              {/* Card Footer - Hover Effect */}
              <div className="p-4 border-t border-border bg-surface-muted flex items-center justify-between group-hover:bg-accent-subtle transition-colors">
                <span className="text-xs font-medium text-fg-muted group-hover:text-brand">
                  View details
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
