'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

interface Order {
  id: string
  orderNumber: string
  status: string
  total: number
  itemCount: number
  createdAt: string
}

interface Delivery {
  id: string
  jobId: string
  deliveryDate: string
  status: string
  notes: string | null
}

interface Invoice {
  id: string
  invoiceNumber: string
  amount: number
  status: string
  dueDate: string | null
  createdAt: string
}

interface ProjectDetail {
  id: string
  name: string
  address: string
  community: string | null
  status: string
  createdAt: string
  orders: Order[]
  deliveries: Delivery[]
  invoices: Invoice[]
  orderCount: number
  totalSpend: number
  upcomingDeliveryCount: number
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatCurrencyFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function daysUntil(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  RECEIVED:       { label: 'Received',      color: 'bg-data-info-bg text-data-info-fg',         icon: '📋' },
  CONFIRMED:      { label: 'Confirmed',     color: 'bg-brand-subtle text-accent-fg',            icon: '✅' },
  IN_PRODUCTION:  { label: 'In Production', color: 'bg-data-warning-bg text-data-warning-fg',   icon: '🔨' },
  READY_TO_SHIP:  { label: 'Ready to Ship', color: 'bg-data-positive-bg text-data-positive-fg', icon: '📦' },
  SHIPPED:        { label: 'Shipped',       color: 'bg-data-info-bg text-data-info-fg',         icon: '🚚' },
  DELIVERED:      { label: 'Delivered',     color: 'bg-forecast-bg text-forecast-fg',           icon: '✓' },
  COMPLETE:       { label: 'Complete',      color: 'bg-data-positive-bg text-data-positive-fg', icon: '🏁' },
}

const INVOICE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT:          { label: 'Draft',   color: 'bg-surface-muted text-fg-muted' },
  SENT:           { label: 'Sent',    color: 'bg-data-info-bg text-data-info-fg' },
  PAID:           { label: 'Paid',    color: 'bg-data-positive-bg text-data-positive-fg' },
  OVERDUE:        { label: 'Overdue', color: 'bg-data-negative-bg text-data-negative-fg' },
  PARTIALLY_PAID: { label: 'Partial', color: 'bg-data-warning-bg text-data-warning-fg' },
}

export default function ProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params?.id as string
  const { builder, loading: authLoading } = useAuth()

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'deliveries' | 'invoices'>('overview')
  const [showHomeownerModal, setShowHomeownerModal] = useState(false)
  const [homeownerName, setHomeownerName] = useState('')
  const [homeownerEmail, setHomeownerEmail] = useState('')
  const [homeownerPhone, setHomeownerPhone] = useState('')
  const [creatingAccess, setCreatingAccess] = useState(false)
  const [accessUrl, setAccessUrl] = useState('')
  const [accessCreated, setAccessCreated] = useState(false)

  useEffect(() => {
    if (builder && projectId) {
      fetchProjectDetail()
    }
  }, [builder, projectId])

  async function fetchProjectDetail() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch(`/api/projects/${projectId}/details`)
      if (!res.ok) throw new Error('Failed to load project')
      const data = await res.json()
      setProject(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateHomeownerAccess() {
    if (!homeownerName || !homeownerEmail) {
      alert('Name and email are required')
      return
    }

    setCreatingAccess(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/homeowner-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: homeownerName,
          email: homeownerEmail,
          phone: homeownerPhone || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Failed to create access code')
        return
      }

      const data = await res.json()
      setAccessUrl(data.accessUrl)
      setAccessCreated(true)
    } catch (err: any) {
      alert('Failed to create access code')
      console.error(err)
    } finally {
      setCreatingAccess(false)
    }
  }

  function handleCopyUrl() {
    if (accessUrl) {
      navigator.clipboard.writeText(accessUrl)
      alert('Access URL copied to clipboard!')
    }
  }

  function handleResetModal() {
    setShowHomeownerModal(false)
    setHomeownerName('')
    setHomeownerEmail('')
    setHomeownerPhone('')
    setAccessUrl('')
    setAccessCreated(false)
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-fg-muted mb-4">{error || 'Project not found'}</p>
        <Link href="/dashboard/projects" className="text-brand font-medium hover:underline">
          Back to Projects
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href="/dashboard/projects" className="text-brand hover:underline text-sm font-medium">
              Projects
            </Link>
            <span className="text-fg-subtle">/</span>
            <h1 className="text-3xl font-bold text-fg">{project.name}</h1>
          </div>
          {project.address && (
            <p className="text-fg-muted text-sm">{project.address}</p>
          )}
          {project.community && (
            <p className="text-fg-muted text-xs mt-1">Community: {project.community}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHomeownerModal(true)}
            className="px-4 py-2 bg-accent text-white rounded-lg font-semibold text-sm hover:bg-accent-hover transition-all duration-200 shadow-md hover:shadow-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4" />
            </svg>
            Share with Homeowner
          </button>
          <span className="px-3 py-1 rounded-lg font-semibold text-sm bg-data-positive-bg text-data-positive-fg">
            {project.status}
          </span>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-fg-muted uppercase font-semibold mb-2">Total Orders</p>
          <p className="text-3xl font-bold text-brand">{project.orderCount}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-fg-muted uppercase font-semibold mb-2">Total Spend</p>
          <p className="text-3xl font-bold text-fg">{formatCurrency(project.totalSpend)}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-fg-muted uppercase font-semibold mb-2">Upcoming Deliveries</p>
          <p className="text-3xl font-bold text-signal">{project.upcomingDeliveryCount}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-fg-muted uppercase font-semibold mb-2">Invoices</p>
          <p className="text-3xl font-bold text-fg">{project.invoices.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          {(['overview', 'orders', 'deliveries', 'invoices'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 font-semibold text-sm border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-brand border-brand'
                  : 'text-fg-muted border-transparent hover:text-fg'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Project Info */}
              <div>
                <h3 className="font-semibold text-fg mb-4">Project Information</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-fg-muted uppercase font-semibold mb-1">Name</p>
                    <p className="text-sm font-medium text-fg">{project.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-muted uppercase font-semibold mb-1">Address</p>
                    <p className="text-sm font-medium text-fg">{project.address || 'Not specified'}</p>
                  </div>
                  {project.community && (
                    <div>
                      <p className="text-xs text-fg-muted uppercase font-semibold mb-1">Community</p>
                      <p className="text-sm font-medium text-fg">{project.community}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-fg-muted uppercase font-semibold mb-1">Status</p>
                    <p className="text-sm font-medium text-fg">{project.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-muted uppercase font-semibold mb-1">Created</p>
                    <p className="text-sm font-medium text-fg">{formatDate(project.createdAt)}</p>
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div>
                <h3 className="font-semibold text-fg mb-4">Summary</h3>
                <div className="space-y-3 bg-surface-muted rounded-lg p-4">
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-sm text-fg-muted">Total Orders</span>
                    <span className="font-bold text-fg">{project.orderCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-sm text-fg-muted">Total Spent</span>
                    <span className="font-bold text-fg">{formatCurrencyFull(project.totalSpend)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-sm text-fg-muted">Pending Deliveries</span>
                    <span className="font-bold text-signal">{project.upcomingDeliveryCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-fg-muted">Total Invoices</span>
                    <span className="font-bold text-fg">{project.invoices.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="p-6">
            {project.orders.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-fg-muted mb-4">No orders for this project yet</p>
                <Link
                  href="/catalog"
                  className="text-brand font-medium hover:underline"
                >
                  Start ordering →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {project.orders.map(order => {
                  const os = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-surface-muted text-fg-muted', icon: '📋' }
                  return (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      className="flex items-center gap-4 p-4 border border-border rounded-lg hover:border-accent hover:bg-surface-muted transition-all"
                    >
                      <span className="text-2xl">{os.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-brand font-mono">{order.orderNumber}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${os.color}`}>
                            {os.label}
                          </span>
                        </div>
                        <p className="text-xs text-fg-muted mt-0.5">
                          {order.itemCount} items · {formatDate(order.createdAt)}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-fg">{formatCurrencyFull(order.total)}</p>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Deliveries Tab */}
        {activeTab === 'deliveries' && (
          <div className="p-6">
            {project.deliveries.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-fg-muted">No deliveries scheduled yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {project.deliveries.map(delivery => {
                  const days = daysUntil(delivery.deliveryDate)
                  const isPast = days < 0
                  return (
                    <div
                      key={delivery.id}
                      className="flex items-start gap-4 p-4 border border-border rounded-lg hover:border-accent hover:bg-surface-muted transition-all"
                    >
                      <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center flex-shrink-0 ${
                        isPast
                          ? 'bg-data-positive-bg text-data-positive-fg'
                          : days <= 1
                          ? 'bg-data-negative-bg text-data-negative-fg'
                          : days <= 3
                          ? 'bg-data-warning-bg text-data-warning-fg'
                          : 'bg-data-info-bg text-data-info-fg'
                      }`}>
                        <span className="text-lg font-bold leading-none">{Math.abs(days)}</span>
                        <span className="text-[9px] uppercase font-medium">{isPast ? 'ago' : 'days'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-fg">
                          {formatDate(delivery.deliveryDate)}
                        </p>
                        <p className="text-xs text-fg-muted mt-1">
                          Job: {delivery.jobId}
                        </p>
                        {delivery.notes && (
                          <p className="text-xs text-fg-muted mt-1 italic">{delivery.notes}</p>
                        )}
                      </div>
                      <span className="px-2 py-1 rounded-full text-[10px] font-semibold bg-data-info-bg text-data-info-fg whitespace-nowrap">
                        {delivery.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Invoices Tab */}
        {activeTab === 'invoices' && (
          <div className="p-6">
            {project.invoices.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-fg-muted">No invoices for this project</p>
              </div>
            ) : (
              <div className="space-y-3">
                {project.invoices.map(invoice => {
                  const is = INVOICE_STATUS_LABELS[invoice.status] || { label: invoice.status, color: 'bg-surface-muted text-fg-muted' }
                  return (
                    <Link
                      key={invoice.id}
                      href={`/dashboard/invoices`}
                      className="flex items-center gap-4 p-4 border border-border rounded-lg hover:border-accent hover:bg-surface-muted transition-all"
                    >
                      <span className="text-2xl">💳</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-brand font-mono">{invoice.invoiceNumber}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${is.color}`}>
                            {is.label}
                          </span>
                        </div>
                        <p className="text-xs text-fg-muted mt-0.5">
                          {formatDate(invoice.createdAt)}
                          {invoice.dueDate && ` · Due ${formatDate(invoice.dueDate)}`}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-fg">{formatCurrencyFull(invoice.amount)}</p>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Share with Homeowner Modal */}
      {showHomeownerModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95">
            {!accessCreated ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-fg">Share with Homeowner</h3>
                </div>

                <p className="text-sm text-fg-muted mb-5">
                  Create an access code for the homeowner to view and select upgrades for this project.
                </p>

                <div className="space-y-4 mb-5">
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted uppercase mb-1.5">Homeowner Name *</label>
                    <input
                      type="text"
                      value={homeownerName}
                      onChange={(e) => setHomeownerName(e.target.value)}
                      placeholder="John Smith"
                      className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted uppercase mb-1.5">Email *</label>
                    <input
                      type="email"
                      value={homeownerEmail}
                      onChange={(e) => setHomeownerEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted uppercase mb-1.5">Phone (Optional)</label>
                    <input
                      type="tel"
                      value={homeownerPhone}
                      onChange={(e) => setHomeownerPhone(e.target.value)}
                      placeholder="555-1234"
                      className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleResetModal}
                    disabled={creatingAccess}
                    className="flex-1 px-4 py-2.5 border border-border-strong rounded-lg text-sm font-medium text-fg-muted hover:bg-surface-muted transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateHomeownerAccess}
                    disabled={creatingAccess}
                    className="flex-1 px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent-hover transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {creatingAccess ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Generate Access Code'
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-data-positive-bg rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-data-positive-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-fg">Access code generated</h3>
                </div>

                <p className="text-sm text-fg-muted mb-4">
                  Share this link with {homeownerName}:
                </p>

                <div className="bg-surface-muted rounded-lg p-4 mb-4 border border-border">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={accessUrl}
                      readOnly
                      className="flex-1 bg-surface px-3 py-2 border border-border rounded text-xs font-mono text-fg-muted"
                    />
                    <button
                      onClick={handleCopyUrl}
                      className="px-3 py-2 bg-brand text-fg-on-accent rounded text-sm font-medium hover:bg-brand-hover transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="bg-data-info-bg border border-data-info rounded-lg p-3 mb-4">
                  <p className="text-xs text-data-info-fg">
                    <strong>Next step:</strong> Email this link to the homeowner. They&apos;ll use it to review selections and pick upgrades.
                  </p>
                </div>

                <button
                  onClick={handleResetModal}
                  className="w-full px-4 py-2.5 bg-accent text-fg-on-accent rounded-lg text-sm font-semibold hover:bg-accent-hover transition"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
