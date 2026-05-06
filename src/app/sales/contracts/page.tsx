'use client'

/**
 * /sales/contracts — Contract Management
 *
 * Audit item A-UX-11. Mirrors the KPI-strip + filter-row + table pattern
 * established by /ops/payments. Backed by:
 *   GET  /api/ops/sales/contracts            — list with filters
 *   POST /api/ops/sales/contracts            — create new contract
 *   GET  /api/ops/builders                   — builder picker
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  FileText,
  AlarmClock,
  CheckCircle2,
  CircleDashed,
  Search,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

const STATUSES = [
  'DRAFT',
  'INTERNAL_REVIEW',
  'SENT',
  'BUILDER_REVIEW',
  'REVISION_REQUESTED',
  'SIGNED',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
] as const

const CONTRACT_TYPES = [
  'SUPPLY_AGREEMENT',
  'MASTER_SERVICE',
  'PRICING_AGREEMENT',
  'NDA',
  'CREDIT_APPLICATION',
] as const

const PAYMENT_TERMS = ['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30'] as const

type Status = (typeof STATUSES)[number]

interface Contract {
  id: string
  contractNumber: string
  title: string
  type: string
  status: Status
  dealId: string | null
  builderId: string | null
  paymentTerm: string | null
  creditLimit: number | null
  estimatedAnnual: number | null
  discountPercent: number | null
  startDate: string | null
  endDate: string | null
  expiresDate: string | null
  signedDate: string | null
  createdAt: string
  deal?: { id: string; companyName?: string; dealNumber?: string } | null
  createdBy?: { id?: string; firstName?: string; lastName?: string } | null
}

interface Builder {
  id: string
  companyName: string
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadge(s: Status): string {
  switch (s) {
    case 'ACTIVE':
    case 'SIGNED':
      return 'bg-green-100 text-green-700'
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700'
    case 'INTERNAL_REVIEW':
    case 'BUILDER_REVIEW':
      return 'bg-blue-100 text-blue-700'
    case 'SENT':
      return 'bg-indigo-100 text-indigo-700'
    case 'REVISION_REQUESTED':
      return 'bg-amber-100 text-amber-700'
    case 'EXPIRED':
      return 'bg-orange-100 text-orange-700'
    case 'TERMINATED':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function contractTotalValue(c: Contract): number {
  // Best signal we have on the model: estimatedAnnual rolled across contract
  // term length when available, otherwise just estimatedAnnual. Falls back
  // to creditLimit if no annual figure was captured.
  if (c.estimatedAnnual != null) {
    if (c.startDate && (c.endDate || c.expiresDate)) {
      const start = new Date(c.startDate).getTime()
      const end = new Date((c.endDate || c.expiresDate)!).getTime()
      const years = Math.max(1, (end - start) / (365 * 24 * 60 * 60 * 1000))
      return c.estimatedAnnual * years
    }
    return c.estimatedAnnual
  }
  return c.creditLimit ?? 0
}

function expiryDate(c: Contract): string | null {
  return c.expiresDate || c.endDate
}

function isExpiringSoon(c: Contract, withinDays = 30): boolean {
  const exp = expiryDate(c)
  if (!exp) return false
  const t = new Date(exp).getTime()
  const now = Date.now()
  const diff = (t - now) / (24 * 60 * 60 * 1000)
  return diff >= 0 && diff <= withinDays
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [builders, setBuilders] = useState<Builder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [builderFilter, setBuilderFilter] = useState<string>('')
  const [expiringSoon, setExpiringSoon] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')

  const [showCreate, setShowCreate] = useState(false)

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (builderFilter) params.set('builderId', builderFilter)
      params.set('limit', '200')
      const res = await fetch(`/api/ops/sales/contracts?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setContracts(data.contracts || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load contracts')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, builderFilter])

  const fetchBuilders = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/builders?limit=500')
      if (res.ok) {
        const data = await res.json()
        // /api/ops/builders returns { builders: [...] }
        const list: Builder[] = (data.builders || data || []).map((b: any) => ({
          id: b.id,
          companyName: b.companyName,
        }))
        setBuilders(list)
      }
    } catch {
      // builder picker is non-blocking
    }
  }, [])

  useEffect(() => {
    fetchContracts()
  }, [fetchContracts])

  useEffect(() => {
    fetchBuilders()
  }, [fetchBuilders])

  const filtered = useMemo(() => {
    let rows = contracts
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (c) =>
          c.contractNumber.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          (c.deal?.companyName || '').toLowerCase().includes(q),
      )
    }
    if (expiringSoon) {
      rows = rows.filter((c) => isExpiringSoon(c, 30))
    }
    return rows
  }, [contracts, search, expiringSoon])

  // KPIs over the *unfiltered* list — gives a sense of the whole book
  const kpis = useMemo(() => {
    const active = contracts.filter((c) => c.status === 'ACTIVE' || c.status === 'SIGNED')
    const expiringIn30 = contracts.filter((c) => isExpiringSoon(c, 30))
    const draft = contracts.filter((c) => c.status === 'DRAFT' || c.status === 'INTERNAL_REVIEW')
    const totalActiveValue = active.reduce((s, c) => s + contractTotalValue(c), 0)
    return {
      total: contracts.length,
      active: active.length,
      expiring30: expiringIn30.length,
      draft: draft.length,
      totalActiveValue,
    }
  }, [contracts])

  const totalForFiltered = filtered.reduce((s, c) => s + contractTotalValue(c), 0)
  const builderName = (id: string | null) =>
    id ? builders.find((b) => b.id === id)?.companyName || 'Unknown' : '—'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title="Contracts"
        description="Supply agreements, MSAs, pricing agreements — track every contract through its life cycle."
        crumbs={[{ label: 'Sales', href: '/sales' }, { label: 'Contracts' }]}
        actions={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="btn btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> New Contract
          </button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          icon={<CheckCircle2 className="w-4 h-4 text-data-positive" />}
          label="Active"
          value={String(kpis.active)}
          sub={formatCurrency(kpis.totalActiveValue) + ' est. value'}
        />
        <KPI
          icon={<AlarmClock className="w-4 h-4 text-data-warning" />}
          label="Expiring (30d)"
          value={String(kpis.expiring30)}
          sub={kpis.expiring30 === 1 ? 'contract' : 'contracts'}
          valueClassName={kpis.expiring30 > 0 ? 'text-data-warning' : undefined}
        />
        <KPI
          icon={<CircleDashed className="w-4 h-4 text-fg-muted" />}
          label="Draft / Review"
          value={String(kpis.draft)}
          sub="not yet sent"
        />
        <KPI
          icon={<FileText className="w-4 h-4 text-fg-muted" />}
          label="Total"
          value={String(kpis.total)}
          sub="all contracts"
        />
      </div>

      {/* Filter row */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by contract #, title, builder…"
              className="input pl-9 w-full"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input min-w-[140px]"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            value={builderFilter}
            onChange={(e) => setBuilderFilter(e.target.value)}
            className="input min-w-[160px]"
          >
            <option value="">All builders</option>
            {builders.map((b) => (
              <option key={b.id} value={b.id}>
                {b.companyName}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
            <input
              type="checkbox"
              checked={expiringSoon}
              onChange={(e) => setExpiringSoon(e.target.checked)}
              className="rounded"
            />
            Expiring soon (30d)
          </label>
          {(statusFilter || builderFilter || expiringSoon || search) && (
            <button
              onClick={() => {
                setStatusFilter('')
                setBuilderFilter('')
                setExpiringSoon(false)
                setSearch('')
              }}
              className="text-xs text-fg-subtle hover:text-fg"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => fetchContracts()}
            className="btn btn-ghost btn-xs ml-auto"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="text-xs text-fg-muted">
          {filtered.length} contract{filtered.length === 1 ? '' : 's'}
          {' · '}
          <span className="text-fg font-semibold tabular-nums">
            {formatCurrency(totalForFiltered)}
          </span>
          {' total est. value'}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading contracts…
        </div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-data-negative/30 p-4 text-sm text-data-negative">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          No contracts match the current filters.
        </div>
      ) : (
        <ContractsTable rows={filtered} builderName={builderName} />
      )}

      {showCreate && (
        <NewContractModal
          builders={builders}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false)
            fetchContracts()
          }}
        />
      )}
    </div>
  )
}

function ContractsTable({
  rows,
  builderName,
}: {
  rows: Contract[]
  builderName: (id: string | null) => string
}) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted border-b border-border">
          <tr>
            <Th>Contract #</Th>
            <Th>Title</Th>
            <Th>Builder / Deal</Th>
            <Th>Effective</Th>
            <Th>Expires</Th>
            <Th>Status</Th>
            <Th align="right">Total Value</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => {
            const exp = expiryDate(c)
            const expiring = isExpiringSoon(c, 30)
            return (
              <tr key={c.id} className="hover:bg-surface-muted/40">
                <Td>
                  <Link
                    href={`/sales/contracts/${c.id}`}
                    className="font-mono text-brand hover:underline"
                  >
                    {c.contractNumber}
                  </Link>
                </Td>
                <Td>
                  <span className="text-fg">{c.title}</span>
                  <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    {c.type.replace(/_/g, ' ')}
                  </div>
                </Td>
                <Td>
                  {c.deal?.companyName || builderName(c.builderId)}
                  {c.deal?.dealNumber && (
                    <div className="text-[10px] text-fg-subtle font-mono">
                      {c.deal.dealNumber}
                    </div>
                  )}
                </Td>
                <Td>{formatDate(c.startDate)}</Td>
                <Td>
                  <span className={expiring ? 'text-data-warning font-medium' : ''}>
                    {formatDate(exp)}
                  </span>
                </Td>
                <Td>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusBadge(
                      c.status,
                    )}`}
                  >
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(contractTotalValue(c))}
                  </span>
                </Td>
                <Td align="right">
                  <Link
                    href={`/sales/contracts/${c.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    View
                  </Link>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function KPI({
  icon,
  label,
  value,
  sub,
  valueClassName,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  valueClassName?: string
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-fg-muted uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClassName || 'text-fg'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-fg-subtle mt-1">{sub}</div>}
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-4 py-2 text-[11px] font-semibold text-fg-muted uppercase tracking-wider ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td className={`px-4 py-2 align-top ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────
// New Contract modal
// ─────────────────────────────────────────────────────────────────────
function NewContractModal({
  builders,
  onClose,
  onSuccess,
}: {
  builders: Builder[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [title, setTitle] = useState('')
  const [builderId, setBuilderId] = useState('')
  const [type, setType] = useState<(typeof CONTRACT_TYPES)[number]>('SUPPLY_AGREEMENT')
  const [paymentTerm, setPaymentTerm] = useState<(typeof PAYMENT_TERMS)[number]>('NET_30')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [estimatedAnnual, setEstimatedAnnual] = useState('')
  const [discountPercent, setDiscountPercent] = useState('')
  const [terms, setTerms] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !builderId) {
      setErr('Title and builder are required.')
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch('/api/ops/sales/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          builderId,
          type,
          paymentTerm,
          startDate: startDate || null,
          endDate: endDate || null,
          estimatedAnnual: estimatedAnnual ? parseFloat(estimatedAnnual) : null,
          discountPercent: discountPercent ? parseFloat(discountPercent) : null,
          terms: terms || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onSuccess()
    } catch (e: any) {
      setErr(e?.message || 'Failed to create contract')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-fg">New Contract</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" type="button">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && (
            <div className="bg-data-negative-bg text-data-negative text-sm rounded p-2 border border-data-negative/30">
              {err}
            </div>
          )}
          <Field label="Title *">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input w-full"
              placeholder="e.g. 2026 Supply Agreement — Brookfield"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Builder *">
              <select
                value={builderId}
                onChange={(e) => setBuilderId(e.target.value)}
                className="input w-full"
                required
              >
                <option value="">Select a builder…</option>
                {builders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.companyName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="input w-full"
              >
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective from">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input w-full"
              />
            </Field>
            <Field label="Expires">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input w-full"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Payment term">
              <select
                value={paymentTerm}
                onChange={(e) => setPaymentTerm(e.target.value as any)}
                className="input w-full"
              >
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Est. annual ($)">
              <input
                type="number"
                step="0.01"
                value={estimatedAnnual}
                onChange={(e) => setEstimatedAnnual(e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </Field>
            <Field label="Discount (%)">
              <input
                type="number"
                step="0.01"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </Field>
          </div>
          <Field label="Pricing terms / notes">
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="input w-full min-h-[100px]"
              placeholder="Pricing schedule, special clauses, rebate structure…"
            />
          </Field>
          <div className="text-xs text-fg-subtle border-t border-border pt-3">
            Document attachments (signed PDF, addenda) can be uploaded on the contract detail
            page after creation.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn btn-primary btn-sm">
              {submitting ? 'Creating…' : 'Create Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-fg-muted font-medium mb-1 block">{label}</span>
      {children}
    </label>
  )
}
