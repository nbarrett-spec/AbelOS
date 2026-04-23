'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

interface TemplateItem {
  id: string
  productId: string
  productName: string
  sku: string
  quantity: number
  notes: string | null
  unitPrice: number
  estimatedLineTotal: number
}

interface Template {
  id: string
  name: string
  description: string | null
  itemCount: number
  estimatedTotal: number
  sourceOrderId: string | null
  createdAt: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function TemplatesPage() {
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null)
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)

  // Create modal state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formMode, setFormMode] = useState<'scratch' | 'fromOrder'>('scratch')
  const [formSourceOrderId, setFormSourceOrderId] = useState('')
  const [orders, setOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [loadingToCartId, setLoadingToCartId] = useState<string | null>(null)

  useEffect(() => {
    fetchTemplates()
  }, [])

  async function fetchTemplates() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch('/api/builder/templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      setTemplates(data.templates || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchTemplateItems(templateId: string) {
    try {
      setLoadingItems(true)
      const res = await fetch(`/api/builder/templates/${templateId}`)
      if (!res.ok) throw new Error('Failed to load template items')
      const data = await res.json()
      setTemplateItems(data.items || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingItems(false)
    }
  }

  async function fetchOrders() {
    if (orders.length > 0) return // Already loaded

    try {
      setLoadingOrders(true)
      const res = await fetch('/api/orders')
      if (!res.ok) throw new Error('Failed to load orders')
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingOrders(false)
    }
  }

  async function handleExpandTemplate(templateId: string) {
    if (expandedTemplateId === templateId) {
      setExpandedTemplateId(null)
    } else {
      setExpandedTemplateId(templateId)
      await fetchTemplateItems(templateId)
    }
  }

  async function handleLoadToCart(templateId: string) {
    try {
      setError('')
      setLoadingToCartId(templateId)
      const res = await fetch(`/api/builder/templates/${templateId}/add-to-cart`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to load template to cart')
      const data = await res.json()
      router.push('/dashboard/cart')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingToCartId(null)
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    if (!confirm('Are you sure you want to delete this template?')) return

    try {
      setError('')
      const res = await fetch(`/api/builder/templates/${templateId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete template')
      await fetchTemplates()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleCreateTemplate() {
    if (!formName.trim()) {
      setError('Template name is required')
      return
    }

    const body: any = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
    }

    if (formMode === 'fromOrder') {
      if (!formSourceOrderId) {
        setError('Please select an order')
        return
      }
      body.sourceOrderId = formSourceOrderId
    }

    try {
      setCreatingTemplate(true)
      setError('')
      const res = await fetch('/api/builder/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create template')
      }
      await fetchTemplates()
      setShowCreateModal(false)
      setFormName('')
      setFormDescription('')
      setFormMode('scratch')
      setFormSourceOrderId('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreatingTemplate(false)
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
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-fg">Order Templates</h1>
          <p className="text-fg-muted text-sm mt-1">Save and reuse your common orders</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-[#0f2a3e] hover:bg-[#0f2a3e]/90 text-white font-bold py-3 px-6 rounded-lg transition"
        >
          + Create Template
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-2xl font-bold text-fg mb-2">No Templates Yet</h2>
          <p className="text-fg-muted mb-6">
            Create templates from your orders to quickly reorder common products.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-block bg-[#C6A24E] hover:bg-[#C6A24E]/90 text-white font-bold py-3 px-6 rounded-lg transition"
          >
            Create Your First Template
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {templates.map(template => (
            <div key={template.id} className="bg-white rounded-xl border border-border overflow-hidden hover:shadow-lg transition">
              {/* Card Header */}
              <div className="p-5 border-b border-border">
                <h3 className="text-lg font-bold text-fg line-clamp-2">{template.name}</h3>
                {template.description && (
                  <p className="text-sm text-fg-muted mt-1 line-clamp-2">{template.description}</p>
                )}
              </div>

              {/* Card Content */}
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-fg-muted uppercase font-semibold">Items</p>
                    <p className="text-lg font-bold text-fg">{template.itemCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-muted uppercase font-semibold">Est. Total</p>
                    <p className="text-lg font-bold text-[#0f2a3e]">{fmt(template.estimatedTotal)}</p>
                  </div>
                </div>

                {template.sourceOrderId && (
                  <div className="bg-blue-50 rounded-lg p-2.5">
                    <p className="text-xs text-blue-700">
                      <span className="font-semibold">From Order</span>
                      <br />
                      {template.sourceOrderId}
                    </p>
                  </div>
                )}

                <p className="text-xs text-fg-subtle">
                  Created {formatDate(template.createdAt)}
                </p>
              </div>

              {/* Expanded Items View */}
              {expandedTemplateId === template.id && (
                <div className="border-t border-border bg-surface-muted p-4">
                  {loadingItems ? (
                    <div className="flex justify-center py-4">
                      <div className="w-5 h-5 border-2 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {templateItems.map(item => (
                        <div key={item.id} className="text-xs bg-white rounded p-2 border border-border">
                          <p className="font-semibold text-fg">{item.productName}</p>
                          <p className="text-fg-muted">SKU: {item.sku}</p>
                          <p className="text-fg-muted">
                            {item.quantity}x @ {fmt(item.unitPrice)} = {fmt(item.estimatedLineTotal)}
                          </p>
                          {item.notes && <p className="text-fg-muted italic">Note: {item.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Card Footer - Actions */}
              <div className="p-4 border-t border-border bg-surface-muted flex gap-2">
                <button
                  onClick={() => handleLoadToCart(template.id)}
                  disabled={loadingToCartId === template.id}
                  className="flex-1 bg-[#C6A24E] hover:bg-[#C6A24E]/90 disabled:bg-[#C6A24E]/50 text-white font-semibold text-sm py-2 rounded transition flex items-center justify-center gap-2"
                >
                  {loadingToCartId === template.id && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {loadingToCartId === template.id ? 'Loading...' : 'Load to Cart'}
                </button>
                <button
                  onClick={() => handleExpandTemplate(template.id)}
                  className="flex-1 bg-white hover:bg-surface-muted text-fg-muted font-semibold text-sm py-2 rounded border border-border-strong transition"
                >
                  {expandedTemplateId === template.id ? 'Hide' : 'View'} Items
                </button>
                <button
                  onClick={() => handleDeleteTemplate(template.id)}
                  className="px-3 bg-white hover:bg-red-50 text-red-600 font-semibold text-sm py-2 rounded border border-border-strong transition"
                  title="Delete template"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-border max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-fg mb-4">Create New Template</h3>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-2">
                Template Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g., Kitchen Remodel Standard, Deck Setup..."
                className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-2">
                Description (Optional)
              </label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="e.g., Our standard package for kitchen renovations..."
                className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]"
                rows={3}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-3">
                Create from:
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="scratch"
                    checked={formMode === 'scratch'}
                    onChange={e => {
                      setFormMode(e.target.value as 'scratch' | 'fromOrder')
                      setFormSourceOrderId('')
                    }}
                    className="rounded"
                  />
                  <span className="text-sm text-fg-muted">Start from scratch (add items later)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="fromOrder"
                    checked={formMode === 'fromOrder'}
                    onChange={e => {
                      setFormMode(e.target.value as 'scratch' | 'fromOrder')
                      fetchOrders()
                    }}
                    className="rounded"
                  />
                  <span className="text-sm text-fg-muted">Copy items from an existing order</span>
                </label>
              </div>
            </div>

            {formMode === 'fromOrder' && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-fg-muted mb-2">
                  Select Order <span className="text-red-600">*</span>
                </label>
                <select
                  value={formSourceOrderId}
                  onChange={e => setFormSourceOrderId(e.target.value)}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]"
                  disabled={loadingOrders}
                >
                  <option value="">
                    {loadingOrders ? 'Loading orders...' : 'Choose an order...'}
                  </option>
                  {orders.map(order => (
                    <option key={order.id} value={order.id}>
                      {order.orderNumber} - {fmt(Number(order.total))} ({order.itemCount} items)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setFormName('')
                  setFormDescription('')
                  setFormMode('scratch')
                  setFormSourceOrderId('')
                  setError('')
                }}
                disabled={creatingTemplate}
                className="flex-1 px-4 py-2 border border-border-strong rounded-lg text-fg-muted font-semibold hover:bg-surface-muted transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTemplate}
                disabled={creatingTemplate || !formName.trim()}
                className="flex-1 px-4 py-2 bg-[#0f2a3e] hover:bg-[#0f2a3e]/90 text-white font-semibold rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creatingTemplate && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {creatingTemplate ? 'Creating...' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
