'use client'

/**
 * Builder Portal — Warranty client.
 *
 * §4.11 Warranty. v1 stub per spec — basic CRUD: list of claims, "New
 * Claim" button → form (subject, type, description, product fields,
 * site address, contact info), submit → POST /api/builders/warranty.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileWarning,
  Plus,
  Shield,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { usePortal } from '@/components/portal/PortalContext'

export interface WarrantyClaim {
  id: string
  claimNumber: string
  type: string
  status: string
  priority: string
  subject: string
  description: string
  productName: string | null
  resolutionType: string | null
  resolutionNotes: string | null
  creditAmount: number | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface WarrantyPolicy {
  id: string
  name: string
  type: string
  category: string | null
  durationMonths: number | null
  coverageDetails: string | null
  exclusions: string | null
  claimProcess: string | null
}

const STATUS_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  SUBMITTED:   { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Submitted' },
  IN_REVIEW:   { bg: 'rgba(212,165,74,0.16)',  fg: '#7A5413', label: 'In Review' },
  APPROVED:    { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Approved' },
  REJECTED:    { bg: 'rgba(110,42,36,0.10)',   fg: '#7E2417', label: 'Rejected' },
  RESOLVED:    { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Resolved' },
  CLOSED:      { bg: 'rgba(107,96,86,0.12)',   fg: '#5A4F46', label: 'Closed' },
  WAITING_INFO:{ bg: 'rgba(184,135,107,0.16)', fg: '#7A5A45', label: 'Waiting' },
}

const PRIORITY_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  LOW:    { bg: 'rgba(107,96,86,0.12)', fg: '#5A4F46', label: 'Low' },
  MEDIUM: { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Medium' },
  HIGH:   { bg: 'rgba(212,165,74,0.16)', fg: '#7A5413', label: 'High' },
  URGENT: { bg: 'rgba(110,42,36,0.10)', fg: '#7E2417', label: 'Urgent' },
}

const TYPE_OPTIONS = [
  { value: 'PRODUCT_DEFECT', label: 'Product defect' },
  { value: 'INSTALLATION', label: 'Installation issue' },
  { value: 'WARRANTY', label: 'Warranty repair' },
  { value: 'DAMAGE', label: 'Damage / cosmetic' },
  { value: 'MISSING_PARTS', label: 'Missing parts' },
  { value: 'OTHER', label: 'Other' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

interface FormState {
  type: string
  subject: string
  description: string
  productName: string
  productSku: string
  installDate: string
  issueDate: string
  contactName: string
  contactEmail: string
  contactPhone: string
  siteAddress: string
  siteCity: string
  siteState: string
  siteZip: string
  policyId: string
}

const EMPTY_FORM: FormState = {
  type: 'PRODUCT_DEFECT',
  subject: '',
  description: '',
  productName: '',
  productSku: '',
  installDate: '',
  issueDate: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  siteAddress: '',
  siteCity: '',
  siteState: '',
  siteZip: '',
  policyId: '',
}

export function WarrantyClient({
  claims,
  policies,
}: {
  claims: WarrantyClaim[]
  policies: WarrantyPolicy[]
}) {
  const router = useRouter()
  const { builder } = usePortal()
  const [showForm, setShowForm] = useState(claims.length === 0)
  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    contactEmail: builder.email,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function update(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.subject.trim() || !form.description.trim() || !form.type) {
      setError('Subject, description, and type are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/builders/warranty', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          subject: form.subject.trim(),
          description: form.description.trim(),
          productName: form.productName.trim() || undefined,
          productSku: form.productSku.trim() || undefined,
          installDate: form.installDate || undefined,
          issueDate: form.issueDate || undefined,
          contactName: form.contactName.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          siteAddress: form.siteAddress.trim() || undefined,
          siteCity: form.siteCity.trim() || undefined,
          siteState: form.siteState.trim() || undefined,
          siteZip: form.siteZip.trim() || undefined,
          policyId: form.policyId || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to submit claim')
      }
      const data = await res.json()
      setSuccess(`Claim ${data.claimNumber} submitted. We'll be in touch.`)
      setForm({ ...EMPTY_FORM, contactEmail: builder.email })
      setShowForm(false)
      router.refresh()
      setTimeout(() => setSuccess(null), 8_000)
    } catch (err: any) {
      setError(err?.message || 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="portal-eyebrow mb-2">Service & Returns</div>
          <h1 className="portal-page-title">Warranty &amp; Claims</h1>
          <p
            className="text-[15px] mt-2"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            File a claim for damaged goods, missing parts, or warranty
            repairs.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
            style={{
              background:
                'var(--grad)',
              color: 'white',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Claim
          </button>
        )}
      </div>

      {/* Success banner */}
      {success && (
        <div
          className="px-4 py-3 rounded-md text-sm flex items-center gap-2"
          style={{
            background: 'rgba(56,128,77,0.10)',
            border: '1px solid rgba(56,128,77,0.3)',
            color: '#1A4B21',
          }}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="ml-auto p-0.5 rounded hover:bg-white/50"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <PortalCard
          title="File a Claim"
          subtitle="Provide as much detail as you can — it speeds resolution."
          action={
            claims.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setError(null)
                }}
                className="p-1 rounded hover:bg-[var(--portal-bg-elevated)]"
                aria-label="Cancel"
              >
                <X
                  className="w-4 h-4"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                />
              </button>
            ) : undefined
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Type" required>
                <select
                  value={form.type}
                  onChange={(e) => update('type', e.target.value)}
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              {policies.length > 0 && (
                <Field label="Linked Policy (optional)">
                  <select
                    value={form.policyId}
                    onChange={(e) => update('policyId', e.target.value)}
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  >
                    <option value="">— None —</option>
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <Field label="Subject" required>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => update('subject', e.target.value)}
                placeholder="Short summary, e.g. 'Cracked door panel — Lot 42'"
                className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
            </Field>

            <Field label="Description" required>
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={4}
                placeholder="What happened? When was the issue discovered? Photos can be sent later — for now, just write what you'd tell the project manager."
                className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30 resize-y"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Product Name">
                <input
                  type="text"
                  value={form.productName}
                  onChange={(e) => update('productName', e.target.value)}
                  placeholder="e.g. ADT 3068 RH Interior Door"
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
              <Field label="Product SKU">
                <input
                  type="text"
                  value={form.productSku}
                  onChange={(e) => update('productSku', e.target.value)}
                  placeholder="e.g. BC004010"
                  className="h-10 w-full px-3 font-mono text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
              <Field label="Install Date">
                <input
                  type="date"
                  value={form.installDate}
                  onChange={(e) => update('installDate', e.target.value)}
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
              <Field label="Issue Discovered">
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => update('issueDate', e.target.value)}
                  className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
              </Field>
            </div>

            <details className="space-y-3">
              <summary
                className="cursor-pointer text-xs font-medium"
                style={{ color: 'var(--c1)' }}
              >
                Site address & contact (optional)
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                <Field label="Site Address">
                  <input
                    type="text"
                    value={form.siteAddress}
                    onChange={(e) => update('siteAddress', e.target.value)}
                    placeholder="123 Main St"
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="City">
                    <input
                      type="text"
                      value={form.siteCity}
                      onChange={(e) => update('siteCity', e.target.value)}
                      className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                      style={{
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                      }}
                    />
                  </Field>
                  <Field label="State / Zip">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={form.siteState}
                        onChange={(e) => update('siteState', e.target.value)}
                        maxLength={2}
                        placeholder="TX"
                        className="h-10 w-12 px-2 text-center text-sm rounded-md uppercase focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                        style={{
                          background: 'var(--portal-bg-card, #FFFFFF)',
                          border: '1px solid var(--portal-border, #E8DFD0)',
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      />
                      <input
                        type="text"
                        value={form.siteZip}
                        onChange={(e) => update('siteZip', e.target.value)}
                        maxLength={10}
                        placeholder="75024"
                        className="h-10 flex-1 px-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                        style={{
                          background: 'var(--portal-bg-card, #FFFFFF)',
                          border: '1px solid var(--portal-border, #E8DFD0)',
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      />
                    </div>
                  </Field>
                </div>
                <Field label="Contact Name">
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => update('contactName', e.target.value)}
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
                <Field label="Contact Phone">
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => update('contactPhone', e.target.value)}
                    placeholder="(214) 555-0100"
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
                <Field label="Contact Email" className="md:col-span-2">
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => update('contactEmail', e.target.value)}
                    className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong, #3E2A1E)',
                    }}
                  />
                </Field>
              </div>
            </details>

            {error && (
              <div
                className="px-3 py-2 rounded-md text-sm flex items-start gap-2"
                style={{
                  background: 'rgba(110,42,36,0.08)',
                  color: '#7E2417',
                }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              {claims.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 h-9 rounded-md text-sm font-medium transition-colors"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-5 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-60"
                style={{
                  background:
                    'var(--grad)',
                  color: 'white',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {submitting ? 'Submitting…' : 'Submit Claim'}
              </button>
            </div>
          </form>
        </PortalCard>
      )}

      {/* Claims list */}
      <PortalCard
        title="Your Claims"
        subtitle={
          claims.length > 0
            ? `${claims.length} claim${claims.length === 1 ? '' : 's'} on file`
            : 'No claims filed yet'
        }
        noBodyPadding
      >
        {claims.length === 0 ? (
          <div
            className="px-6 py-16 text-center text-sm"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Shield
              className="w-10 h-10 mx-auto mb-3 opacity-30"
              aria-hidden="true"
            />
            <p
              className="text-base font-medium"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              No claims yet
            </p>
            <p className="text-sm mt-1 max-w-sm mx-auto">
              Hopefully you don&apos;t need this. But when you do, file fast and
              we&apos;ll get on it.
            </p>
          </div>
        ) : (
          <ul>
            {claims.map((c) => {
              const expanded = expandedId === c.id
              const status = STATUS_BADGE[c.status] || STATUS_BADGE.SUBMITTED
              const priority =
                PRIORITY_BADGE[c.priority] || PRIORITY_BADGE.MEDIUM
              return (
                <li
                  key={c.id}
                  className="border-t"
                  style={{ borderColor: 'var(--portal-border-light, #F0E8DA)' }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                    className="w-full text-left px-4 md:px-6 py-3 flex items-center gap-3 transition-colors hover:bg-[var(--portal-bg-elevated)]"
                  >
                    <div
                      className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center"
                      style={{
                        background: 'rgba(110,42,36,0.08)',
                        color: '#7E2417',
                      }}
                    >
                      <FileWarning className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                          className="font-mono text-xs font-medium"
                          style={{
                            color: 'var(--portal-text-strong, #3E2A1E)',
                          }}
                        >
                          {c.claimNumber}
                        </span>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: status.bg, color: status.fg }}
                        >
                          {status.label}
                        </span>
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                          style={{
                            background: priority.bg,
                            color: priority.fg,
                          }}
                        >
                          {priority.label}
                        </span>
                      </div>
                      <div
                        className="text-xs mt-0.5 truncate"
                        style={{
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      >
                        {c.subject}
                      </div>
                      <div
                        className="text-[11px] mt-0.5"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      >
                        Filed {fmtDate(c.createdAt)}
                        {c.resolvedAt && (
                          <> · Resolved {fmtDate(c.resolvedAt)}</>
                        )}
                      </div>
                    </div>
                    {expanded ? (
                      <ChevronUp
                        className="w-4 h-4 shrink-0"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      />
                    ) : (
                      <ChevronDown
                        className="w-4 h-4 shrink-0"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      />
                    )}
                  </button>
                  {expanded && (
                    <div
                      className="px-4 md:px-6 py-4 space-y-3"
                      style={{
                        background: 'var(--portal-bg-elevated, #FAF5E8)',
                      }}
                    >
                      {c.productName && (
                        <Detail
                          label="Product"
                          value={c.productName}
                        />
                      )}
                      <Detail
                        label="Description"
                        value={c.description}
                        multiline
                      />
                      {c.resolutionNotes && (
                        <Detail
                          label="Resolution"
                          value={c.resolutionNotes}
                          multiline
                          accent
                        />
                      )}
                      {c.creditAmount != null && c.creditAmount > 0 && (
                        <Detail
                          label="Credit Issued"
                          value={`$${c.creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          accent
                        />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PortalCard>
    </div>
  )
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label
        className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
        style={{ color: 'var(--portal-text-subtle)' }}
      >
        {label} {required && <span style={{ color: '#7E2417' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function Detail({
  label,
  value,
  multiline,
  accent,
}: {
  label: string
  value: string
  multiline?: boolean
  accent?: boolean
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider font-semibold mb-1"
        style={{ color: 'var(--portal-text-subtle)' }}
      >
        {label}
      </div>
      <div
        className={`text-sm ${multiline ? 'whitespace-pre-line leading-relaxed' : ''}`}
        style={{
          color: accent
            ? 'var(--portal-success, #1A4B21)'
            : 'var(--portal-text, #2C2C2C)',
        }}
      >
        {value}
      </div>
    </div>
  )
}
