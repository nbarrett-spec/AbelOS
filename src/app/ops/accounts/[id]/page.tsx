'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface BuilderDetail {
  id: string
  companyName: string
  contactName: string
  email: string
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  licenseNumber: string | null
  paymentTerm: string
  creditLimit: number | null
  accountBalance: number
  taxExempt: boolean
  status: string
  createdAt: string
  projects: Array<{
    id: string
    name: string
    status: string
    jobAddress: string | null
    createdAt: string
    _count: { quotes: number }
  }>
  _count: {
    projects: number
    orders: number
    customPricing: number
  }
}

interface Activity {
  id: string
  subject: string
  notes: string | null
  activityType: string
  outcome: string | null
  createdAt: string
  staff: {
    id: string
    firstName: string
    lastName: string
  }
}

interface BuilderPricing {
  id: string
  customPrice: number
  margin: number | null
  product: {
    id: string
    sku: string
    name: string
    category: string
    basePrice: number
    cost: number | null
  }
}

interface Product {
  id: string
  sku: string
  name: string
  category: string
  basePrice: number
  cost: number | null
}

const TERM_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order (3% discount)',
  PAY_ON_DELIVERY: 'Pay on Delivery (standard)',
  NET_15: 'Net 15 (1% premium)',
  NET_30: 'Net 30 (2.5% premium)',
}

const TIER_LABELS: Record<string, string> = {
  PREFERRED: 'Preferred Builder',
  STANDARD: 'Standard Builder',
  NEW_ACCOUNT: 'New Account',
  PREMIUM: 'Premium/Low Volume',
}

const ACTIVITY_ICONS: Record<string, string> = {
  CALL: '📞',
  EMAIL: '📧',
  MEETING: '🤝',
  SITE_VISIT: '🏠',
  TEXT_MESSAGE: '💬',
  NOTE: '📝',
  QUOTE_SENT: '📄',
  QUOTE_FOLLOW_UP: '📄',
  ISSUE_REPORTED: '⚠️',
  ISSUE_RESOLVED: '✅',
}

export default function AccountDetailPage() {
  const params = useParams()
  const [builder, setBuilder] = useState<BuilderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'activity' | 'pricing' | 'margins'>('overview')
  const [builderCashInsights, setBuilderCashInsights] = useState<any>(null)

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  // Activity modal
  const [activityModalOpen, setActivityModalOpen] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [activityForm, setActivityForm] = useState({ subject: '', notes: '', activityType: 'NOTE', outcome: '' })
  const [activitySubmitLoading, setActivitySubmitLoading] = useState(false)
  const [activityError, setActivityError] = useState('')

  // Pricing modal
  const [pricingModalOpen, setPricingModalOpen] = useState(false)
  const [pricing, setPricing] = useState<BuilderPricing[]>([])
  const [pricingLoading, setPricingLoading] = useState(false)
  const [addPricingOpen, setAddPricingOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [customPrice, setCustomPrice] = useState('')
  const [pricingError, setPricingError] = useState('')
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null)

  // Margins
  const [marginData, setMarginData] = useState<any>(null)
  const [marginLoading, setMarginLoading] = useState(false)
  const [marginEditing, setMarginEditing] = useState(false)
  const [marginSaving, setMarginSaving] = useState(false)
  const [editBlendedTarget, setEditBlendedTarget] = useState('')
  const [editCategoryTargets, setEditCategoryTargets] = useState<any[]>([])
  const [marginNotes, setMarginNotes] = useState('')

  const activityTabRef = useRef<HTMLButtonElement>(null)

  // Load builder
  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`/api/ops/builders/${params.id}`)
        const data = await resp.json()
        setBuilder(data.builder)
        setEditForm(data.builder)
      } catch (err) {
        console.error('Failed to load builder:', err)
      } finally {
        setLoading(false)
      }
    }
    if (params.id) load()
  }, [params.id])

  // Load AI cash flow insights for builder
  useEffect(() => {
    if (builder?.id) {
      fetch('/api/ops/cash-flow-optimizer/collections')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            const builderActions = (data.prioritizedActions || data.actions || []).filter((a: any) => a.builderId === builder.id)
            const creditLine = data.creditLines?.find((c: any) => c.builderId === builder.id)
            setBuilderCashInsights({
              outstandingActions: builderActions,
              creditLine,
              totalAR: data.summary?.totalAR || 0,
            })
          }
        })
        .catch(() => {})
    }
  }, [builder?.id])

  // Load activities when tab becomes active
  useEffect(() => {
    if (activeTab === 'activity' && activities.length === 0) {
      loadActivities()
    }
  }, [activeTab])

  // Load pricing when tab becomes active
  useEffect(() => {
    if (activeTab === 'pricing' && pricing.length === 0) {
      loadPricing()
    }
  }, [activeTab])

  // Load margins when tab becomes active
  useEffect(() => {
    if (activeTab === 'margins' && !marginData) {
      loadMargins()
    }
  }, [activeTab])

  async function loadActivities() {
    if (!params.id) return
    setActivitiesLoading(true)
    try {
      const resp = await fetch(`/api/ops/accounts/${params.id}/activities?limit=100`)
      const data = await resp.json()
      setActivities(data.activities || [])
    } catch (err) {
      console.error('Failed to load activities:', err)
    } finally {
      setActivitiesLoading(false)
    }
  }

  async function loadPricing() {
    if (!params.id) return
    setPricingLoading(true)
    try {
      const resp = await fetch(`/api/ops/accounts/${params.id}/pricing`)
      const data = await resp.json()
      setPricing(data.pricing || [])
    } catch (err) {
      console.error('Failed to load pricing:', err)
    } finally {
      setPricingLoading(false)
    }
  }

  async function loadMargins() {
    if (!params.id) return
    setMarginLoading(true)
    try {
      const resp = await fetch(`/api/ops/accounts/${params.id}/margins`)
      const data = await resp.json()
      setMarginData(data)
    } catch (err) {
      console.error('Failed to load margins:', err)
    } finally {
      setMarginLoading(false)
    }
  }

  function startMarginEdit() {
    if (!marginData) return
    setEditBlendedTarget(
      marginData.marginTarget
        ? (marginData.marginTarget.targetBlendedMargin * 100).toFixed(1)
        : '30.0'
    )
    setEditCategoryTargets(
      (marginData.categories || []).map((c: any) => ({
        category: c.category,
        categoryType: c.categoryType,
        targetMargin: (c.targetMargin * 100).toFixed(1),
        minMargin: (c.minMargin * 100).toFixed(1),
      }))
    )
    setMarginNotes(marginData.marginTarget?.notes || '')
    setMarginEditing(true)
  }

  async function saveMarginTargets() {
    if (!params.id) return
    setMarginSaving(true)
    try {
      const resp = await fetch(`/api/ops/accounts/${params.id}/margins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetBlendedMargin: parseFloat(editBlendedTarget) / 100,
          notes: marginNotes || null,
          categories: editCategoryTargets.map((c: any) => ({
            category: c.category,
            categoryType: c.categoryType,
            targetMargin: parseFloat(c.targetMargin) / 100,
            minMargin: parseFloat(c.minMargin) / 100,
          })),
        }),
      })
      if (resp.ok) {
        setMarginEditing(false)
        setMarginData(null) // force reload
        loadMargins()
      }
    } catch (err) {
      console.error('Failed to save margin targets:', err)
    } finally {
      setMarginSaving(false)
    }
  }

  async function handleEditSubmit() {
    if (!builder) return
    setEditLoading(true)
    setEditError('')
    try {
      const resp = await fetch(`/api/ops/builders/${builder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!resp.ok) {
        const err = await resp.json()
        setEditError(err.error || 'Failed to update')
        return
      }
      const data = await resp.json()
      setBuilder(data.builder)
      setEditModalOpen(false)
    } catch (err: any) {
      setEditError(err.message || 'Failed to update')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleSearchProducts(query: string) {
    setProductSearch(query)
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    try {
      const resp = await fetch(`/api/ops/products/search?search=${encodeURIComponent(query)}&limit=20`)
      const data = await resp.json()
      setSearchResults(data.products || [])
    } catch (err) {
      console.error('Failed to search products:', err)
    }
  }

  async function handleAddOrUpdatePricing() {
    if (!selectedProduct || !customPrice || !params.id) return

    setActivitySubmitLoading(true)
    setPricingError('')
    try {
      const method = editingPricingId ? 'PATCH' : 'POST'
      const body = editingPricingId
        ? { pricingId: editingPricingId, customPrice: parseFloat(customPrice) }
        : { productId: selectedProduct.id, customPrice: parseFloat(customPrice) }

      const resp = await fetch(`/api/ops/accounts/${params.id}/pricing`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json()
        setPricingError(err.error || 'Failed to save pricing')
        return
      }

      // Reload pricing
      await loadPricing()
      setAddPricingOpen(false)
      setSelectedProduct(null)
      setCustomPrice('')
      setEditingPricingId(null)
      setProductSearch('')
      setSearchResults([])
    } catch (err: any) {
      setPricingError(err.message || 'Failed to save pricing')
    } finally {
      setActivitySubmitLoading(false)
    }
  }

  async function handleLogActivity() {
    if (!activityForm.subject || !params.id) return

    setActivitySubmitLoading(true)
    setActivityError('')
    try {
      const resp = await fetch(`/api/ops/accounts/${params.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: activityForm.subject,
          notes: activityForm.notes || null,
          activityType: activityForm.activityType,
          outcome: activityForm.outcome || null,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        setActivityError(err.error || 'Failed to log activity')
        return
      }

      await loadActivities()
      setActivityModalOpen(false)
      setActivityForm({ subject: '', notes: '', activityType: 'NOTE', outcome: '' })
    } catch (err: any) {
      setActivityError(err.message || 'Failed to log activity')
    } finally {
      setActivitySubmitLoading(false)
    }
  }

  function handleEditPricing(bp: BuilderPricing) {
    setSelectedProduct(bp.product)
    setCustomPrice(bp.customPrice.toString())
    setEditingPricingId(bp.id)
    setAddPricingOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
      </div>
    )
  }

  if (!builder) {
    return <div className="text-center py-12 text-gray-400">Builder not found</div>
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/ops/accounts" className="hover:text-[#1B4F72]">
          Builder Accounts
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{builder.companyName}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-[#1B4F72] text-white flex items-center justify-center text-xl font-bold">
              {builder.companyName.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{builder.companyName}</h1>
              <p className="text-sm text-gray-500">
                {builder.contactName} · {builder.email}
              </p>
              {builder.phone && (
                <p className="text-sm text-gray-400">{builder.phone}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs px-3 py-1 rounded-full ${
                builder.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-700'
                  : builder.status === 'PENDING'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {builder.status}
            </span>
            <button onClick={() => setEditModalOpen(true)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              Edit Account
            </button>
            <button onClick={() => { setActivityModalOpen(true) }} className="px-3 py-1.5 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360]">
              Log Activity
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Projects" value={builder._count.projects} />
        <StatCard label="Orders" value={builder._count.orders} />
        <StatCard label="Custom SKUs" value={builder._count.customPricing} />
        <StatCard
          label="Payment Terms"
          value={builder.paymentTerm.replace('_', ' ')}
          isString
        />
        <StatCard
          label="Credit Limit"
          value={
            builder.creditLimit
              ? `$${builder.creditLimit.toLocaleString()}`
              : 'Not set'
          }
          isString
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'projects', label: `Projects (${builder._count.projects})` },
          { key: 'activity', label: 'Activity Log' },
          { key: 'pricing', label: `Custom Pricing (${builder._count.customPricing})` },
          { key: 'margins', label: 'Margin Targets' },
        ].map((tab) => (
          <button
            ref={tab.key === 'activity' ? activityTabRef : null}
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-2.5 text-sm transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'text-[#1B4F72] border-[#1B4F72] font-medium'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Account info */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Account Information</h3>
            <dl className="space-y-3">
              {[
                ['Company', builder.companyName],
                ['Contact', builder.contactName],
                ['Email', builder.email],
                ['Phone', builder.phone || '—'],
                ['Address', [builder.address, builder.city, builder.state, builder.zip].filter(Boolean).join(', ') || '—'],
                ['License #', builder.licenseNumber || '—'],
                ['Tax Exempt', builder.taxExempt ? 'Yes' : 'No'],
                ['Payment Terms', TERM_LABELS[builder.paymentTerm] || builder.paymentTerm],
                ['Pricing Tier', TIER_LABELS[(builder as any).pricingTier] || (builder as any).pricingTier || 'Standard'],
                ['Account Since', new Date(builder.createdAt).toLocaleDateString()],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between">
                  <dt className="text-sm text-gray-500">{label}</dt>
                  <dd className="text-sm text-gray-900 text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Recent projects */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Recent Projects</h3>
            {builder.projects.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No projects yet</p>
            ) : (
              <div className="space-y-3">
                {builder.projects.slice(0, 5).map((proj) => (
                  <Link
                    key={proj.id}
                    href={`/projects/${proj.id}`}
                    className="block border rounded-lg p-3 hover:bg-gray-50"
                  >
                    <div className="flex justify-between">
                      <p className="text-sm font-medium text-gray-900">{proj.name}</p>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {proj.status.replace('_', ' ')}
                      </span>
                    </div>
                    {proj.jobAddress && (
                      <p className="text-xs text-gray-400 mt-1">{proj.jobAddress}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {proj._count.quotes} quotes ·{' '}
                      {new Date(proj.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* AI Cash Flow Insights for this builder */}
          <div className="lg:col-span-2">
            <div className="bg-gradient-to-r from-[#1B4F72]/5 to-[#2E86C1]/5 border border-[#1B4F72]/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🧠</span>
                  <h3 className="font-semibold text-gray-900">AI Payment Intelligence</h3>
                </div>
                <Link
                  href="/ops/cash-flow-optimizer"
                  className="text-xs text-[#1B4F72] hover:underline"
                >
                  Cash Flow Command Center →
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-lg p-3 border">
                  <p className="text-xs text-gray-500">Payment Term</p>
                  <p className="text-sm font-bold text-gray-900">{TERM_LABELS[builder.paymentTerm] || builder.paymentTerm}</p>
                </div>
                <div className="bg-white rounded-lg p-3 border">
                  <p className="text-xs text-gray-500">Pricing Tier</p>
                  <p className="text-sm font-bold" style={{ color: (builder as any).pricingTier === 'PREFERRED' ? '#27ae60' : (builder as any).pricingTier === 'PREMIUM' ? '#e67e22' : '#1B4F72' }}>
                    {TIER_LABELS[(builder as any).pricingTier] || 'Standard'}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border">
                  <p className="text-xs text-gray-500">Credit Limit</p>
                  <p className="text-sm font-bold text-gray-900">
                    {builder.creditLimit ? `$${builder.creditLimit.toLocaleString()}` : 'Not set'}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border">
                  <p className="text-xs text-gray-500">Account Balance</p>
                  <p className={`text-sm font-bold ${builder.accountBalance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    ${builder.accountBalance.toLocaleString()}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border">
                  <p className="text-xs text-gray-500">Collection Actions</p>
                  <p className="text-sm font-bold text-gray-900">
                    {builderCashInsights?.outstandingActions?.length ?? 0} pending
                  </p>
                </div>
              </div>
              {builderCashInsights?.outstandingActions && builderCashInsights.outstandingActions.length > 0 && (
                <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-orange-700 mb-1">Collection Actions Required:</p>
                  {builderCashInsights.outstandingActions.slice(0, 2).map((action: any, i: number) => (
                    <p key={i} className="text-xs text-orange-600">
                      • {action.actionType}: ${(action.amountDue || 0).toLocaleString()} overdue {action.daysOverdue || 0} days — {action.channel || 'EMAIL'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="bg-white rounded-xl border">
          {builder.projects.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>No projects for this builder</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Project</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Address</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Quotes</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {builder.projects.map((proj) => (
                  <tr key={proj.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/projects/${proj.id}`} className="text-sm font-medium text-[#1B4F72] hover:text-[#E67E22]">
                        {proj.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{proj.jobAddress || '—'}</td>
                    <td className="px-4 py-3 text-center text-sm">{proj._count.quotes}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {proj.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(proj.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Activity Timeline</h3>
            <button
              onClick={() => setActivityModalOpen(true)}
              className="px-3 py-1.5 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360]"
            >
              New Activity
            </button>
          </div>

          {activitiesLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1B4F72]" />
            </div>
          ) : activities.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
              <p className="text-3xl mb-2">📝</p>
              <p className="font-medium">No activities yet</p>
              <p className="text-xs mt-2">Start tracking calls, emails, meetings, and notes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div key={activity.id} className="bg-white rounded-xl border p-4">
                  <div className="flex gap-4">
                    <div className="text-2xl">{ACTIVITY_ICONS[activity.activityType] || '📌'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">{activity.subject}</p>
                          <p className="text-sm text-gray-500">
                            {activity.staff.firstName} {activity.staff.lastName} · {new Date(activity.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded whitespace-nowrap">
                          {activity.activityType.replace('_', ' ')}
                        </span>
                      </div>
                      {activity.notes && (
                        <p className="text-sm text-gray-600 mt-2">{activity.notes}</p>
                      )}
                      {activity.outcome && (
                        <p className="text-xs text-gray-500 mt-2 italic">Outcome: {activity.outcome}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Custom Pricing</h3>
            <button
              onClick={() => {
                setAddPricingOpen(true)
                setEditingPricingId(null)
                setSelectedProduct(null)
                setCustomPrice('')
                setProductSearch('')
                setSearchResults([])
              }}
              className="px-3 py-1.5 text-sm bg-[#E67E22] text-white rounded-lg hover:bg-[#d35400]"
            >
              Add Custom Price
            </button>
          </div>

          {pricingLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1B4F72]" />
            </div>
          ) : pricing.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
              <p className="text-3xl mb-2">💲</p>
              <p className="font-medium">No custom pricing yet</p>
              <p className="text-xs mt-2">Set custom prices for specific products</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">SKU</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Base Price</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Custom Price</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Margin %</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pricing.map((bp) => {
                    const margin = bp.margin || 0
                    const marginColor = margin < 25 ? 'text-red-600' : 'text-green-600'
                    return (
                      <tr key={bp.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-mono text-gray-900">{bp.product.sku}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{bp.product.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{bp.product.category}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          ${bp.product.basePrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                          ${bp.customPrice.toFixed(2)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-center font-medium ${marginColor}`}>
                          {margin.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleEditPricing(bp)}
                            className="text-sm text-[#1B4F72] hover:text-[#E67E22] font-medium"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Account Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Edit Account</h2>
              <button onClick={() => setEditModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                  <input
                    type="text"
                    value={editForm.companyName || ''}
                    onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                  <input
                    type="text"
                    value={editForm.contactName || ''}
                    onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editForm.email || ''}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editForm.phone || ''}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={editForm.address || ''}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={editForm.city || ''}
                    onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input
                    type="text"
                    value={editForm.state || ''}
                    onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zip</label>
                  <input
                    type="text"
                    value={editForm.zip || ''}
                    onChange={(e) => setEditForm({ ...editForm, zip: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
                  <input
                    type="text"
                    value={editForm.licenseNumber || ''}
                    onChange={(e) => setEditForm({ ...editForm, licenseNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                  <select
                    value={editForm.paymentTerm || 'NET_15'}
                    onChange={(e) => setEditForm({ ...editForm, paymentTerm: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  >
                    <option value="PAY_AT_ORDER">Pay at Order</option>
                    <option value="PAY_ON_DELIVERY">Pay on Delivery</option>
                    <option value="NET_15">Net 15</option>
                    <option value="NET_30">Net 30</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pricing Tier</label>
                  <select
                    value={editForm.pricingTier || 'STANDARD'}
                    onChange={(e) => setEditForm({ ...editForm, pricingTier: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  >
                    <option value="PREFERRED">Preferred Builder (best pricing)</option>
                    <option value="STANDARD">Standard Builder</option>
                    <option value="NEW_ACCOUNT">New Account</option>
                    <option value="PREMIUM">Premium/Low Volume (highest margins)</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Controls catalog pricing for this builder</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit</label>
                  <input
                    type="number"
                    value={editForm.creditLimit || ''}
                    onChange={(e) => setEditForm({ ...editForm, creditLimit: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editForm.status || 'PENDING'}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                  >
                    <option value="PENDING">Pending</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="taxExempt"
                    checked={editForm.taxExempt || false}
                    onChange={(e) => setEditForm({ ...editForm, taxExempt: e.target.checked })}
                    className="w-4 h-4 border-gray-300 rounded"
                  />
                  <label htmlFor="taxExempt" className="text-sm font-medium text-gray-700">
                    Tax Exempt
                  </label>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t p-6 flex justify-end gap-3">
              <button
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSubmit}
                disabled={editLoading}
                className="px-4 py-2 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] disabled:opacity-50"
              >
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Activity Modal */}
      {activityModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-xl w-full">
            <div className="border-b p-6 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Log Activity</h2>
              <button onClick={() => setActivityModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {activityError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {activityError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Activity Type</label>
                <select
                  value={activityForm.activityType}
                  onChange={(e) => setActivityForm({ ...activityForm, activityType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                >
                  <option value="CALL">Call</option>
                  <option value="EMAIL">Email</option>
                  <option value="MEETING">Meeting</option>
                  <option value="SITE_VISIT">Site Visit</option>
                  <option value="TEXT_MESSAGE">Text Message</option>
                  <option value="NOTE">Note</option>
                  <option value="QUOTE_SENT">Quote Sent</option>
                  <option value="ISSUE_REPORTED">Issue Reported</option>
                  <option value="ISSUE_RESOLVED">Issue Resolved</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
                <input
                  type="text"
                  value={activityForm.subject}
                  onChange={(e) => setActivityForm({ ...activityForm, subject: e.target.value })}
                  placeholder="e.g., Follow-up on quote"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={activityForm.notes}
                  onChange={(e) => setActivityForm({ ...activityForm, notes: e.target.value })}
                  placeholder="Additional details..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Outcome</label>
                <input
                  type="text"
                  value={activityForm.outcome}
                  onChange={(e) => setActivityForm({ ...activityForm, outcome: e.target.value })}
                  placeholder="e.g., Agreed to NET_15"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                />
              </div>
            </div>

            <div className="bg-gray-50 border-t p-6 flex justify-end gap-3">
              <button
                onClick={() => setActivityModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleLogActivity}
                disabled={activitySubmitLoading || !activityForm.subject}
                className="px-4 py-2 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] disabled:opacity-50"
              >
                {activitySubmitLoading ? 'Saving...' : 'Log Activity'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Pricing Modal */}
      {addPricingOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-xl w-full">
            <div className="border-b p-6 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                {editingPricingId ? 'Edit Price' : 'Add Custom Price'}
              </h2>
              <button onClick={() => setAddPricingOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {pricingError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {pricingError}
                </div>
              )}

              {!editingPricingId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Product *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => handleSearchProducts(e.target.value)}
                      placeholder="Search by SKU or product name..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                    />
                    {searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-lg mt-1 shadow-lg z-10 max-h-48 overflow-y-auto">
                        {searchResults.map((prod) => (
                          <button
                            key={prod.id}
                            onClick={() => {
                              setSelectedProduct(prod)
                              setProductSearch('')
                              setSearchResults([])
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-100 border-b last:border-b-0"
                          >
                            <div className="font-medium text-gray-900">{prod.sku} - {prod.name}</div>
                            <div className="text-xs text-gray-500">{prod.category} · Base: ${prod.basePrice.toFixed(2)}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedProduct && (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm font-medium text-blue-900">{selectedProduct.sku} - {selectedProduct.name}</p>
                      <p className="text-xs text-blue-700">Base: ${selectedProduct.basePrice.toFixed(2)} · Cost: ${(selectedProduct.cost || 0).toFixed(2)}</p>
                    </div>
                  )}
                </div>
              )}

              {selectedProduct && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Custom Price *</label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
                    />
                  </div>
                  {customPrice && selectedProduct && (
                    <div className="mt-2 text-sm text-gray-600">
                      <p>
                        Base Price: ${selectedProduct.basePrice.toFixed(2)} ·
                        Cost: ${(selectedProduct.cost || 0).toFixed(2)} ·
                        Your Price: ${parseFloat(customPrice).toFixed(2)}
                      </p>
                      <p className="mt-1">
                        {customPrice && parseFloat(customPrice) > 0 ? (
                          <>
                            Margin: <span className={parseFloat(customPrice) > 0 && ((parseFloat(customPrice) - (selectedProduct.cost || 0)) / parseFloat(customPrice) * 100) < 25 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                              {((parseFloat(customPrice) - (selectedProduct.cost || 0)) / parseFloat(customPrice) * 100).toFixed(1)}%
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-gray-50 border-t p-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setAddPricingOpen(false)
                  setSelectedProduct(null)
                  setCustomPrice('')
                  setEditingPricingId(null)
                  setProductSearch('')
                  setSearchResults([])
                }}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddOrUpdatePricing}
                disabled={activitySubmitLoading || !selectedProduct || !customPrice}
                className="px-4 py-2 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] disabled:opacity-50"
              >
                {activitySubmitLoading ? 'Saving...' : editingPricingId ? 'Update Price' : 'Add Price'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== MARGINS TAB ========== */}
      {activeTab === 'margins' && (
        <div className="space-y-6">
          {marginLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
            </div>
          ) : marginData ? (
            <>
              {/* Blended Margin Overview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500 uppercase font-medium">Target Blended Margin</p>
                    {!marginEditing && (
                      <button onClick={startMarginEdit} className="text-xs text-[#1B4F72] hover:text-[#E67E22] font-medium">
                        Edit Targets
                      </button>
                    )}
                  </div>
                  {marginEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.1"
                        value={editBlendedTarget}
                        onChange={(e) => setEditBlendedTarget(e.target.value)}
                        className="w-24 px-2 py-1.5 border rounded text-lg font-bold text-[#1B4F72] focus:ring-2 focus:ring-[#1B4F72]/20"
                      />
                      <span className="text-lg font-bold text-gray-500">%</span>
                    </div>
                  ) : (
                    <p className="text-3xl font-bold text-[#1B4F72]">
                      {marginData.marginTarget
                        ? `${(marginData.marginTarget.targetBlendedMargin * 100).toFixed(1)}%`
                        : '30.0%'}
                    </p>
                  )}
                  {marginData.marginTarget?.notes && !marginEditing && (
                    <p className="text-xs text-gray-400 mt-2">{marginData.marginTarget.notes}</p>
                  )}
                </div>

                <div className="bg-white rounded-xl border p-5">
                  <p className="text-xs text-gray-500 uppercase font-medium mb-2">Actual Blended Margin</p>
                  <p className={`text-3xl font-bold ${
                    marginData.blendedActual.blendedMarginPct >=
                    (marginData.marginTarget?.targetBlendedMargin || 0.30) * 100
                      ? 'text-green-600'
                      : marginData.blendedActual.blendedMarginPct > 0
                        ? 'text-red-600'
                        : 'text-gray-400'
                  }`}>
                    {marginData.blendedActual.blendedMarginPct > 0
                      ? `${marginData.blendedActual.blendedMarginPct}%`
                      : 'No data'}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    {marginData.blendedActual.orderCount} orders &middot; ${marginData.blendedActual.totalRevenue.toLocaleString()} revenue
                  </p>
                </div>

                <div className="bg-white rounded-xl border p-5">
                  <p className="text-xs text-gray-500 uppercase font-medium mb-2">Margin Gap</p>
                  {marginData.blendedActual.blendedMarginPct > 0 ? (
                    <>
                      {(() => {
                        const target = (marginData.marginTarget?.targetBlendedMargin || 0.30) * 100
                        const actual = marginData.blendedActual.blendedMarginPct
                        const gap = actual - target
                        return (
                          <>
                            <p className={`text-3xl font-bold ${gap >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                              {gap >= 0 ? 'Above target' : 'Below target'}
                            </p>
                          </>
                        )
                      })()}
                    </>
                  ) : (
                    <p className="text-3xl font-bold text-gray-400">—</p>
                  )}
                </div>
              </div>

              {/* Edit mode notes */}
              {marginEditing && (
                <div className="bg-white rounded-xl border p-4">
                  <label className="block text-xs text-gray-500 uppercase font-medium mb-2">Margin Notes</label>
                  <textarea
                    value={marginNotes}
                    onChange={(e) => setMarginNotes(e.target.value)}
                    placeholder="e.g. Negotiated rates based on volume commitment..."
                    rows={2}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#1B4F72]/20"
                  />
                </div>
              )}

              {/* Category Breakdown Table */}
              <div className="bg-white rounded-xl border overflow-hidden">
                <div className="px-5 py-4 border-b flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Category Margin Breakdown</h3>
                  <span className="text-xs text-gray-400">{marginData.customPricingCount} custom prices set</span>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Target %</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Min %</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actual %</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Revenue</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(marginEditing ? editCategoryTargets : marginData.categories || []).map((cat: any, idx: number) => {
                      const actualCat = marginData.categories?.find((c: any) => c.category === cat.category)
                      const status = actualCat?.status || 'NO_DATA'
                      return (
                        <tr key={cat.category} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">{cat.category}</span>
                              {(actualCat?.isCustom || cat.isCustom) && (
                                <span className="text-[10px] bg-[#E67E22]/10 text-[#E67E22] px-1.5 py-0.5 rounded font-medium">Custom</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              cat.categoryType === 'CORE'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-purple-50 text-purple-700'
                            }`}>
                              {cat.categoryType === 'CORE' ? 'Core' : 'Add-On'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {marginEditing ? (
                              <input
                                type="number"
                                step="0.5"
                                value={editCategoryTargets[idx]?.targetMargin || ''}
                                onChange={(e) => {
                                  const updated = [...editCategoryTargets]
                                  updated[idx] = { ...updated[idx], targetMargin: e.target.value }
                                  setEditCategoryTargets(updated)
                                }}
                                className="w-16 px-1.5 py-1 border rounded text-sm text-center focus:ring-2 focus:ring-[#1B4F72]/20"
                              />
                            ) : (
                              <span className="text-sm text-gray-900">{(cat.targetMargin * 100).toFixed(1)}%</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {marginEditing ? (
                              <input
                                type="number"
                                step="0.5"
                                value={editCategoryTargets[idx]?.minMargin || ''}
                                onChange={(e) => {
                                  const updated = [...editCategoryTargets]
                                  updated[idx] = { ...updated[idx], minMargin: e.target.value }
                                  setEditCategoryTargets(updated)
                                }}
                                className="w-16 px-1.5 py-1 border rounded text-sm text-center focus:ring-2 focus:ring-[#1B4F72]/20"
                              />
                            ) : (
                              <span className="text-sm text-gray-500">{(cat.minMargin * 100).toFixed(1)}%</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {actualCat?.actualMarginPct != null ? (
                              <span className={`text-sm font-medium ${
                                status === 'ON_TARGET' ? 'text-green-600' :
                                status === 'BELOW_TARGET' ? 'text-yellow-600' :
                                status === 'CRITICAL' ? 'text-red-600' : 'text-gray-400'
                              }`}>
                                {actualCat.actualMarginPct}%
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {actualCat?.revenue > 0 ? (
                              <span className="text-sm text-gray-700">${actualCat.revenue.toLocaleString()}</span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {status === 'ON_TARGET' && <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="On Target" />}
                            {status === 'BELOW_TARGET' && <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" title="Below Target" />}
                            {status === 'CRITICAL' && <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="Critical" />}
                            {status === 'NO_DATA' && <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" title="No Data" />}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Edit action buttons */}
              {marginEditing && (
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setMarginEditing(false)}
                    className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveMarginTargets}
                    disabled={marginSaving}
                    className="px-4 py-2 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] disabled:opacity-50"
                  >
                    {marginSaving ? 'Saving...' : 'Save Margin Targets'}
                  </button>
                </div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-6 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                  On Target
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  Below Target
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                  Critical (below min)
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" />
                  No Order Data
                </div>
              </div>
            </>
          ) : (
            <div className="text-center text-gray-400 text-sm py-12">
              Failed to load margin data
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, isString }: { label: string; value: number | string; isString?: boolean }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">
        {isString ? value : typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}
