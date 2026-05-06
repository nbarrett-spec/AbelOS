'use client'

/**
 * /sales/contracts/[id] — Contract detail
 *
 * Companion to /sales/contracts (audit item A-UX-11). Shows the contract
 * header + financial terms + an inline document drop zone. Uses the
 * generic entityType=contract path on DocumentVault since the model has
 * no dedicated FK column.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import DocumentAttachments from '@/components/ops/DocumentAttachments'

interface Contract {
  id: string
  contractNumber: string
  title: string
  type: string
  status: string
  builderId: string | null
  dealId: string | null
  paymentTerm: string | null
  creditLimit: number | null
  estimatedAnnual: number | null
  discountPercent: number | null
  terms: string | null
  specialClauses: string | null
  startDate: string | null
  endDate: string | null
  expiresDate: string | null
  signedDate: string | null
  sentDate: string | null
  documentUrl: string | null
  createdAt: string
  updatedAt: string
  deal?: { id: string; companyName?: string; dealNumber?: string } | null
  createdBy?: { id?: string; firstName?: string; lastName?: string } | null
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadge(s: string): string {
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

const STATUS_OPTIONS = [
  'DRAFT',
  'INTERNAL_REVIEW',
  'SENT',
  'BUILDER_REVIEW',
  'REVISION_REQUESTED',
  'SIGNED',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
]

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [contract, setContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [builderName, setBuilderName] = useState<string | null>(null)

  const fetchContract = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/sales/contracts/${id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setContract(data)

      // Hydrate builder name if we only have the FK
      if (data.builderId && !data.deal?.companyName) {
        try {
          const bRes = await fetch(`/api/ops/builders?limit=500`)
          if (bRes.ok) {
            const bData = await bRes.json()
            const list: any[] = bData.builders || []
            const match = list.find((b) => b.id === data.builderId)
            if (match) setBuilderName(match.companyName)
          }
        } catch {
          // non-blocking
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load contract')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchContract()
  }, [fetchContract])

  const updateStatus = async (newStatus: string) => {
    if (!contract) return
    setSavingStatus(true)
    try {
      const res = await fetch(`/api/ops/sales/contracts/${contract.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        const updated = await res.json()
        setContract((c) => (c ? { ...c, ...updated } : c))
      }
    } finally {
      setSavingStatus(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
        Loading contract…
      </div>
    )
  }
  if (error || !contract) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Contract"
          crumbs={[
            { label: 'Sales', href: '/sales' },
            { label: 'Contracts', href: '/sales/contracts' },
            { label: 'Not found' },
          ]}
        />
        <div className="bg-white rounded-lg border border-data-negative/30 p-4 text-sm text-data-negative">
          {error || 'Contract not found.'}
        </div>
      </div>
    )
  }

  const counterparty = contract.deal?.companyName || builderName || '—'
  const expiry = contract.expiresDate || contract.endDate

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title={contract.title}
        description={`${contract.contractNumber} · ${contract.type.replace(/_/g, ' ')}`}
        crumbs={[
          { label: 'Sales', href: '/sales' },
          { label: 'Contracts', href: '/sales/contracts' },
          { label: contract.contractNumber },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusBadge(
                contract.status,
              )}`}
            >
              {contract.status.replace(/_/g, ' ')}
            </span>
            <select
              value={contract.status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={savingStatus}
              className="input input-sm"
              title="Change status"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/* Summary grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card label="Counterparty">
          <div className="text-fg font-medium">{counterparty}</div>
          {contract.deal?.dealNumber && (
            <Link
              href={`/sales/deals/${contract.dealId}`}
              className="text-[11px] font-mono text-brand hover:underline"
            >
              {contract.deal.dealNumber}
            </Link>
          )}
        </Card>
        <Card label="Effective">
          <div className="text-fg font-medium">{formatDate(contract.startDate)}</div>
        </Card>
        <Card label="Expires">
          <div className="text-fg font-medium">{formatDate(expiry)}</div>
        </Card>
      </div>

      {/* Financial terms */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-fg mb-3">Financial terms</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Payment term" value={(contract.paymentTerm || '—').replace(/_/g, ' ')} />
          <Stat label="Est. annual" value={formatCurrency(contract.estimatedAnnual)} />
          <Stat label="Discount" value={contract.discountPercent != null ? `${contract.discountPercent}%` : '—'} />
          <Stat label="Credit limit" value={formatCurrency(contract.creditLimit)} />
        </div>
        {contract.terms && (
          <div className="mt-4">
            <div className="text-xs text-fg-muted uppercase tracking-wider font-medium mb-1">
              Terms
            </div>
            <div className="text-sm text-fg whitespace-pre-wrap bg-surface-muted rounded p-3 border border-border">
              {contract.terms}
            </div>
          </div>
        )}
        {contract.specialClauses && (
          <div className="mt-3">
            <div className="text-xs text-fg-muted uppercase tracking-wider font-medium mb-1">
              Special clauses
            </div>
            <div className="text-sm text-fg whitespace-pre-wrap bg-surface-muted rounded p-3 border border-border">
              {contract.specialClauses}
            </div>
          </div>
        )}
      </div>

      {/* Lifecycle dates */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-fg mb-3">Lifecycle</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Created" value={formatDate(contract.createdAt)} />
          <Stat label="Sent" value={formatDate(contract.sentDate)} />
          <Stat label="Signed" value={formatDate(contract.signedDate)} />
          <Stat label="Updated" value={formatDate(contract.updatedAt)} />
        </div>
      </div>

      {/* Documents */}
      <div className="bg-white rounded-lg border p-5">
        <DocumentAttachments
          entityType="contract"
          entityId={contract.id}
          defaultCategory="CONTRACT"
          allowedCategories={['CONTRACT', 'CORRESPONDENCE', 'REPORT', 'GENERAL']}
          title="Contract documents"
        />
      </div>
    </div>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="text-xs text-fg-muted uppercase tracking-wider font-medium mb-1">
        {label}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fg-muted uppercase tracking-wider font-medium">{label}</div>
      <div className="text-sm text-fg font-medium tabular-nums mt-0.5">{value}</div>
    </div>
  )
}
