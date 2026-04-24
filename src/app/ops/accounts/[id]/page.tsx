'use client'

/**
 * Builder Account Detail — /ops/accounts/[id]
 *
 * Aegis v2 "Drafting Room" design system. Renders:
 *   ▸ PageHeader with crumbs, title (company), pricing-tier badge, AR status chip
 *   ▸ 4 KPI tiles  (YTD revenue + sparkline, AR + overdue flag, Open deals, Next delivery)
 *   ▸ Account health radial (inline SVG)
 *   ▸ 12-month revenue sparkline
 *   ▸ AIInsight (/api/ops/ai/builder-snapshot)
 *   ▸ Activity timeline (merged orders + payments + POs + comms, date desc)
 *   ▸ Recent orders DataTable
 *   ▸ Open deals panel
 *   ▸ AR aging mini-waterfall
 *   ▸ Communities + Contacts rails (PRODUCTION builders)
 *   ▸ PresenceAvatars
 *   ▸ Actions (Log visit / Send statement / Create quote / Credit hold [ADMIN])
 *
 * Preserves every existing API call from the legacy page (no data-contract changes).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  Briefcase,
  Building2,
  CalendarClock,
  Check,
  DollarSign,
  FileText,
  MessageSquare,
  Package,
  PackageCheck,
  Phone,
  Plus,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react'
import {
  PageHeader,
  KPICard,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  DataTable,
  Badge,
  EmptyState,
  Dialog,
  Tabs,
  Sparkline,
  AIInsight,
  PresenceAvatars,
  StatusBadge,
  type DataTableColumn,
  type BadgeVariant,
  type Tab,
} from '@/components/ui'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

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
  builderType: string | null
  territory: string | null
  annualVolume: number | null
  website: string | null
  paymentTerm: string
  creditLimit: number | null
  accountBalance: number
  taxExempt: boolean
  status: string
  createdAt: string
  pricingTier?: string | null
  projects: Array<{
    id: string
    name: string
    status: string
    jobAddress?: string | null
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

interface OrderRow {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
  expectedDelivery?: string | null
}

interface CommLog {
  id: string
  channel: string
  subject: string
  body: string | null
  direction: string
  sentAt?: string | null
  createdAt: string
  hasAttachments?: boolean
}

// ── Labels ───────────────────────────────────────────────────────────────

const TERM_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order (3% discount)',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
}

const TIER_LABELS: Record<string, string> = {
  PREFERRED: 'Preferred',
  STANDARD: 'Standard',
  NEW_ACCOUNT: 'New Account',
  PREMIUM: 'Premium',
}

const TIER_VARIANT: Record<string, BadgeVariant> = {
  PREFERRED: 'success',
  STANDARD: 'brand',
  NEW_ACCOUNT: 'info',
  PREMIUM: 'warning',
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)

const fmtMoneyCompact = (n: number) => {
  const v = Number(n || 0)
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 10_000) return `$${Math.round(v / 1_000)}K`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${Math.round(v)}`
}

const fmtDate = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—'

const fmtDateShort = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '—'

// ── Health radial ────────────────────────────────────────────────────────

function HealthRadial({ score }: { score: number }) {
  const R = 34
  const C = 2 * Math.PI * R
  const clamped = Math.max(0, Math.min(100, score))
  const dash = (clamped / 100) * C
  const tone =
    clamped >= 80
      ? 'var(--data-positive)'
      : clamped >= 60
        ? 'var(--signal, var(--gold))'
        : clamped >= 40
          ? 'var(--accent)'
          : 'var(--data-negative)'
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={84} height={84} viewBox="0 0 84 84" className="-rotate-90">
        <circle cx={42} cy={42} r={R} fill="none" stroke="var(--border)" strokeWidth={6} />
        <circle
          cx={42}
          cy={42}
          r={R}
          fill="none"
          stroke={tone}
          strokeWidth={6}
          strokeDasharray={`${dash} ${C - dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 420ms var(--ease)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="metric font-numeric text-[22px] leading-none">{Math.round(clamped)}</span>
        <span className="text-[9px] text-fg-subtle uppercase tracking-wider mt-0.5">Health</span>
      </div>
    </div>
  )
}

// ── AR aging waterfall ───────────────────────────────────────────────────

interface AgingBucket {
  label: string
  amount: number
  tone: 'neutral' | 'warning' | 'danger'
}

function ARWaterfall({ buckets }: { buckets: AgingBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.amount))
  return (
    <div className="flex items-end gap-3 h-24 px-1 pt-2">
      {buckets.map((b) => {
        const pct = max > 0 ? (b.amount / max) * 100 : 0
        const bar =
          b.tone === 'danger'
            ? 'bg-data-negative'
            : b.tone === 'warning'
              ? 'bg-accent'
              : 'bg-brand-subtle'
        return (
          <div key={b.label} className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
            <span className="text-[10px] font-numeric text-fg-muted tabular-nums truncate">
              {fmtMoneyCompact(b.amount)}
            </span>
            <div className="relative w-full h-16 flex items-end">
              <div
                className={cn('w-full rounded-t-sm transition-all duration-500 ease-out', bar)}
                style={{ height: `${Math.max(2, pct)}%` }}
              />
            </div>
            <span className="text-[10px] text-fg-subtle uppercase tracking-wider">{b.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Activity event type (merged feed) ────────────────────────────────────

type MergedEvent = {
  id: string
  kind: 'order' | 'payment' | 'po' | 'comm' | 'activity'
  label: string
  detail?: string
  at: string
  amount?: number | null
  status?: string | null
  href?: string
}

function eventIcon(kind: MergedEvent['kind']): ReactNode {
  switch (kind) {
    case 'order':
      return <Package className="w-4 h-4 text-brand" />
    case 'payment':
      return <Banknote className="w-4 h-4 text-data-positive" />
    case 'po':
      return <PackageCheck className="w-4 h-4 text-accent" />
    case 'comm':
      return <MessageSquare className="w-4 h-4 text-forecast" />
    case 'activity':
    default:
      return <FileText className="w-4 h-4 text-fg-muted" />
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function AccountDetailPage() {
  const params = useParams() as { id?: string }
  const builderId = params?.id ?? ''
  const { isAdmin } = useStaffAuth({ redirectOnFail: false })

  // ── Core state ─────────────────────────────────────────────────────────
  const [builder, setBuilder] = useState<BuilderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('overview')

  // Cash-flow / AI insight roll-up
  const [cashInsights, setCashInsights] = useState<{
    outstandingActions: any[]
    creditLine: any
    totalAR: number
  } | null>(null)

  // Activity / comms / pricing / margins / communities / contacts
  const [activities, setActivities] = useState<Activity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [commLogs, setCommLogs] = useState<CommLog[]>([])
  const [commsLoading, setCommsLoading] = useState(false)
  const [communities, setCommunities] = useState<any[]>([])
  const [communitiesLoading, setCommunitiesLoading] = useState(false)
  const [builderContacts, setBuilderContacts] = useState<any[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [pricing, setPricing] = useState<BuilderPricing[]>([])
  const [pricingLoading, setPricingLoading] = useState(false)
  const [marginData, setMarginData] = useState<any>(null)
  const [marginLoading, setMarginLoading] = useState(false)

  // Recent orders for timeline + table
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([])
  const [recentOrdersLoading, setRecentOrdersLoading] = useState(false)

  // ── Modal state ────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const [activityOpen, setActivityOpen] = useState(false)
  const [activityForm, setActivityForm] = useState({
    subject: '',
    notes: '',
    activityType: 'NOTE',
    outcome: '',
  })
  const [activitySaving, setActivitySaving] = useState(false)
  const [activityError, setActivityError] = useState('')

  const [commOpen, setCommOpen] = useState(false)
  const [commForm, setCommForm] = useState({
    channel: 'EMAIL',
    subject: '',
    body: '',
    direction: 'OUTBOUND',
  })
  const [commSaving, setCommSaving] = useState(false)

  const [pricingOpen, setPricingOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [customPrice, setCustomPrice] = useState('')
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null)
  const [pricingError, setPricingError] = useState('')
  const [pricingSaving, setPricingSaving] = useState(false)

  const [creditHoldOpen, setCreditHoldOpen] = useState(false)
  const [creditHoldSaving, setCreditHoldSaving] = useState(false)

  // Margin edit state
  const [marginEditing, setMarginEditing] = useState(false)
  const [marginSaving, setMarginSaving] = useState(false)
  const [editBlendedTarget, setEditBlendedTarget] = useState('')
  const [editCategoryTargets, setEditCategoryTargets] = useState<any[]>([])
  const [marginNotes, setMarginNotes] = useState('')

  // ── Derived flags ──────────────────────────────────────────────────────
  const isProduction = (builder?.builderType ?? '') === 'PRODUCTION'
  const pricingTier = (builder?.pricingTier as string | undefined) ?? 'STANDARD'
  const arBalance = builder?.accountBalance ?? 0
  const isOverdue = arBalance > 0 // legacy semantics: positive = amount owed
  const isOverCredit =
    builder?.creditLimit != null && arBalance > builder.creditLimit

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadBuilder = useCallback(async () => {
    if (!builderId) return
    try {
      setError(null)
      const res = await fetch(`/api/ops/builders/${builderId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setBuilder(data.builder)
      setEditForm(data.builder)
    } catch (e: any) {
      setError(e?.message || 'Failed to load builder')
    } finally {
      setLoading(false)
    }
  }, [builderId])

  useEffect(() => {
    loadBuilder()
  }, [loadBuilder])

  // Cash-flow insights (AR, collection actions) — identical endpoint to legacy
  useEffect(() => {
    if (!builder?.id) return
    fetch('/api/ops/cash-flow-optimizer/collections')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        const actions = (data.prioritizedActions || data.actions || []).filter(
          (a: any) => a.builderId === builder.id,
        )
        const creditLine = data.creditLines?.find((c: any) => c.builderId === builder.id)
        setCashInsights({
          outstandingActions: actions,
          creditLine,
          totalAR: data.summary?.totalAR || 0,
        })
      })
      .catch(() => {})
  }, [builder?.id])

  const loadActivities = useCallback(async () => {
    if (!builderId) return
    setActivitiesLoading(true)
    try {
      const res = await fetch(`/api/ops/accounts/${builderId}/activities?limit=100`)
      const data = await res.json()
      setActivities(data.activities || [])
    } catch (e) {
      // non-fatal
    } finally {
      setActivitiesLoading(false)
    }
  }, [builderId])

  const loadCommLogs = useCallback(async () => {
    if (!builderId) return
    setCommsLoading(true)
    try {
      const res = await fetch(`/api/ops/communication-logs?builderId=${builderId}&limit=50`)
      const data = await res.json()
      setCommLogs(data.logs || [])
    } catch {
      // non-fatal
    } finally {
      setCommsLoading(false)
    }
  }, [builderId])

  const loadCommunities = useCallback(async () => {
    if (!builderId) return
    setCommunitiesLoading(true)
    try {
      const res = await fetch(`/api/ops/communities?builderId=${builderId}`)
      const data = await res.json()
      setCommunities(data.communities || [])
    } catch {
      // non-fatal
    } finally {
      setCommunitiesLoading(false)
    }
  }, [builderId])

  const loadContacts = useCallback(async () => {
    if (!builderId) return
    setContactsLoading(true)
    try {
      const res = await fetch(`/api/ops/contacts?builderId=${builderId}`)
      const data = await res.json()
      setBuilderContacts(data.contacts || [])
    } catch {
      // non-fatal
    } finally {
      setContactsLoading(false)
    }
  }, [builderId])

  const loadPricing = useCallback(async () => {
    if (!builderId) return
    setPricingLoading(true)
    try {
      const res = await fetch(`/api/ops/accounts/${builderId}/pricing`)
      const data = await res.json()
      setPricing(data.pricing || [])
    } catch {
      // non-fatal
    } finally {
      setPricingLoading(false)
    }
  }, [builderId])

  const loadMargins = useCallback(async () => {
    if (!builderId) return
    setMarginLoading(true)
    try {
      const res = await fetch(`/api/ops/accounts/${builderId}/margins`)
      const data = await res.json()
      setMarginData(data)
    } catch {
      // non-fatal
    } finally {
      setMarginLoading(false)
    }
  }, [builderId])

  // Recent orders: reuse existing /api/ops/orders?builderId= endpoint if it
  // exists, otherwise fall back to what legacy rendered (project.projects).
  // Legacy did not explicitly fetch orders, so we defensively try /api/ops/orders.
  useEffect(() => {
    if (!builder?.id) return
    let cancelled = false
    ;(async () => {
      setRecentOrdersLoading(true)
      try {
        const res = await fetch(
          `/api/ops/orders?builderId=${builder.id}&limit=10&sortBy=createdAt&sortDir=desc`,
        )
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const rows: OrderRow[] = (data.orders || []).map((o: any) => ({
          id: o.id,
          orderNumber: o.orderNumber || o.poNumber || o.id.slice(0, 8),
          status: o.status || 'UNKNOWN',
          total: Number(o.total || o.subtotal || 0),
          createdAt: o.createdAt,
          expectedDelivery: o.expectedDelivery ?? o.requestedDeliveryDate ?? null,
        }))
        setRecentOrders(rows)
      } catch {
        // endpoint might not exist — keep empty
      } finally {
        if (!cancelled) setRecentOrdersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [builder?.id])

  // Eager-load summary data when builder resolved so KPIs populate without
  // waiting for the user to click each tab.
  useEffect(() => {
    if (!builder?.id) return
    loadActivities()
    loadCommLogs()
    if (isProduction) loadCommunities()
  }, [builder?.id, isProduction, loadActivities, loadCommLogs, loadCommunities])

  // Tab-gated loaders (replicates legacy lazy pattern for heavier ones)
  useEffect(() => {
    if (activeTab === 'pricing' && pricing.length === 0 && !pricingLoading) loadPricing()
  }, [activeTab, pricing.length, pricingLoading, loadPricing])

  useEffect(() => {
    if (activeTab === 'margins' && !marginData && !marginLoading) loadMargins()
  }, [activeTab, marginData, marginLoading, loadMargins])

  useEffect(() => {
    if (activeTab === 'contacts' && builderContacts.length === 0 && !contactsLoading) loadContacts()
  }, [activeTab, builderContacts.length, contactsLoading, loadContacts])

  // ── Derived KPIs & charts ──────────────────────────────────────────────

  // YTD revenue from recentOrders (best-effort; fallback 0 if empty)
  const { ytdRevenue, monthlyRevenue } = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    let ytd = 0
    const buckets: number[] = Array(12).fill(0)
    for (const o of recentOrders) {
      const d = new Date(o.createdAt)
      if (d.getFullYear() === year) ytd += Number(o.total || 0)
      // trailing 12 months bucket
      const diff =
        (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
      if (diff >= 0 && diff < 12) {
        const idx = 11 - diff
        buckets[idx] += Number(o.total || 0)
      }
    }
    return { ytdRevenue: ytd, monthlyRevenue: buckets }
  }, [recentOrders])

  const openDealsCount = useMemo(
    () => recentOrders.filter((o) => !['DELIVERED', 'COMPLETE', 'CANCELLED', 'PAID'].includes(o.status))
      .length,
    [recentOrders],
  )

  const nextDelivery = useMemo(() => {
    const upcoming = recentOrders
      .filter((o) => o.expectedDelivery)
      .map((o) => ({ ...o, _ts: new Date(o.expectedDelivery as string).getTime() }))
      .filter((o) => o._ts >= Date.now())
      .sort((a, b) => a._ts - b._ts)
    return upcoming[0] ?? null
  }, [recentOrders])

  // Health score: blend of payment-term quality, AR pressure, order velocity
  const healthScore = useMemo(() => {
    if (!builder) return 0
    let score = 70
    if (builder.paymentTerm === 'PAY_AT_ORDER' || builder.paymentTerm === 'PAY_ON_DELIVERY') {
      score += 10
    }
    if (isOverdue) score -= 15
    if (isOverCredit) score -= 20
    if (cashInsights?.outstandingActions?.length) score -= Math.min(15, cashInsights.outstandingActions.length * 5)
    if (recentOrders.length >= 5) score += 10
    return Math.max(0, Math.min(100, score))
  }, [builder, isOverdue, isOverCredit, cashInsights, recentOrders.length])

  // AR aging buckets — best-effort from cashInsights creditLine, else pad zeros
  const agingBuckets: AgingBucket[] = useMemo(() => {
    const cl = cashInsights?.creditLine
    if (cl && (cl.current != null || cl.past30 != null)) {
      return [
        { label: 'Current', amount: Number(cl.current || 0), tone: 'neutral' },
        { label: '1-30', amount: Number(cl.past30 || 0), tone: 'warning' },
        { label: '31-60', amount: Number(cl.past60 || 0), tone: 'warning' },
        { label: '61-90', amount: Number(cl.past90 || 0), tone: 'danger' },
        { label: '90+', amount: Number(cl.past90Plus || 0), tone: 'danger' },
      ]
    }
    return [
      { label: 'Current', amount: Math.max(0, arBalance), tone: 'neutral' },
      { label: '1-30', amount: 0, tone: 'warning' },
      { label: '31-60', amount: 0, tone: 'warning' },
      { label: '61-90', amount: 0, tone: 'danger' },
      { label: '90+', amount: 0, tone: 'danger' },
    ]
  }, [cashInsights, arBalance])

  // Merged timeline
  const mergedEvents: MergedEvent[] = useMemo(() => {
    const events: MergedEvent[] = []
    for (const o of recentOrders) {
      events.push({
        id: `order-${o.id}`,
        kind: 'order',
        label: `Order ${o.orderNumber}`,
        detail: `${fmtMoneyCompact(o.total)} · ${o.status.replace(/_/g, ' ')}`,
        at: o.createdAt,
        amount: o.total,
        status: o.status,
        href: `/ops/orders/${o.id}`,
      })
    }
    for (const c of commLogs) {
      events.push({
        id: `comm-${c.id}`,
        kind: 'comm',
        label: c.subject || c.channel,
        detail: `${c.channel} · ${c.direction === 'INBOUND' ? '← Inbound' : '→ Outbound'}`,
        at: c.sentAt || c.createdAt,
      })
    }
    for (const a of activities) {
      events.push({
        id: `activity-${a.id}`,
        kind: 'activity',
        label: a.subject,
        detail: `${a.activityType.replace(/_/g, ' ')}${a.staff ? ` · ${a.staff.firstName} ${a.staff.lastName}` : ''}`,
        at: a.createdAt,
      })
    }
    return events
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 30)
  }, [recentOrders, commLogs, activities])

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleEditSave = async () => {
    if (!builder) return
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/ops/builders/${builder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Update failed')
      setBuilder(data.builder)
      setEditOpen(false)
    } catch (e: any) {
      setEditError(e?.message || 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  const handleLogActivity = async () => {
    if (!builderId || !activityForm.subject) return
    setActivitySaving(true)
    setActivityError('')
    try {
      const res = await fetch(`/api/ops/accounts/${builderId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: activityForm.subject,
          notes: activityForm.notes || null,
          activityType: activityForm.activityType,
          outcome: activityForm.outcome || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to log activity')
      await loadActivities()
      setActivityOpen(false)
      setActivityForm({ subject: '', notes: '', activityType: 'NOTE', outcome: '' })
    } catch (e: any) {
      setActivityError(e?.message || 'Failed to log activity')
    } finally {
      setActivitySaving(false)
    }
  }

  const handleLogComm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!builderId || !commForm.subject) return
    setCommSaving(true)
    try {
      const res = await fetch('/api/ops/communication-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderId,
          channel: commForm.channel,
          subject: commForm.subject,
          body: commForm.body,
          direction: commForm.direction,
          status: 'SENT',
        }),
      })
      if (res.ok) {
        setCommOpen(false)
        setCommForm({ channel: 'EMAIL', subject: '', body: '', direction: 'OUTBOUND' })
        loadCommLogs()
      }
    } catch {
      // non-fatal
    } finally {
      setCommSaving(false)
    }
  }

  const handleProductSearch = async (query: string) => {
    setProductSearch(query)
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    try {
      const res = await fetch(`/api/ops/products/search?search=${encodeURIComponent(query)}&limit=20`)
      const data = await res.json()
      setSearchResults(data.products || [])
    } catch {
      // non-fatal
    }
  }

  const handlePricingSave = async () => {
    if (!selectedProduct || !customPrice || !builderId) return
    setPricingSaving(true)
    setPricingError('')
    try {
      const method = editingPricingId ? 'PATCH' : 'POST'
      const body = editingPricingId
        ? { pricingId: editingPricingId, customPrice: parseFloat(customPrice) }
        : { productId: selectedProduct.id, customPrice: parseFloat(customPrice) }
      const res = await fetch(`/api/ops/accounts/${builderId}/pricing`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to save pricing')
      await loadPricing()
      setPricingOpen(false)
      setSelectedProduct(null)
      setCustomPrice('')
      setEditingPricingId(null)
      setProductSearch('')
      setSearchResults([])
    } catch (e: any) {
      setPricingError(e?.message || 'Failed to save pricing')
    } finally {
      setPricingSaving(false)
    }
  }

  const handleEditPricing = (bp: BuilderPricing) => {
    setSelectedProduct(bp.product)
    setCustomPrice(bp.customPrice.toString())
    setEditingPricingId(bp.id)
    setPricingOpen(true)
  }

  const startMarginEdit = () => {
    if (!marginData) return
    setEditBlendedTarget(
      marginData.marginTarget
        ? (marginData.marginTarget.targetBlendedMargin * 100).toFixed(1)
        : '30.0',
    )
    setEditCategoryTargets(
      (marginData.categories || []).map((c: any) => ({
        category: c.category,
        categoryType: c.categoryType,
        targetMargin: (c.targetMargin * 100).toFixed(1),
        minMargin: (c.minMargin * 100).toFixed(1),
      })),
    )
    setMarginNotes(marginData.marginTarget?.notes || '')
    setMarginEditing(true)
  }

  const saveMarginTargets = async () => {
    if (!builderId) return
    setMarginSaving(true)
    try {
      const res = await fetch(`/api/ops/accounts/${builderId}/margins`, {
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
      if (res.ok) {
        setMarginEditing(false)
        setMarginData(null)
        loadMargins()
      }
    } finally {
      setMarginSaving(false)
    }
  }

  const handleSendStatement = async () => {
    if (!builderId) return
    try {
      await fetch(`/api/ops/accounts/${builderId}/statement/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      // non-fatal — action fires and forgets; existing endpoint unchanged.
    }
  }

  const handleCreditHold = async () => {
    if (!builder) return
    setCreditHoldSaving(true)
    try {
      const res = await fetch(`/api/ops/builders/${builder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SUSPENDED' }),
      })
      if (res.ok) {
        const data = await res.json()
        setBuilder(data.builder)
        setCreditHoldOpen(false)
      }
    } finally {
      setCreditHoldSaving(false)
    }
  }

  // ── Render gates ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-64 skeleton" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 skeleton rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !builder) {
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <EmptyState
              icon="search"
              title={error ? 'Failed to load builder' : 'Builder not found'}
              description={error ?? 'The account you requested does not exist or you may not have access.'}
              action={{ label: 'Back to accounts', href: '/ops/accounts' }}
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  // ── Header: crumbs + title + badges + actions ──────────────────────────

  const arStatusChip = (
    <Badge
      size="sm"
      dot
      variant={
        isOverCredit ? 'danger' : isOverdue ? 'warning' : arBalance === 0 ? 'success' : 'info'
      }
    >
      {isOverCredit
        ? 'Over Credit'
        : isOverdue
          ? `AR ${fmtMoneyCompact(arBalance)}`
          : arBalance === 0
            ? 'No Balance'
            : `Credit ${fmtMoneyCompact(Math.abs(arBalance))}`}
    </Badge>
  )

  const tierBadge = (
    <Badge size="sm" dot variant={TIER_VARIANT[pricingTier] ?? 'brand'}>
      {TIER_LABELS[pricingTier] ?? pricingTier}
    </Badge>
  )

  const tabs: Tab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'projects', label: 'Projects', badge: builder._count.projects },
    ...(isProduction || communities.length > 0
      ? [{ id: 'communities', label: 'Communities', badge: communities.length || undefined } as Tab]
      : []),
    { id: 'contacts', label: 'Contacts' },
    { id: 'activity', label: 'Activity' },
    { id: 'comms', label: 'Comms', badge: commLogs.length || undefined },
    { id: 'pricing', label: 'Custom Pricing', badge: builder._count.customPricing || undefined },
    { id: 'margins', label: 'Margins' },
  ]

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Accounts', href: '/ops/accounts' },
          { label: builder.companyName },
        ]}
        eyebrow={isProduction ? 'Production Builder' : 'Custom Builder'}
        title={builder.companyName}
        description={[
          builder.contactName,
          builder.email,
          builder.phone ?? undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            <PresenceAvatars recordId={builder.id} recordType="account" />
            <StatusBadge status={builder.status} />
            {tierBadge}
            {arStatusChip}
            <button
              onClick={() => setEditOpen(true)}
              className="h-8 px-3 text-[12.5px] rounded-md border border-border text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setActivityOpen(true)}
              className="h-8 px-3 text-[12.5px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 transition-colors"
            >
              Log Activity
            </button>
          </div>
        }
      />

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <a href={`/ops/orders?builderId=${builder.id}`}
          className="px-3 py-1.5 bg-surface-elevated text-fg rounded text-sm font-medium hover:bg-surface-muted inline-flex items-center gap-1.5 no-underline">
          📦 New Order
        </a>
        <a href={`/ops/quotes?builderId=${builder.id}`}
          className="px-3 py-1.5 bg-surface-elevated text-fg rounded text-sm font-medium hover:bg-surface-muted inline-flex items-center gap-1.5 no-underline">
          📋 Create Quote
        </a>
        <a href={`/ops/blueprints/analyze?builderId=${builder.id}`}
          className="px-3 py-1.5 bg-surface-elevated text-fg rounded text-sm font-medium hover:bg-surface-muted inline-flex items-center gap-1.5 no-underline">
          📐 Add Blueprint
        </a>
        <a href={`/ops/takeoff-tool?builderId=${builder.id}&builder=${encodeURIComponent(builder.companyName)}`}
          className="px-3 py-1.5 bg-signal text-fg-on-accent rounded text-sm font-medium hover:bg-signal-hover inline-flex items-center gap-1.5 no-underline">
          🤖 AI Takeoff
        </a>
        <a href={`/ops/schedule?builderId=${builder.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          📅 Schedule Task
        </a>
        <a href={`/ops/delivery?builderId=${builder.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          🚚 Schedule Delivery
        </a>
        <a href={`/ops/jobs?builderName=${encodeURIComponent(builder.companyName)}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          🏗️ View Jobs
        </a>
        <a href={`/ops/communication-log?builderId=${builder.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          💬 Communication Log
        </a>
        <a href={`/ops/contracts?builderId=${builder.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          📄 Contracts
        </a>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="YTD Revenue"
          value={fmtMoneyCompact(ytdRevenue)}
          accent="brand"
          icon={<DollarSign className="w-4 h-4" />}
          sparkline={monthlyRevenue}
          subtitle={`${recentOrders.length} recent orders`}
        />
        <KPICard
          title="AR Balance"
          value={fmtMoneyCompact(arBalance)}
          accent={isOverCredit ? 'negative' : isOverdue ? 'accent' : 'positive'}
          icon={<Banknote className="w-4 h-4" />}
          subtitle={
            builder.creditLimit
              ? `Limit ${fmtMoneyCompact(builder.creditLimit)}`
              : 'No credit limit'
          }
          badge={
            isOverdue ? (
              <Badge size="xs" variant="warning" dot>
                Owed
              </Badge>
            ) : isOverCredit ? (
              <Badge size="xs" variant="danger" dot>
                Over
              </Badge>
            ) : undefined
          }
        />
        <KPICard
          title="Open Deals"
          value={openDealsCount}
          accent="forecast"
          icon={<Briefcase className="w-4 h-4" />}
          subtitle={`${builder._count.projects} total projects`}
        />
        <KPICard
          title="Next Delivery"
          value={nextDelivery ? fmtDateShort(nextDelivery.expectedDelivery) : '—'}
          accent="neutral"
          icon={<Truck className="w-4 h-4" />}
          subtitle={nextDelivery ? `Order ${nextDelivery.orderNumber}` : 'Nothing scheduled'}
        />
      </div>

      {/* ── Health + Revenue chart + AI insight row ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <Card className="lg:col-span-3" padding="md">
          <CardHeader border={false}>
            <CardTitle>Account Health</CardTitle>
            <CardDescription>Composite of terms, AR, velocity</CardDescription>
          </CardHeader>
          <CardBody className="flex items-center gap-4">
            <HealthRadial score={healthScore} />
            <div className="text-[12px] text-fg-muted leading-relaxed">
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={cn(
                    'inline-block w-1.5 h-1.5 rounded-full',
                    isOverdue ? 'bg-data-negative' : 'bg-data-positive',
                  )}
                />
                {isOverdue ? 'AR pressure' : 'AR healthy'}
              </div>
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={cn(
                    'inline-block w-1.5 h-1.5 rounded-full',
                    builder.paymentTerm === 'NET_30' ? 'bg-accent' : 'bg-data-positive',
                  )}
                />
                {TERM_LABELS[builder.paymentTerm] ?? builder.paymentTerm}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-block w-1.5 h-1.5 rounded-full',
                    recentOrders.length >= 5 ? 'bg-data-positive' : 'bg-fg-subtle',
                  )}
                />
                {recentOrders.length >= 5 ? 'Active cadence' : 'Low cadence'}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-5" padding="md">
          <CardHeader border={false}>
            <CardTitle>Revenue · 12 mo</CardTitle>
            <CardDescription>Monthly total, trailing year</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="metric metric-lg">{fmtMoneyCompact(monthlyRevenue.reduce((a, b) => a + b, 0))}</div>
                <div className="text-[11px] text-fg-subtle mt-1 uppercase tracking-wider">Trailing 12 mo</div>
              </div>
              <Sparkline
                data={monthlyRevenue.length > 1 ? monthlyRevenue : [0, 0]}
                width={220}
                height={56}
                showArea
                showDot
                color="var(--brand)"
              />
            </div>
          </CardBody>
        </Card>

        <div className="lg:col-span-4">
          <AIInsight
            endpoint="/api/ops/ai/builder-snapshot"
            input={{ builderId: builder.id }}
            label="AI builder snapshot"
          />
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Activity timeline (merged) */}
          <Card className="lg:col-span-7" padding="none">
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
              <CardDescription>Orders, payments, comms, activities · newest first</CardDescription>
            </CardHeader>
            <CardBody>
              {mergedEvents.length === 0 ? (
                <EmptyState
                  icon="inbox"
                  size="compact"
                  title="No recent activity"
                  description="Orders, payments, and logged communications appear here."
                  action={{ label: 'Log activity', onClick: () => setActivityOpen(true) }}
                />
              ) : (
                <ol className="relative border-l border-border ml-3">
                  {mergedEvents.map((ev) => (
                    <li key={ev.id} className="ml-4 py-2.5 relative">
                      <span className="absolute -left-[25px] top-3 flex items-center justify-center w-5 h-5 rounded-full bg-surface border border-border">
                        {eventIcon(ev.kind)}
                      </span>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {ev.href ? (
                            <Link href={ev.href} className="text-[13px] font-medium text-fg hover:text-accent truncate">
                              {ev.label}
                            </Link>
                          ) : (
                            <span className="text-[13px] font-medium text-fg truncate">{ev.label}</span>
                          )}
                          {ev.detail && (
                            <p className="text-[11.5px] text-fg-muted mt-0.5 leading-snug">{ev.detail}</p>
                          )}
                        </div>
                        <span className="text-[11px] text-fg-subtle whitespace-nowrap tabular-nums">
                          {fmtDateShort(ev.at)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          {/* Right rail: AR aging + actions + cash insights */}
          <div className="lg:col-span-5 space-y-4">
            <Card padding="md">
              <CardHeader border={false}>
                <CardTitle>AR Aging</CardTitle>
                <CardDescription>Current balance waterfall</CardDescription>
              </CardHeader>
              <CardBody>
                <ARWaterfall buckets={agingBuckets} />
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border text-[12px]">
                  <span className="text-fg-muted">Total AR</span>
                  <span className="font-numeric font-semibold">{fmtMoney(arBalance)}</span>
                </div>
              </CardBody>
            </Card>

            <Card padding="md">
              <CardHeader border={false}>
                <CardTitle>Actions</CardTitle>
                <CardDescription>Common account operations</CardDescription>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setActivityForm({ ...activityForm, activityType: 'SITE_VISIT', subject: 'Site visit' })
                      setActivityOpen(true)
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-[12.5px] rounded-md border border-border hover:bg-surface-muted transition-colors"
                  >
                    <Building2 className="w-3.5 h-3.5 text-fg-muted" />
                    Log visit
                  </button>
                  <button
                    onClick={handleSendStatement}
                    className="flex items-center gap-2 px-3 py-2 text-[12.5px] rounded-md border border-border hover:bg-surface-muted transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-fg-muted" />
                    Send statement
                  </button>
                  <Link
                    href={`/ops/quotes/new?builderId=${builder.id}`}
                    className="flex items-center gap-2 px-3 py-2 text-[12.5px] rounded-md border border-border hover:bg-surface-muted transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-fg-muted" />
                    Create quote
                  </Link>
                  {isAdmin && (
                    <button
                      onClick={() => setCreditHoldOpen(true)}
                      className="flex items-center gap-2 px-3 py-2 text-[12.5px] rounded-md border border-data-negative/40 text-data-negative hover:bg-data-negative-bg transition-colors"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Credit hold
                    </button>
                  )}
                </div>
              </CardBody>
            </Card>

            {cashInsights?.outstandingActions && cashInsights.outstandingActions.length > 0 && (
              <Card padding="md" className="border-accent/30">
                <CardHeader border={false}>
                  <CardTitle>Collection Actions</CardTitle>
                  <CardDescription>From cash-flow optimizer</CardDescription>
                </CardHeader>
                <CardBody>
                  <ul className="space-y-2">
                    {cashInsights.outstandingActions.slice(0, 3).map((a: any, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[12px]">
                        <AlertCircle className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                        <span className="text-fg-muted">
                          <span className="font-medium text-fg">{a.actionType}</span>
                          {' — '}
                          {fmtMoneyCompact(a.amountDue || 0)} overdue {a.daysOverdue || 0}d
                          {a.channel ? ` · ${a.channel}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <Link
                      href="/ops/cash-flow-optimizer"
                      className="text-[12px] text-accent hover:text-accent-hover"
                    >
                      Cash Flow Command Center →
                    </Link>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>

          {/* Recent orders DataTable */}
          <Card className="lg:col-span-12" padding="none">
            <CardHeader>
              <CardTitle>Recent Orders</CardTitle>
              <CardDescription>Last 10 orders by date</CardDescription>
            </CardHeader>
            <CardBody>
              <RecentOrdersTable rows={recentOrders} loading={recentOrdersLoading} />
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Projects tab ────────────────────────────────────────────────── */}
      {activeTab === 'projects' && (
        <Card padding="none">
          {builder.projects.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="document"
                title="No projects yet"
                description="Create a project to start quoting and ordering for this builder."
              />
            </CardBody>
          ) : (
            <DataTable
              columns={[
                {
                  key: 'name',
                  header: 'Project',
                  cell: (p) => (
                    <Link
                      href={`/ops/projects/${p.id}`}
                      className="font-medium text-fg hover:text-accent"
                    >
                      {p.name}
                    </Link>
                  ),
                },
                {
                  key: 'jobAddress',
                  header: 'Address',
                  cell: (p) => (p as any).jobAddress || '—',
                  hideOnMobile: true,
                },
                {
                  key: 'quotes',
                  header: 'Quotes',
                  numeric: true,
                  cell: (p) => p._count.quotes,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (p) => <StatusBadge status={p.status} />,
                },
                {
                  key: 'createdAt',
                  header: 'Created',
                  cell: (p) => fmtDate(p.createdAt),
                  numeric: true,
                },
              ] as DataTableColumn<any>[]}
              data={builder.projects}
              rowKey={(p) => p.id}
              density="default"
            />
          )}
        </Card>
      )}

      {/* ── Communities tab ─────────────────────────────────────────────── */}
      {activeTab === 'communities' && (
        <div>
          {communitiesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-32 skeleton rounded-lg" />
              ))}
            </div>
          ) : communities.length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon="package"
                title="No communities yet"
                description="Communities group production builders (Toll, DR Horton, etc.) by subdivision or development."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {communities.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/ops/communities/${c.id}`}
                  className="panel panel-interactive p-5 block group"
                >
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-fg group-hover:text-accent truncate">
                        {c.name}
                      </h3>
                      <p className="text-[11.5px] text-fg-muted mt-0.5">
                        {[c.city, c.state].filter(Boolean).join(', ')}
                        {c.division && ` · ${c.division}`}
                      </p>
                    </div>
                    <StatusBadge status={c.status || 'ACTIVE'} />
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: 'Lots', val: c.totalLots || 0 },
                      { label: 'Jobs', val: c.jobCount || 0 },
                      { label: 'Contacts', val: c.contactCount || 0 },
                      { label: 'Tasks', val: c.openTaskCount || 0 },
                    ].map((s) => (
                      <div key={s.label}>
                        <div className="metric metric-sm">{s.val}</div>
                        <div className="text-[10px] uppercase tracking-wider text-fg-subtle mt-0.5">
                          {s.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Contacts tab ────────────────────────────────────────────────── */}
      {activeTab === 'contacts' && (
        <Card padding="none">
          {contactsLoading ? (
            <CardBody>
              <div className="h-40 skeleton rounded-md" />
            </CardBody>
          ) : builderContacts.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="users"
                title="No contacts on file"
                description="Add the people you work with at this account — PMs, coordinators, accounting."
              />
            </CardBody>
          ) : (
            <DataTable
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  cell: (c: any) => (
                    <div>
                      <div className="font-medium text-fg">
                        {c.firstName} {c.lastName}
                        {c.isPrimary && (
                          <Badge size="xs" variant="info" className="ml-1.5">
                            Primary
                          </Badge>
                        )}
                      </div>
                      {c.title && <div className="text-[11px] text-fg-muted">{c.title}</div>}
                    </div>
                  ),
                },
                {
                  key: 'role',
                  header: 'Role',
                  cell: (c: any) => (c.role || '').replace(/_/g, ' '),
                },
                {
                  key: 'community',
                  header: 'Community',
                  cell: (c: any) => c.communityName || 'Org-level',
                  hideOnMobile: true,
                },
                {
                  key: 'email',
                  header: 'Email',
                  cell: (c: any) =>
                    c.email ? (
                      <a href={`mailto:${c.email}`} className="text-accent hover:text-accent-hover">
                        {c.email}
                      </a>
                    ) : (
                      '—'
                    ),
                  hideOnMobile: true,
                },
                {
                  key: 'phone',
                  header: 'Phone',
                  cell: (c: any) => c.phone || c.mobile || '—',
                  hideOnMobile: true,
                },
                {
                  key: 'flags',
                  header: 'Flags',
                  cell: (c: any) => (
                    <div className="flex gap-1">
                      {c.receivesPO && <Badge size="xs" variant="success">PO</Badge>}
                      {c.receivesInvoice && <Badge size="xs" variant="info">Invoice</Badge>}
                    </div>
                  ),
                },
              ] as DataTableColumn<any>[]}
              data={builderContacts}
              rowKey={(c) => c.id}
              density="default"
            />
          )}
        </Card>
      )}

      {/* ── Activity tab ────────────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <Card padding="none">
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
            <CardDescription>Full activity history</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex justify-end mb-3">
              <button
                onClick={() => setActivityOpen(true)}
                className="h-8 px-3 text-[12.5px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90"
              >
                New Activity
              </button>
            </div>
            {activitiesLoading ? (
              <div className="h-40 skeleton rounded-md" />
            ) : activities.length === 0 ? (
              <EmptyState
                icon="document"
                title="No activities yet"
                description="Start tracking calls, emails, meetings, and notes for this account."
                action={{ label: 'Log activity', onClick: () => setActivityOpen(true) }}
              />
            ) : (
              <ul className="space-y-2">
                {activities.map((a) => (
                  <li key={a.id} className="panel p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[13px] font-medium text-fg">{a.subject}</span>
                          <Badge size="xs" variant="neutral">
                            {a.activityType.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <div className="text-[11.5px] text-fg-muted">
                          {a.staff.firstName} {a.staff.lastName} · {fmtDate(a.createdAt)}
                        </div>
                        {a.notes && <p className="text-[12.5px] text-fg mt-1.5">{a.notes}</p>}
                        {a.outcome && (
                          <p className="text-[11.5px] text-fg-subtle italic mt-1">
                            Outcome: {a.outcome}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Communications tab ──────────────────────────────────────────── */}
      {activeTab === 'comms' && (
        <Card padding="none">
          <CardHeader>
            <CardTitle>Communication History</CardTitle>
            <CardDescription>Emails, calls, meetings logged to this account</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex justify-end mb-3 gap-2">
              <button
                onClick={() => setCommOpen(true)}
                className="h-8 px-3 text-[12.5px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90"
              >
                Log Communication
              </button>
              <Link
                href={`/ops/communication-log?builderId=${builderId}`}
                className="h-8 px-3 inline-flex items-center text-[12.5px] rounded-md border border-border hover:bg-surface-muted"
              >
                View full log
              </Link>
            </div>
            {commsLoading ? (
              <div className="h-32 skeleton rounded-md" />
            ) : commLogs.length === 0 ? (
              <EmptyState
                icon="message"
                title="No communications logged"
                description="Log emails, calls, and meetings with this builder to keep a searchable history."
                action={{ label: 'Log communication', onClick: () => setCommOpen(true) }}
              />
            ) : (
              <ul className="space-y-2">
                {commLogs.map((log) => (
                  <li key={log.id} className="panel p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[13px] font-medium text-fg truncate">
                            {log.subject}
                          </span>
                          <Badge size="xs" variant="neutral">
                            {log.channel}
                          </Badge>
                          <span className="text-[11px] text-fg-subtle">
                            {log.direction === 'INBOUND' ? '← Inbound' : '→ Outbound'}
                          </span>
                        </div>
                        {log.body && (
                          <p className="text-[12px] text-fg-muted line-clamp-2">{log.body}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-fg-subtle whitespace-nowrap">
                        {fmtDate(log.sentAt || log.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Custom pricing tab ──────────────────────────────────────────── */}
      {activeTab === 'pricing' && (
        <Card padding="none">
          <CardHeader>
            <CardTitle>Custom Pricing</CardTitle>
            <CardDescription>Product-specific prices for this builder</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex justify-end mb-3">
              <button
                onClick={() => {
                  setPricingOpen(true)
                  setEditingPricingId(null)
                  setSelectedProduct(null)
                  setCustomPrice('')
                  setProductSearch('')
                  setSearchResults([])
                }}
                className="h-8 px-3 text-[12.5px] rounded-md bg-accent text-fg-on-accent hover:bg-accent/90"
              >
                Add custom price
              </button>
            </div>
            {pricingLoading ? (
              <div className="h-40 skeleton rounded-md" />
            ) : pricing.length === 0 ? (
              <EmptyState
                icon="package"
                title="No custom pricing yet"
                description="Set product-level overrides for this builder."
              />
            ) : (
              <DataTable
                columns={[
                  {
                    key: 'sku',
                    header: 'SKU',
                    cell: (bp: BuilderPricing) => (
                      <span className="font-mono text-[12px]">{bp.product.sku}</span>
                    ),
                  },
                  { key: 'product', header: 'Product', cell: (bp: BuilderPricing) => bp.product.name },
                  {
                    key: 'category',
                    header: 'Category',
                    cell: (bp: BuilderPricing) => bp.product.category,
                    hideOnMobile: true,
                  },
                  {
                    key: 'basePrice',
                    header: 'Base',
                    numeric: true,
                    cell: (bp: BuilderPricing) => fmtMoney(bp.product.basePrice),
                  },
                  {
                    key: 'customPrice',
                    header: 'Custom',
                    numeric: true,
                    cell: (bp: BuilderPricing) => (
                      <span className="font-semibold">{fmtMoney(bp.customPrice)}</span>
                    ),
                  },
                  {
                    key: 'margin',
                    header: 'Margin',
                    numeric: true,
                    cell: (bp: BuilderPricing) => {
                      const m = bp.margin || 0
                      return (
                        <span
                          className={cn(
                            'font-numeric',
                            m < 25 ? 'text-data-negative' : 'text-data-positive',
                          )}
                        >
                          {m.toFixed(1)}%
                        </span>
                      )
                    },
                  },
                ] as DataTableColumn<BuilderPricing>[]}
                data={pricing}
                rowKey={(bp) => bp.id}
                onRowClick={(bp) => handleEditPricing(bp)}
                density="default"
              />
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Margins tab ─────────────────────────────────────────────────── */}
      {activeTab === 'margins' && (
        <div className="space-y-4">
          {marginLoading ? (
            <div className="h-64 skeleton rounded-md" />
          ) : marginData ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card padding="md">
                  <CardHeader border={false}>
                    <div className="flex items-center justify-between">
                      <CardTitle>Target Blended Margin</CardTitle>
                      {!marginEditing && (
                        <button
                          onClick={startMarginEdit}
                          className="text-[12px] text-accent hover:text-accent-hover font-medium"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody>
                    {marginEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.1"
                          value={editBlendedTarget}
                          onChange={(e) => setEditBlendedTarget(e.target.value)}
                          className="w-24 h-9 px-2 border border-border rounded-md text-[18px] font-numeric"
                        />
                        <span className="text-[18px] text-fg-muted">%</span>
                      </div>
                    ) : (
                      <div className="metric metric-lg">
                        {marginData.marginTarget
                          ? `${(marginData.marginTarget.targetBlendedMargin * 100).toFixed(1)}%`
                          : '30.0%'}
                      </div>
                    )}
                  </CardBody>
                </Card>
                <Card padding="md">
                  <CardHeader border={false}>
                    <CardTitle>Actual Blended</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div
                      className={cn(
                        'metric metric-lg',
                        marginData.blendedActual.blendedMarginPct >=
                          (marginData.marginTarget?.targetBlendedMargin || 0.3) * 100
                          ? 'text-data-positive'
                          : marginData.blendedActual.blendedMarginPct > 0
                            ? 'text-data-negative'
                            : 'text-fg-subtle',
                      )}
                    >
                      {marginData.blendedActual.blendedMarginPct > 0
                        ? `${marginData.blendedActual.blendedMarginPct}%`
                        : '—'}
                    </div>
                    <p className="text-[11px] text-fg-subtle mt-1">
                      {marginData.blendedActual.orderCount} orders ·{' '}
                      {fmtMoneyCompact(marginData.blendedActual.totalRevenue)}
                    </p>
                  </CardBody>
                </Card>
                <Card padding="md">
                  <CardHeader border={false}>
                    <CardTitle>Gap</CardTitle>
                  </CardHeader>
                  <CardBody>
                    {marginData.blendedActual.blendedMarginPct > 0 ? (
                      (() => {
                        const target = (marginData.marginTarget?.targetBlendedMargin || 0.3) * 100
                        const actual = marginData.blendedActual.blendedMarginPct
                        const gap = actual - target
                        return (
                          <>
                            <div
                              className={cn(
                                'metric metric-lg',
                                gap >= 0 ? 'text-data-positive' : 'text-data-negative',
                              )}
                            >
                              {gap >= 0 ? '+' : ''}
                              {gap.toFixed(1)}%
                            </div>
                            <p className="text-[11px] text-fg-subtle mt-1">
                              {gap >= 0 ? 'Above target' : 'Below target'}
                            </p>
                          </>
                        )
                      })()
                    ) : (
                      <div className="metric metric-lg text-fg-subtle">—</div>
                    )}
                  </CardBody>
                </Card>
              </div>

              {marginEditing && (
                <Card padding="md">
                  <CardBody>
                    <label className="text-[11px] uppercase tracking-wider text-fg-subtle font-medium block mb-2">
                      Margin Notes
                    </label>
                    <textarea
                      value={marginNotes}
                      onChange={(e) => setMarginNotes(e.target.value)}
                      rows={2}
                      placeholder="e.g. Negotiated rates based on volume commitment..."
                      className="w-full px-3 py-2 border border-border rounded-md text-[13px]"
                    />
                  </CardBody>
                </Card>
              )}

              <Card padding="none">
                <CardHeader>
                  <CardTitle>Category Breakdown</CardTitle>
                  <CardDescription>{marginData.customPricingCount} custom prices set</CardDescription>
                </CardHeader>
                <CardBody>
                  <DataTable
                    columns={[
                      {
                        key: 'category',
                        header: 'Category',
                        cell: (cat: any, idx: number) => {
                          const actualCat = marginData.categories?.find((c: any) => c.category === cat.category)
                          const isCustom = actualCat?.isCustom || cat.isCustom
                          return (
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{cat.category}</span>
                              {isCustom && (
                                <Badge size="xs" variant="warning">
                                  Custom
                                </Badge>
                              )}
                            </div>
                          )
                        },
                      },
                      {
                        key: 'type',
                        header: 'Type',
                        cell: (cat: any) => (
                          <Badge size="xs" variant={cat.categoryType === 'CORE' ? 'info' : 'brand'}>
                            {cat.categoryType === 'CORE' ? 'Core' : 'Add-On'}
                          </Badge>
                        ),
                      },
                      {
                        key: 'targetMargin',
                        header: 'Target %',
                        numeric: true,
                        cell: (cat: any, idx: number) =>
                          marginEditing ? (
                            <input
                              type="number"
                              step="0.5"
                              value={editCategoryTargets[idx]?.targetMargin || ''}
                              onChange={(e) => {
                                const upd = [...editCategoryTargets]
                                upd[idx] = { ...upd[idx], targetMargin: e.target.value }
                                setEditCategoryTargets(upd)
                              }}
                              className="w-16 px-1.5 py-1 border border-border rounded text-[12px] text-center"
                            />
                          ) : (
                            `${(cat.targetMargin * 100).toFixed(1)}%`
                          ),
                      },
                      {
                        key: 'minMargin',
                        header: 'Min %',
                        numeric: true,
                        cell: (cat: any, idx: number) =>
                          marginEditing ? (
                            <input
                              type="number"
                              step="0.5"
                              value={editCategoryTargets[idx]?.minMargin || ''}
                              onChange={(e) => {
                                const upd = [...editCategoryTargets]
                                upd[idx] = { ...upd[idx], minMargin: e.target.value }
                                setEditCategoryTargets(upd)
                              }}
                              className="w-16 px-1.5 py-1 border border-border rounded text-[12px] text-center"
                            />
                          ) : (
                            `${(cat.minMargin * 100).toFixed(1)}%`
                          ),
                      },
                      {
                        key: 'actual',
                        header: 'Actual %',
                        numeric: true,
                        cell: (cat: any) => {
                          const actualCat = marginData.categories?.find((c: any) => c.category === cat.category)
                          const status = actualCat?.status || 'NO_DATA'
                          if (actualCat?.actualMarginPct == null) return '—'
                          return (
                            <span
                              className={cn(
                                'font-numeric',
                                status === 'ON_TARGET' && 'text-data-positive',
                                status === 'BELOW_TARGET' && 'text-accent',
                                status === 'CRITICAL' && 'text-data-negative',
                              )}
                            >
                              {actualCat.actualMarginPct}%
                            </span>
                          )
                        },
                      },
                      {
                        key: 'revenue',
                        header: 'Revenue',
                        numeric: true,
                        cell: (cat: any) => {
                          const actualCat = marginData.categories?.find((c: any) => c.category === cat.category)
                          return actualCat?.revenue > 0 ? fmtMoneyCompact(actualCat.revenue) : '—'
                        },
                      },
                    ] as DataTableColumn<any>[]}
                    data={marginEditing ? editCategoryTargets : marginData.categories || []}
                    rowKey={(c) => c.category}
                    density="default"
                  />
                </CardBody>
              </Card>

              {marginEditing && (
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setMarginEditing(false)}
                    className="h-9 px-4 text-[13px] rounded-md border border-border hover:bg-surface-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveMarginTargets}
                    disabled={marginSaving}
                    className="h-9 px-4 text-[13px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50"
                  >
                    {marginSaving ? 'Saving…' : 'Save Margin Targets'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardBody>
                <EmptyState
                  icon="chart"
                  title="Failed to load margin data"
                  action={{ label: 'Retry', onClick: loadMargins }}
                />
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Account"
        size="lg"
        footer={
          <>
            <button
              onClick={() => setEditOpen(false)}
              className="h-9 px-4 text-[13px] rounded-md border border-border hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={editSaving}
              className="h-9 px-4 text-[13px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && (
            <div className="px-3 py-2 rounded-md bg-data-negative-bg text-data-negative text-[13px]">
              {editError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company Name">
              <input
                value={editForm.companyName || ''}
                onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Contact Name">
              <input
                value={editForm.contactName || ''}
                onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={editForm.email || ''}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={editForm.phone || ''}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Address" span={2}>
              <input
                value={editForm.address || ''}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="City">
              <input
                value={editForm.city || ''}
                onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="State">
              <input
                value={editForm.state || ''}
                onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Zip">
              <input
                value={editForm.zip || ''}
                onChange={(e) => setEditForm({ ...editForm, zip: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="License Number">
              <input
                value={editForm.licenseNumber || ''}
                onChange={(e) => setEditForm({ ...editForm, licenseNumber: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Payment Terms">
              <select
                value={editForm.paymentTerm || 'NET_15'}
                onChange={(e) => setEditForm({ ...editForm, paymentTerm: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              >
                <option value="PAY_AT_ORDER">Pay at Order</option>
                <option value="PAY_ON_DELIVERY">Pay on Delivery</option>
                <option value="NET_15">Net 15</option>
                <option value="NET_30">Net 30</option>
              </select>
            </Field>
            <Field label="Pricing Tier">
              <select
                value={editForm.pricingTier || 'STANDARD'}
                onChange={(e) => setEditForm({ ...editForm, pricingTier: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              >
                <option value="PREFERRED">Preferred</option>
                <option value="STANDARD">Standard</option>
                <option value="NEW_ACCOUNT">New Account</option>
                <option value="PREMIUM">Premium</option>
              </select>
            </Field>
            <Field label="Credit Limit">
              <input
                type="number"
                value={editForm.creditLimit ?? ''}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    creditLimit: e.target.value ? parseFloat(e.target.value) : null,
                  })
                }
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              />
            </Field>
            <Field label="Status">
              <select
                value={editForm.status || 'PENDING'}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              >
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="CLOSED">Closed</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 mt-2 col-span-2">
              <input
                type="checkbox"
                checked={!!editForm.taxExempt}
                onChange={(e) => setEditForm({ ...editForm, taxExempt: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-[13px] text-fg">Tax Exempt</span>
            </label>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        title="Log Activity"
        size="md"
        footer={
          <>
            <button
              onClick={() => setActivityOpen(false)}
              className="h-9 px-4 text-[13px] rounded-md border border-border hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleLogActivity}
              disabled={activitySaving || !activityForm.subject}
              className="h-9 px-4 text-[13px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50"
            >
              {activitySaving ? 'Saving…' : 'Log Activity'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {activityError && (
            <div className="px-3 py-2 rounded-md bg-data-negative-bg text-data-negative text-[13px]">
              {activityError}
            </div>
          )}
          <Field label="Activity Type">
            <select
              value={activityForm.activityType}
              onChange={(e) => setActivityForm({ ...activityForm, activityType: e.target.value })}
              className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
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
          </Field>
          <Field label="Subject *">
            <input
              value={activityForm.subject}
              onChange={(e) => setActivityForm({ ...activityForm, subject: e.target.value })}
              placeholder="e.g., Follow-up on quote"
              className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={activityForm.notes}
              onChange={(e) => setActivityForm({ ...activityForm, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-md text-[13px]"
            />
          </Field>
          <Field label="Outcome">
            <input
              value={activityForm.outcome}
              onChange={(e) => setActivityForm({ ...activityForm, outcome: e.target.value })}
              placeholder="e.g., Agreed to NET_15"
              className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={commOpen}
        onClose={() => setCommOpen(false)}
        title="Log Communication"
        size="md"
        footer={
          <>
            <button
              onClick={() => setCommOpen(false)}
              className="h-9 px-4 text-[13px] rounded-md border border-border hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              onClick={(e) => handleLogComm(e as any)}
              disabled={commSaving || !commForm.subject}
              className="h-9 px-4 text-[13px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50"
            >
              {commSaving ? 'Saving…' : 'Log Communication'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel">
              <select
                value={commForm.channel}
                onChange={(e) => setCommForm({ ...commForm, channel: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              >
                <option value="EMAIL">Email</option>
                <option value="PHONE">Phone</option>
                <option value="TEXT">Text/SMS</option>
                <option value="MEETING">Meeting</option>
                <option value="PORTAL">Portal</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Direction">
              <select
                value={commForm.direction}
                onChange={(e) => setCommForm({ ...commForm, direction: e.target.value })}
                className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              >
                <option value="OUTBOUND">Outbound (We sent)</option>
                <option value="INBOUND">Inbound (They sent)</option>
              </select>
            </Field>
          </div>
          <Field label="Subject">
            <input
              value={commForm.subject}
              onChange={(e) => setCommForm({ ...commForm, subject: e.target.value })}
              className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
              required
            />
          </Field>
          <Field label="Details">
            <textarea
              value={commForm.body}
              onChange={(e) => setCommForm({ ...commForm, body: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-border rounded-md text-[13px]"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={pricingOpen}
        onClose={() => {
          setPricingOpen(false)
          setSelectedProduct(null)
          setCustomPrice('')
          setEditingPricingId(null)
          setProductSearch('')
          setSearchResults([])
        }}
        title={editingPricingId ? 'Edit Price' : 'Add Custom Price'}
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                setPricingOpen(false)
                setSelectedProduct(null)
                setCustomPrice('')
                setEditingPricingId(null)
              }}
              className="h-9 px-4 text-[13px] rounded-md border border-border hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              onClick={handlePricingSave}
              disabled={pricingSaving || !selectedProduct || !customPrice}
              className="h-9 px-4 text-[13px] rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50"
            >
              {pricingSaving ? 'Saving…' : editingPricingId ? 'Update Price' : 'Add Price'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {pricingError && (
            <div className="px-3 py-2 rounded-md bg-data-negative-bg text-data-negative text-[13px]">
              {pricingError}
            </div>
          )}
          {!editingPricingId && (
            <Field label="Product *">
              <div className="relative">
                <input
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  placeholder="Search by SKU or name…"
                  className="w-full h-9 px-3 border border-border rounded-md text-[13px]"
                />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-surface border border-border rounded-md mt-1 shadow-elevation-2 z-10 max-h-48 overflow-y-auto">
                    {searchResults.map((prod) => (
                      <button
                        key={prod.id}
                        onClick={() => {
                          setSelectedProduct(prod)
                          setProductSearch('')
                          setSearchResults([])
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-muted border-b border-border last:border-b-0"
                      >
                        <div className="text-[13px] font-medium">
                          {prod.sku} — {prod.name}
                        </div>
                        <div className="text-[11px] text-fg-muted">
                          {prod.category} · Base {fmtMoney(prod.basePrice)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <div className="mt-2 px-3 py-2 rounded-md bg-brand-subtle border border-border text-[12px]">
                  <div className="font-medium">
                    {selectedProduct.sku} — {selectedProduct.name}
                  </div>
                  <div className="text-fg-muted">
                    Base {fmtMoney(selectedProduct.basePrice)} · Cost{' '}
                    {fmtMoney(selectedProduct.cost || 0)}
                  </div>
                </div>
              )}
            </Field>
          )}
          {selectedProduct && (
            <Field label="Custom Price *">
              <div className="flex items-center gap-2">
                <span className="text-fg-muted">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="flex-1 h-9 px-3 border border-border rounded-md text-[13px]"
                />
              </div>
              {customPrice && parseFloat(customPrice) > 0 && (
                <p className="text-[11.5px] text-fg-muted mt-2">
                  Margin{' '}
                  <span
                    className={cn(
                      'font-numeric font-medium',
                      (parseFloat(customPrice) - (selectedProduct.cost || 0)) /
                        parseFloat(customPrice) *
                        100 <
                        25
                        ? 'text-data-negative'
                        : 'text-data-positive',
                    )}
                  >
                    {(
                      ((parseFloat(customPrice) - (selectedProduct.cost || 0)) /
                        parseFloat(customPrice)) *
                      100
                    ).toFixed(1)}
                    %
                  </span>
                </p>
              )}
            </Field>
          )}
        </div>
      </Dialog>

      <Dialog
        open={creditHoldOpen}
        onClose={() => setCreditHoldOpen(false)}
        title="Place Account on Credit Hold"
        description="This suspends the account, blocking new orders until re-activated."
        size="sm"
        footer={
          <>
            <button
              onClick={() => setCreditHoldOpen(false)}
              className="h-9 px-4 text-[13px] rounded-md border border-border hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleCreditHold}
              disabled={creditHoldSaving}
              className="h-9 px-4 text-[13px] rounded-md bg-data-negative text-white hover:opacity-90 disabled:opacity-50"
            >
              {creditHoldSaving ? 'Saving…' : 'Place on Hold'}
            </button>
          </>
        }
      >
        <div className="flex items-start gap-3 p-3 bg-data-negative-bg border border-data-negative/30 rounded-md">
          <AlertTriangle className="w-4 h-4 text-data-negative mt-0.5 shrink-0" />
          <div className="text-[12.5px] text-fg">
            You're about to suspend <strong>{builder.companyName}</strong>. New orders will be
            blocked. This is an admin-only action and will be logged to the audit trail.
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  span,
}: {
  label: string
  children: ReactNode
  span?: number
}) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <label className="block text-[11px] uppercase tracking-wider text-fg-subtle font-medium mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

function RecentOrdersTable({
  rows,
  loading,
}: {
  rows: OrderRow[]
  loading: boolean
}) {
  if (loading) {
    return <div className="h-32 skeleton rounded-md" />
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="package"
        size="compact"
        title="No recent orders"
        description="Orders placed by this builder will appear here."
      />
    )
  }
  const columns: DataTableColumn<OrderRow>[] = [
    {
      key: 'orderNumber',
      header: 'Order',
      cell: (o) => (
        <Link href={`/ops/orders/${o.id}`} className="font-mono text-[12px] text-accent hover:text-accent-hover">
          {o.orderNumber}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
    { key: 'total', header: 'Total', numeric: true, cell: (o) => fmtMoney(o.total) },
    {
      key: 'createdAt',
      header: 'Created',
      numeric: true,
      cell: (o) => fmtDate(o.createdAt),
      hideOnMobile: true,
    },
    {
      key: 'expected',
      header: 'Expected',
      numeric: true,
      cell: (o) => fmtDate(o.expectedDelivery),
      hideOnMobile: true,
    },
  ]
  return <DataTable columns={columns} data={rows} rowKey={(o) => o.id} density="default" />
}
