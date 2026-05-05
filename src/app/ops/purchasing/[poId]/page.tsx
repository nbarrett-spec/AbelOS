'use client'

/**
 * Purchase Order Detail — /ops/purchasing/[poId]
 *
 * Aegis design system. Renders:
 *   ▸ PageHeader with PO#, vendor, status badge, category badge, PresenceAvatars
 *   ▸ 4 KPI tiles  (Total $, items, received %, days in state)
 *   ▸ Vendor scorecard panel
 *   ▸ Line-items DataTable with inline receive-remaining + short-ship flag
 *   ▸ Horizontal status Timeline (DRAFT → SENT → PARTIAL → RECEIVED)
 *   ▸ Linked builder orders
 *   ▸ Audit trail (last 10)
 *   ▸ Actions (Approve, Send via Resend, Mark Received, Cancel)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import DocumentAttachments from '@/components/ops/DocumentAttachments'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  DollarSign,
  Mail,
  Package,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  X,
  AlertTriangle,
  ExternalLink,
  Hash,
  Percent,
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
  StatusBadge,
  EmptyState,
  Timeline,
  Dialog,
  PresenceAvatars,
  AnimatedNumber,
  LiveDataIndicator,
  Avatar,
  type TimelineNode,
  type TimelineNodeState,
  type BadgeVariant,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface POItem {
  id: string
  purchaseOrderId: string
  productId: string | null
  vendorSku: string
  description: string
  quantity: number
  unitCost: number
  lineTotal: number
  receivedQty: number
  damagedQty?: number
  productSku?: string | null
  productName?: string | null
  productCategory?: string | null
}

interface VendorSummary {
  id: string
  name: string
  code: string
  contactName: string | null
  email: string | null
  phone: string | null
  accountNumber: string | null
  avgLeadDays: number | null
  onTimeRate: number | null
  paymentTerms: string | null
}

interface StaffRef {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
}

interface Scorecard {
  totalPOs: number
  onTimeRate: number
  avgLeadDays: number
  spendYTD: number
  qualityIssues: number
  grade: string
}

interface LinkedOrder {
  orderId: string
  orderNumber: string
  orderStatus: string
  orderTotal: number
  builderId: string | null
  builderName: string | null
}

interface AuditEntry {
  id: string
  action: string
  staffId: string | null
  details: any
  createdAt: string
  severity: string | null
  staffFirstName: string | null
  staffLastName: string | null
}

interface TimelineEvt {
  key: string
  label: string
  at: string | null
  actor: string | null
}

interface PO {
  id: string
  poNumber: string
  vendorId: string
  status: string
  category: string | null
  subtotal: number
  shippingCost: number
  total: number
  orderedAt: string | null
  expectedDate: string | null
  receivedAt: string | null
  notes: string | null
  aiGenerated: boolean | null
  source: string | null
  createdAt: string
  updatedAt: string
  vendor: VendorSummary
  createdBy: StaffRef | null
  approvedBy: StaffRef | null
  items: POItem[]
  scorecard: Scorecard | null
  linkedOrders: LinkedOrder[]
  auditTrail: AuditEntry[]
  timeline: TimelineEvt[]
  daysInState: number
  receivedPct: number
  totalQty: number
  totalReceived: number
}

// ── Category color mapping ───────────────────────────────────────────────
const CATEGORY_VARIANT: Record<string, BadgeVariant> = {
  EXTERIOR: 'brand',
  TRIM_1: 'info',
  TRIM_1_LABOR: 'info',
  TRIM_2: 'warning',
  TRIM_2_LABOR: 'warning',
  FINAL_FRONT: 'success',
  PUNCH: 'danger',
  GENERAL: 'neutral',
}

const categoryLabel = (c: string | null) => (c ? c.replace(/_/g, ' ') : 'GENERAL')

// ── Formatters ───────────────────────────────────────────────────────────
const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
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
    ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

// ── Timeline transform ───────────────────────────────────────────────────
function buildTimelineNodes(po: PO): TimelineNode[] {
  const steps: Array<{ key: string; label: string }> = [
    { key: 'DRAFT', label: 'Draft' },
    { key: 'SENT_TO_VENDOR', label: 'Sent' },
    { key: 'PARTIALLY_RECEIVED', label: 'Partial' },
    { key: 'RECEIVED', label: 'Received' },
  ]
  const lookup = new Map(po.timeline.map((t) => [t.key, t]))
  const currentIndex = steps.findIndex((s) => s.key === po.status)
  return steps.map((step, i) => {
    const t = lookup.get(step.key)
    let state: TimelineNodeState
    if (po.status === 'CANCELLED') {
      state = i === 0 ? 'completed' : i === currentIndex ? 'error' : 'upcoming'
    } else if (currentIndex === -1 && po.status === 'PENDING_APPROVAL') {
      state = i === 0 ? 'completed' : 'upcoming'
    } else if (i < currentIndex) {
      state = 'completed'
    } else if (i === currentIndex) {
      state = 'active'
    } else {
      state = 'upcoming'
    }
    return {
      id: step.key,
      label: step.label,
      state,
      timestamp: t?.at ?? undefined,
      operator: t?.actor ?? undefined,
    }
  })
}

// ── Grade color tone ─────────────────────────────────────────────────────
function gradeTone(grade: string): { variant: BadgeVariant; text: string } {
  const map: Record<string, { variant: BadgeVariant; text: string }> = {
    A: { variant: 'success', text: 'text-data-positive' },
    B: { variant: 'success', text: 'text-data-positive' },
    C: { variant: 'warning', text: 'text-accent' },
    D: { variant: 'warning', text: 'text-accent' },
    F: { variant: 'danger', text: 'text-data-negative' },
  }
  return map[grade] ?? { variant: 'neutral', text: 'text-fg-muted' }
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const params = useParams() as { poId?: string }
  const router = useRouter()
  const poId = params?.poId

  const [po, setPO] = useState<PO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Receive dialog state
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveDraft, setReceiveDraft] = useState<Record<string, number>>({})
  const [shortShipFlag, setShortShipFlag] = useState(false)

  // Send dialog state
  const [sendOpen, setSendOpen] = useState(false)
  const [sendTo, setSendTo] = useState('')

  // ── Load ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!poId) return
    try {
      setError(null)
      const res = await fetch(`/api/ops/purchasing/${poId}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as PO
      setPO(data)
      setRefreshTick(Date.now())
    } catch (e: any) {
      setError(e?.message || 'Failed to load PO')
    } finally {
      setLoading(false)
    }
  }, [poId])

  useEffect(() => {
    load()
  }, [load])

  // ── Actions ────────────────────────────────────────────────────────────
  const patchStatus = async (status: string, extra?: Record<string, any>) => {
    if (!po) return
    setActionLoading(status)
    try {
      const res = await fetch(`/api/ops/purchasing/${po.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(extra ?? {}) }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: any) {
      setError(e?.message || 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  // FIX-4: inline-edit a single PO field (used by the EditableDate widget on
  // the Expected Delivery cell). Same PATCH endpoint as patchStatus, but
  // doesn't force a status transition.
  const updateField = async (data: Record<string, any>): Promise<void> => {
    if (!po) return
    const res = await fetch(`/api/ops/purchasing/${po.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || `HTTP ${res.status}`)
    }
    await load()
  }

  const sendEmail = async () => {
    if (!po) return
    setActionLoading('send-email')
    try {
      const res = await fetch(`/api/ops/purchasing/${po.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendTo ? { to: sendTo } : {}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setSendOpen(false)
      // Also push status to SENT_TO_VENDOR if currently DRAFT / APPROVED
      if (po.status === 'DRAFT' || po.status === 'APPROVED' || po.status === 'PENDING_APPROVAL') {
        await patchStatus('SENT_TO_VENDOR')
      } else {
        await load()
      }
    } catch (e: any) {
      setError(e?.message || 'Email failed')
    } finally {
      setActionLoading(null)
    }
  }

  const submitReceive = async () => {
    if (!po) return
    setActionLoading('receive')
    try {
      const receive = po.items
        .filter((it) => (it.receivedQty ?? 0) < it.quantity)
        .map((it) => ({
          itemId: it.id,
          receivedQty:
            receiveDraft[it.id] != null
              ? Math.max(0, Math.min(it.quantity, receiveDraft[it.id]))
              : it.quantity,
        }))
      const totalAfter = po.items.reduce((s, it) => {
        const override = receive.find((r) => r.itemId === it.id)
        return s + (override ? override.receivedQty : it.receivedQty)
      }, 0)
      const totalNeeded = po.items.reduce((s, it) => s + it.quantity, 0)
      const nextStatus =
        totalAfter >= totalNeeded
          ? 'RECEIVED'
          : totalAfter > 0
          ? 'PARTIALLY_RECEIVED'
          : undefined

      const res = await fetch(`/api/ops/purchasing/${po.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receive,
          shortShipFlag: shortShipFlag || undefined,
          ...(nextStatus ? { status: nextStatus } : {}),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setReceiveOpen(false)
      setReceiveDraft({})
      setShortShipFlag(false)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Receive failed')
    } finally {
      setActionLoading(null)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const timelineNodes = useMemo(() => (po ? buildTimelineNodes(po) : []), [po])
  const canApprove = po?.status === 'DRAFT' || po?.status === 'PENDING_APPROVAL'
  const canSend = po && ['DRAFT', 'APPROVED', 'PENDING_APPROVAL'].includes(po.status)
  const canReceive = po && ['SENT_TO_VENDOR', 'PARTIALLY_RECEIVED'].includes(po.status)
  const canCancel = po && !['RECEIVED', 'CANCELLED'].includes(po.status)

  // ── Loading / error ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Purchasing" title="Loading purchase order…" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-card h-24 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !po) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Purchasing"
          title="Purchase Order"
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Purchasing', href: '/ops/purchasing' },
            { label: 'Detail' },
          ]}
        />
        <div className="panel p-12 text-center">
          <AlertTriangle className="w-8 h-8 text-data-negative mx-auto mb-3" />
          <div className="text-sm font-medium text-fg">{error ?? 'Purchase order not found.'}</div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button onClick={load} className="btn btn-secondary btn-sm">
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
            <Link href="/ops/purchasing" className="btn btn-ghost btn-sm">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to list
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const catVariant: BadgeVariant = CATEGORY_VARIANT[po.category ?? 'GENERAL'] ?? 'neutral'
  const remainingItems = po.items.filter((i) => (i.receivedQty ?? 0) < i.quantity)

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Purchasing"
        title={po.poNumber}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span className="font-medium text-fg">{po.vendor?.name ?? 'Unknown vendor'}</span>
            {po.vendor?.code && (
              <span className="text-fg-subtle font-mono text-xs">· {po.vendor.code}</span>
            )}
          </span> as any
        }
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Purchasing', href: '/ops/purchasing' },
          { label: po.poNumber },
        ]}
        actions={
          <>
            <PresenceAvatars recordId={po.id} recordType="PurchaseOrder" max={4} />
            <button
              onClick={load}
              className="btn btn-secondary btn-sm"
              disabled={!!actionLoading}
              title="Refresh"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', actionLoading && 'animate-spin')} />
            </button>
            {canApprove && (
              <button
                onClick={() => patchStatus('APPROVED')}
                disabled={actionLoading === 'APPROVED'}
                className="btn btn-primary btn-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {actionLoading === 'APPROVED' ? 'Approving…' : 'Approve'}
              </button>
            )}
            {canSend && (
              <button
                onClick={() => {
                  setSendTo(po.vendor?.email ?? '')
                  setSendOpen(true)
                }}
                disabled={!!actionLoading}
                className="btn btn-primary btn-sm"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            )}
            {canReceive && (
              <button
                onClick={() => {
                  setReceiveDraft({})
                  setShortShipFlag(false)
                  setReceiveOpen(true)
                }}
                disabled={!!actionLoading}
                className="btn btn-success btn-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark Received
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => {
                  if (confirm('Cancel this PO? This cannot be undone.')) patchStatus('CANCELLED')
                }}
                disabled={actionLoading === 'CANCELLED'}
                className="btn btn-ghost btn-sm text-data-negative hover:bg-data-negative-bg"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={po.status} size="sm" />
          <Badge variant={catVariant} size="sm">
            {categoryLabel(po.category)}
          </Badge>
          {po.aiGenerated && (
            <Badge variant="brand" size="sm">
              AI
            </Badge>
          )}
          {po.source === 'LEGACY_SEED' && (
            <Badge variant="neutral" size="sm">
              Legacy
            </Badge>
          )}
        </div>
      </PageHeader>

      {/* ── KPI tiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Total"
          accent="brand"
          value={<AnimatedNumber value={po.total} format={fmtMoneyCompact} />}
          subtitle={`Subtotal ${fmtMoneyCompact(po.subtotal)} · ship ${fmtMoneyCompact(
            po.shippingCost,
          )}`}
          icon={<DollarSign className="w-3.5 h-3.5" />}
        />
        <KPICard
          title="Line Items"
          accent="neutral"
          value={<AnimatedNumber value={po.items.length} />}
          subtitle={`${po.totalQty.toLocaleString()} units ordered`}
          icon={<Package className="w-3.5 h-3.5" />}
        />
        <KPICard
          title="Received"
          accent={po.receivedPct >= 100 ? 'positive' : po.receivedPct > 0 ? 'accent' : 'neutral'}
          value={
            <span className="tabular-nums">
              <AnimatedNumber value={po.receivedPct} />%
            </span>
          }
          subtitle={`${po.totalReceived.toLocaleString()} / ${po.totalQty.toLocaleString()} units`}
          icon={<Percent className="w-3.5 h-3.5" />}
        />
        <KPICard
          title="Days in state"
          accent={po.daysInState > 14 ? 'negative' : po.daysInState > 7 ? 'accent' : 'positive'}
          value={<AnimatedNumber value={po.daysInState} />}
          subtitle={`Status: ${po.status.replace(/_/g, ' ')}`}
          icon={<Clock className="w-3.5 h-3.5" />}
        />
      </div>

      {/* ── Timeline ────────────────────────────────────────────────── */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              State transitions with timestamps and actor. Tap a node for detail.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <Timeline nodes={timelineNodes} />
        </CardBody>
      </Card>

      {/* ── Vendor scorecard + PO meta ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card variant="default" padding="md" className="lg:col-span-1">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <div className="eyebrow">Vendor</div>
              <div className="text-base font-semibold text-fg truncate mt-1">
                {po.vendor?.name ?? '—'}
              </div>
              <div className="text-[11px] font-mono text-fg-subtle">{po.vendor?.code ?? ''}</div>
            </div>
            {po.scorecard && (
              <div className="text-right shrink-0">
                <div className="eyebrow">Grade</div>
                <div
                  className={cn(
                    'metric metric-lg tabular-nums mt-0.5',
                    gradeTone(po.scorecard.grade).text,
                  )}
                >
                  {po.scorecard.grade}
                </div>
              </div>
            )}
          </div>

          {po.scorecard ? (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="panel px-3 py-2">
                <div className="eyebrow">On-Time</div>
                <div className="metric metric-md tabular-nums mt-1">
                  {Math.round(po.scorecard.onTimeRate)}%
                </div>
              </div>
              <div className="panel px-3 py-2">
                <div className="eyebrow">Lead</div>
                <div className="metric metric-md tabular-nums mt-1">
                  {po.scorecard.avgLeadDays}d
                </div>
              </div>
              <div className="panel px-3 py-2">
                <div className="eyebrow">Spend YTD</div>
                <div className="metric metric-md tabular-nums mt-1">
                  {fmtMoneyCompact(po.scorecard.spendYTD)}
                </div>
              </div>
              <div className="panel px-3 py-2">
                <div className="eyebrow">PO Count</div>
                <div className="metric metric-md tabular-nums mt-1">
                  {po.scorecard.totalPOs}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-fg-muted py-2">No scorecard data available.</div>
          )}

          <div className="divider" />

          <div className="space-y-1.5 text-xs mt-3">
            <Row label="Contact" value={po.vendor?.contactName ?? '—'} />
            <Row label="Email" value={po.vendor?.email ?? '—'} />
            <Row label="Phone" value={po.vendor?.phone ?? '—'} />
            <Row label="Account #" value={po.vendor?.accountNumber ?? '—'} mono />
            <Row label="Payment terms" value={po.vendor?.paymentTerms ?? '—'} />
          </div>
        </Card>

        <Card variant="default" padding="md" className="lg:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Meta label="Ordered" value={fmtDate(po.orderedAt)} />
            <EditableDateCell
              label="Expected"
              value={po.expectedDate}
              editable={['DRAFT', 'APPROVED', 'SENT_TO_VENDOR'].includes(po.status)}
              onSave={async (date) => {
                await updateField({ expectedDate: date })
              }}
            />
            <Meta label="Received" value={fmtDate(po.receivedAt)} />
            <Meta
              label="Created by"
              value={
                po.createdBy
                  ? `${po.createdBy.firstName ?? ''} ${po.createdBy.lastName ?? ''}`.trim()
                  : '—'
              }
            />
            <Meta
              label="Approved by"
              value={
                po.approvedBy
                  ? `${po.approvedBy.firstName ?? ''} ${po.approvedBy.lastName ?? ''}`.trim()
                  : '—'
              }
            />
            <Meta label="Created" value={fmtDate(po.createdAt)} />
            <Meta label="Last update" value={fmtDate(po.updatedAt)} />
            <Meta label="Source" value={po.source ?? 'Direct'} />
          </div>

          {po.notes && (
            <>
              <div className="divider my-4" />
              <div>
                <div className="eyebrow mb-1">Notes</div>
                <p className="text-sm text-fg whitespace-pre-wrap leading-relaxed">{po.notes}</p>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Line items ──────────────────────────────────────────────── */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Package className="w-4 h-4 text-accent" />
                Line items
              </span>
            </CardTitle>
            <CardDescription>
              {po.items.length} lines · {po.totalQty.toLocaleString()} units
            </CardDescription>
          </div>
          {canReceive && remainingItems.length > 0 && (
            <button
              onClick={() => {
                setReceiveDraft({})
                setShortShipFlag(false)
                setReceiveOpen(true)
              }}
              className="btn btn-secondary btn-sm"
            >
              <Truck className="w-3.5 h-3.5" />
              Receive
            </button>
          )}
        </CardHeader>
        <DataTable
          density="compact"
          data={po.items}
          rowKey={(i) => i.id}
          empty={<EmptyState icon="package" title="No items" description="This PO has no lines yet." />}
          columns={[
            {
              key: 'sku',
              header: 'SKU',
              cell: (i) => (
                <span className="font-mono text-xs text-fg-muted">
                  {i.productSku ?? i.vendorSku ?? '—'}
                </span>
              ),
            },
            {
              key: 'description',
              header: 'Description',
              cell: (i) => (
                <div className="min-w-0">
                  <div className="text-sm text-fg truncate">
                    {i.productName ?? i.description ?? '—'}
                  </div>
                  {i.productCategory && (
                    <div className="text-[10px] text-fg-subtle mt-0.5">
                      {i.productCategory}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'quantity',
              header: 'Qty',
              numeric: true,
              cell: (i) => <span className="tabular-nums">{i.quantity}</span>,
            },
            {
              key: 'received',
              header: 'Received',
              numeric: true,
              cell: (i) => {
                const pct = i.quantity > 0 ? (i.receivedQty / i.quantity) * 100 : 0
                return (
                  <div className="flex items-center justify-end gap-2 min-w-[110px]">
                    <div className="relative h-1.5 w-14 bg-surface-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full',
                          pct >= 100 ? 'bg-data-positive' : 'bg-accent',
                        )}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'tabular-nums text-xs',
                        pct >= 100 ? 'text-data-positive' : 'text-fg-muted',
                      )}
                    >
                      {i.receivedQty}/{i.quantity}
                    </span>
                  </div>
                )
              },
            },
            {
              key: 'unitCost',
              header: 'Unit',
              numeric: true,
              cell: (i) => <span className="tabular-nums">{fmtMoney(i.unitCost)}</span>,
            },
            {
              key: 'lineTotal',
              header: 'Total',
              numeric: true,
              heatmap: true,
              heatmapValue: (i) => i.lineTotal,
              cell: (i) => <span className="tabular-nums font-semibold">{fmtMoney(i.lineTotal)}</span>,
            },
          ]}
        />
      </Card>

      {/* ── Two-column bottom: linked orders + audit trail ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>
                <span className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-accent" />
                  Linked orders
                </span>
              </CardTitle>
              <CardDescription>
                Builder orders waiting on material from this PO.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {po.linkedOrders.length === 0 ? (
              <div className="text-center py-8 text-xs text-fg-subtle">
                No linked builder orders.
              </div>
            ) : (
              <div className="space-y-1.5">
                {po.linkedOrders.map((o) => (
                  <Link
                    key={o.orderId}
                    href={`/ops/orders/${o.orderId}`}
                    className="panel panel-interactive flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-fg truncate">
                          {o.orderNumber}
                        </span>
                        <StatusBadge status={o.orderStatus} size="xs" />
                      </div>
                      <div className="text-[11px] text-fg-muted truncate mt-0.5">
                        {o.builderName ?? '—'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="tabular-nums text-sm font-semibold text-fg">
                        {fmtMoneyCompact(o.orderTotal)}
                      </div>
                    </div>
                    <ExternalLink className="w-3 h-3 text-fg-subtle shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>Audit trail</CardTitle>
              <CardDescription>Last 10 events on this PO.</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {po.auditTrail.length === 0 ? (
              <div className="text-center py-8 text-xs text-fg-subtle">No audit entries.</div>
            ) : (
              <div className="space-y-2">
                {po.auditTrail.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 text-xs">
                    <Avatar
                      name={`${a.staffFirstName ?? ''} ${a.staffLastName ?? ''}`.trim() || 'System'}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-fg">
                          {`${a.staffFirstName ?? ''} ${a.staffLastName ?? ''}`.trim() || 'System'}
                        </span>
                        <span className="font-mono text-[10px] uppercase text-fg-subtle">
                          {a.action}
                        </span>
                        {a.severity && a.severity !== 'INFO' && (
                          <Badge variant="warning" size="xs">
                            {a.severity}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-fg-muted tabular-nums">
                        {new Date(a.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Receive dialog ─────────────────────────────────────────── */}
      <Dialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title="Receive PO"
        description="Fill the full remaining quantity, or edit per-line. Flag short-ship if anything is missing."
        size="lg"
        footer={
          <>
            <button
              onClick={() => setReceiveOpen(false)}
              className="btn btn-ghost btn-sm"
              disabled={actionLoading === 'receive'}
            >
              Cancel
            </button>
            <button
              onClick={submitReceive}
              className="btn btn-success btn-sm"
              disabled={actionLoading === 'receive'}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {actionLoading === 'receive' ? 'Receiving…' : 'Confirm receive'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {remainingItems.length === 0 ? (
            <EmptyState
              icon="package"
              title="All lines received"
              description="No remaining quantity on this PO."
              size="default"
            />
          ) : (
            <>
              <div className="space-y-2">
                {remainingItems.map((i) => {
                  const remaining = i.quantity - (i.receivedQty ?? 0)
                  const draft = receiveDraft[i.id] ?? remaining
                  return (
                    <div
                      key={i.id}
                      className="panel p-3 flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-fg truncate">
                          {i.productName ?? i.description}
                        </div>
                        <div className="text-[11px] text-fg-subtle font-mono">
                          {i.productSku ?? i.vendorSku}
                        </div>
                      </div>
                      <div className="text-[11px] text-fg-muted tabular-nums">
                        {i.receivedQty}/{i.quantity} recv
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        value={draft}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          setReceiveDraft((d) => ({
                            ...d,
                            [i.id]: Number.isFinite(v) ? v : 0,
                          }))
                        }}
                        className="input w-20 text-right tabular-nums"
                      />
                    </div>
                  )
                })}
              </div>
              <label className="flex items-center gap-2 text-sm text-fg select-none pt-2">
                <input
                  type="checkbox"
                  checked={shortShipFlag}
                  onChange={(e) => setShortShipFlag(e.target.checked)}
                />
                <span>Flag short-ship — add a dated note to the PO.</span>
              </label>
            </>
          )}
        </div>
      </Dialog>

      {/* ── Send dialog ────────────────────────────────────────────── */}
      <Dialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send PO to vendor"
        description="Emails the PO HTML via Resend. If the PO is in Draft, it will also transition to Sent."
        size="md"
        footer={
          <>
            <button
              onClick={() => setSendOpen(false)}
              className="btn btn-ghost btn-sm"
              disabled={actionLoading === 'send-email'}
            >
              Cancel
            </button>
            <button
              onClick={sendEmail}
              className="btn btn-primary btn-sm"
              disabled={actionLoading === 'send-email' || !sendTo}
            >
              <Mail className="w-3.5 h-3.5" />
              {actionLoading === 'send-email' ? 'Sending…' : 'Send'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="eyebrow">Recipient</span>
            <input
              type="email"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="vendor@example.com"
              className="input w-full mt-1"
            />
          </label>
          <p className="text-xs text-fg-muted">
            Defaults to the vendor&apos;s email on file. Override to send to any address.
          </p>
        </div>
      </Dialog>

      {/* Document attachments — FIX-1 from AEGIS-OPS-FINANCE-HANDOFF */}
      <div className="bg-white rounded-lg shadow-sm border p-5 mt-6">
        <DocumentAttachments
          entityType="purchaseOrder"
          entityId={po.id}
          defaultCategory="PURCHASE_ORDER"
          allowedCategories={['PURCHASE_ORDER', 'INVOICE', 'CONTRACT', 'CORRESPONDENCE', 'GENERAL']}
        />
      </div>
    </div>
  )
}

// ── Small helpers ────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-muted">{label}</span>
      <span
        className={cn(
          'text-fg truncate max-w-[60%] text-right',
          mono && 'font-mono text-[11px]',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="text-sm font-medium text-fg mt-0.5 truncate">{value}</div>
    </div>
  )
}

/**
 * FIX-4 — Inline-editable date cell. Behaves like Meta when not editable, and
 * shows a small "edit" affordance + date picker when editable. Calls onSave
 * with an ISO yyyy-mm-dd string (or null when cleared). The PATCH endpoint
 * normalizes the date to a Postgres timestamp.
 */
function EditableDateCell({
  label,
  value,
  editable,
  onSave,
}: {
  label: string
  value: string | null | undefined
  editable: boolean
  onSave: (date: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(() =>
    value ? new Date(value).toISOString().slice(0, 10) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset draft when the underlying value changes server-side.
  useEffect(() => {
    setDraft(value ? new Date(value).toISOString().slice(0, 10) : '')
  }, [value])

  const formatted = value
    ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  if (!editable) {
    return (
      <div>
        <div className="eyebrow">{label}</div>
        <div className="text-sm font-medium text-fg mt-0.5 truncate">{formatted}</div>
      </div>
    )
  }

  if (!editing) {
    return (
      <div>
        <div className="eyebrow flex items-center gap-1">
          {label}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-fg-subtle hover:text-fg transition-colors"
            title="Edit"
            aria-label={`Edit ${label}`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        </div>
        <div className="text-sm font-medium text-fg mt-0.5 truncate">{formatted}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
          className="input input-sm w-full text-xs"
          autoFocus
        />
        <button
          type="button"
          onClick={async () => {
            setError(null)
            setSaving(true)
            try {
              await onSave(draft || null)
              setEditing(false)
            } catch (e: any) {
              setError(e?.message || 'Save failed')
            } finally {
              setSaving(false)
            }
          }}
          disabled={saving}
          className="btn btn-primary btn-xs shrink-0"
          title="Save"
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(value ? new Date(value).toISOString().slice(0, 10) : '')
            setEditing(false)
            setError(null)
          }}
          disabled={saving}
          className="btn btn-secondary btn-xs shrink-0"
          title="Cancel"
        >
          ✕
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-data-negative mt-1 truncate" title={error}>
          {error}
        </div>
      )}
    </div>
  )
}
