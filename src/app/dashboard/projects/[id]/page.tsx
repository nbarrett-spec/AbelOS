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
  RECEIVED: { label: 'Received', color: 'bg-blue-100 text-blue-700', icon: '📋' },
  CONFIRMED: { label: 'Confirmed', color: 'bg-indigo-100 text-indigo-700', icon: '✅' },
  IN_PRODUCTION: { label: 'In Production', color: 'bg-amber-100 text-amber-700', icon: '🔨' },
  READY_TO_SHIP: { label: 'Ready to Ship', color: 'bg-emerald-100 text-emerald-700', icon: '📦' },
  SHIPPED: { label: 'Shipped', color: 'bg-cyan-100 text-cyan-700', icon: '🚚' },
  DELIVERED: { label: 'Delivered', color: 'bg-violet-100 text-violet-700', icon: '✓' },
  COMPLETE: { label: 'Complete', color: 'bg-green-100 text-green-700', icon: '🏁' },
}

const INVOICE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  SENT: { label: 'Sent', color: 'bg-blue-100 text-blue-700' },
  PAID: { label: 'Paid', color: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700' },
  PARTIALLY_PAID: { label: 'Partial', color: 'bg-amber-100 text-amber-700' },
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
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || 'Project not found'}</p>
        <Link href="/dashboard/projects" className="text-[#0f2a3e] font-medium hover:underline">
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
            <Link href="/dashboard/projects" className="text-[#0f2a3e] hover:underline text-sm font-medium">
              Projects
            </Link>
            <span className="text-gray-400">/</span>
            <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
          </div>
          {project.address && (
            <p className="text-gray-600 text-sm">{project.address}</p>
          )}
          {project.community && (
            <p className="text-gray-500 text-xs mt-1">Community: {project.community}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHomeownerModal(true)}
            className="px-4 py-2 bg-[#C6A24E] text-white rounded-lg font-semibold text-sm hover:bg-[#A8882A] transition-all duration-200 shadow-md hover:shadow-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4" />
            </svg>
            Share with Homeowner
          </button>
          <span className="px-3 py-1 rounded-lg font-semibold text-sm bg-green-100 text-green-700">
            {project.status}
          </span>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Total Orders</p>
          <p className="text-3xl font-bold text-[#0f2a3e]">{project.orderCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Total Spend</p>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(project.totalSpend)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Upcoming Deliveries</p>
          <p className="text-3xl font-bold text-signal">{project.upcomingDeliveryCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Invoices</p>
          <p className="text-3xl font-bold text-gray-900">{project.invoices.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {(['overview', 'orders', 'deliveries', 'invoices'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 font-semibold text-sm border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-[#0f2a3e] border-[#0f2a3e]'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
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
                <h3 className="font-semibold text-gray-900 mb-4">Project Information</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Name</p>
                    <p className="text-sm font-medium text-gray-900">{project.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Address</p>
                    <p className="text-sm font-medium text-gray-900">{project.address || 'Not specified'}</p>
                  </div>
                  {project.community && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Community</p>
                      <p className="text-sm font-medium text-gray-900">{project.community}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Status</p>
                    <p className="text-sm font-medium text-gray-900">{project.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Created</p>
                    <p className="text-sm font-medium text-gray-900">{formatDate(project.createdAt)}</p>
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-4">Summary</h3>
                <div className="space-y-3 bg-gray-50 rounded-lg p-4">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Total Orders</span>
                    <span className="font-bold text-gray-900">{project.orderCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Total Spent</span>
                    <span className="font-bold text-gray-900">{formatCurrencyFull(project.totalSpend)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Pending Deliveries</span>
                    <span className="font-bold text-signal">{project.upcomingDeliveryCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Total Invoices</span>
                    <span className="font-bold text-gray-900">{project.invoices.length}</span>
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
                <p className="text-gray-500 mb-4">No orders for this project yet</p>
                <Link
                  href="/catalog"
                  className="text-[#0f2a3e] font-medium hover:underline"
                >
                  Start ordering →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {project.orders.map(order => {
                  const os = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-700', icon: '📋' }
                  return (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-[#C6A24E] hover:bg-gray-50 transition-all"
                    >
                      <span className="text-2xl">{os.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#0f2a3e] font-mono">{order.orderNumber}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${os.color}`}>
                            {os.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {order.itemCount} items · {formatDate(order.createdAt)}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-gray-900">{formatCurrencyFull(order.total)}</p>
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
                <p className="text-gray-500">No deliveries scheduled yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {project.deliveries.map(delivery => {
                  const days = daysUntil(delivery.deliveryDate)
                  const isPast = days < 0
                  return (
                    <div
                      key={delivery.id}
                      className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:border-[#C6A24E] hover:bg-gray-50 transition-all"
                    >
                      <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center flex-shrink-0 ${
                        isPast
                          ? 'bg-green-100 text-green-700'
                          : days <= 1
                          ? 'bg-red-100 text-red-700'
                          : days <= 3
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        <span className="text-lg font-bold leading-none">{Math.abs(days)}</span>
                        <span className="text-[9px] uppercase font-medium">{isPast ? 'ago' : 'days'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatDate(delivery.deliveryDate)}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          Job: {delivery.jobId}
                        </p>
                        {delivery.notes && (
                          <p className="text-xs text-gray-500 mt-1 italic">{delivery.notes}</p>
                        )}
                      </div>
                      <span className="px-2 py-1 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 whitespace-nowrap">
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
                <p className="text-gray-500">No invoices for this project</p>
              </div>
            ) : (
              <div className="space-y-3">
                {project.invoices.map(invoice => {
                  const is = INVOICE_STATUS_LABELS[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-700' }
                  return (
                    <Link
                      key={invoice.id}
                      href={`/dashboard/invoices`}
                      className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-[#C6A24E] hover:bg-gray-50 transition-all"
                    >
                      <span className="text-2xl">💳</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#0f2a3e] font-mono">{invoice.invoiceNumber}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${is.color}`}>
                            {is.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatDate(invoice.createdAt)}
                          {invoice.dueDate && ` · Due ${formatDate(invoice.dueDate)}`}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-gray-900">{formatCurrencyFull(invoice.amount)}</p>
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95">
            {!accessCreated ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#C6A24E]/10 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-[#C6A24E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">Share with Homeowner</h3>
                </div>

                <p className="text-sm text-gray-600 mb-5">
                  Create an access code for the homeowner to view and select upgrades for this project.
                </p>

                <div className="space-y-4 mb-5">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase mb-1.5">Homeowner Name *</label>
                    <input
                      type="text"
                      value={homeownerName}
                      onChange={(e) => setHomeownerName(e.target.value)}
                      placeholder="John Smith"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase mb-1.5">Email *</label>
                    <input
                      type="email"
                      value={homeownerEmail}
                      onChange={(e) => setHomeownerEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase mb-1.5">Phone (Optional)</label>
                    <input
                      type="tel"
                      value={homeownerPhone}
                      onChange={(e) => setHomeownerPhone(e.target.value)}
                      placeholder="555-1234"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C6A24E] focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleResetModal}
                    disabled={creatingAccess}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateHomeownerAccess}
                    disabled={creatingAccess}
                    className="flex-1 px-4 py-2.5 bg-[#C6A24E] text-white rounded-lg text-sm font-semibold hover:bg-[#A8882A] transition disabled:opacity-50 flex items-center justify-center gap-2"
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
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">Access Code Generated</h3>
                </div>

                <p className="text-sm text-gray-600 mb-4">
                  Share this link with {homeownerName}:
                </p>

                <div className="bg-gray-50 rounded-lg p-4 mb-4 border border-gray-200">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={accessUrl}
                      readOnly
                      className="flex-1 bg-white px-3 py-2 border border-gray-300 rounded text-xs font-mono text-gray-700"
                    />
                    <button
                      onClick={handleCopyUrl}
                      className="px-3 py-2 bg-[#0f2a3e] text-white rounded text-sm font-medium hover:bg-[#0d2c47] transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-blue-700">
                    <strong>Next step:</strong> Send this link to the homeowner via email. They can use it to view selections and select upgrades.
                  </p>
                </div>

                <button
                  onClick={handleResetModal}
                  className="w-full px-4 py-2.5 bg-[#C6A24E] text-white rounded-lg text-sm font-semibold hover:bg-[#A8882A] transition"
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
