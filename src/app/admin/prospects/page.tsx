// /admin/prospects — list view of enriched Prospects.
//
// READ + light-action only. The enrichment cron triggers generation; this
// page just shows what came back and exposes a manual "Re-enrich" button
// (POSTs to the route Agent A built at /api/admin/prospects/[id]/enrich).
//
// Scope:
//   - Filter by enrichment confidence (CONFIRMED / LIKELY / UNVERIFIED / Not enriched)
//   - Search company / contact / domain / founder
//   - 50 rows per page; offset pagination
//   - Re-enrich button per row → toast on success

'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Search, RefreshCw, ExternalLink, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface Prospect {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string
  domain: string | null
  founderName: string | null
  emailPattern: string | null
  enrichmentRunAt: string | null
  enrichmentConfidence: string | null
  enrichmentSourceUrls: string[] | null
  bouncedAt: string | null
  icpTier: string | null
  estimatedAnnualVolume: number | null
  pitchRunCount: number
}

interface ProspectsResponse {
  prospects: Prospect[]
  total: number
  limit: number
  offset: number
  page: number
}

type Confidence = '' | 'CONFIRMED' | 'LIKELY' | 'UNVERIFIED' | 'NULL'

const PAGE_SIZE = 50

const CONFIDENCE_TONES: Record<string, string> = {
  CONFIRMED: 'bg-data-positive-bg text-data-positive-fg',
  LIKELY: 'bg-data-warning-bg text-data-warning-fg',
  UNVERIFIED: 'bg-data-negative-bg text-data-negative-fg',
}

const ICP_TONES: Record<string, string> = {
  PREMIUM: 'bg-signal/15 text-fg border border-c1/40',
  MID: 'bg-surface-muted text-fg border border-glass-border',
  GROWTH: 'bg-canvas text-fg-muted border border-glass-border',
}

function ConfidenceBadge({ value }: { value: string | null }) {
  if (!value) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-surface-muted text-fg-muted border border-glass-border">
        Not enriched
      </span>
    )
  }
  const cls = CONFIDENCE_TONES[value] || 'bg-surface-muted text-fg-muted'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {value}
    </span>
  )
}

function IcpBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-fg-subtle text-xs">—</span>
  const cls = ICP_TONES[tier] || 'bg-surface-muted text-fg-muted'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {tier}
    </span>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    if (diffMin < 1440 * 7) return `${Math.floor(diffMin / 1440)}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso
  }
}

export default function ProspectsListPage() {
  const featureEnabled =
    process.env.NEXT_PUBLIC_FEATURE_PROSPECT_ENRICH_ENABLED !== 'false'

  const [prospects, setProspects] = useState<Prospect[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [confidenceFilter, setConfidenceFilter] = useState<Confidence>('')
  const [statusFilter, setStatusFilter] = useState('')
  const [enriching, setEnriching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const offset = (page - 1) * PAGE_SIZE
      const params = new URLSearchParams()
      if (searchTerm.trim()) params.set('q', searchTerm.trim())
      if (confidenceFilter) params.set('confidence', confidenceFilter)
      if (statusFilter) params.set('status', statusFilter)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(offset))

      const res = await fetch(`/api/admin/prospects?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ProspectsResponse = await res.json()
      setProspects(data.prospects || [])
      setTotal(data.total || 0)
    } catch (err: any) {
      setError(err?.message || 'Failed to load prospects')
    } finally {
      setLoading(false)
    }
  }, [page, searchTerm, confidenceFilter, statusFilter])

  useEffect(() => {
    if (featureEnabled) load()
  }, [load, featureEnabled])

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1)
  }, [searchTerm, confidenceFilter, statusFilter])

  async function handleReenrich(id: string) {
    setEnriching(id)
    try {
      const res = await fetch(`/api/admin/prospects/${id}/enrich`, {
        method: 'POST',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast('Re-enrichment queued', 'success')
      // Optimistic refresh after a short delay so any sync-completed run shows up.
      setTimeout(() => load(), 1200)
    } catch (err: any) {
      showToast(err?.message || 'Re-enrichment failed', 'error')
    } finally {
      setEnriching(null)
    }
  }

  if (!featureEnabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-fg">Prospects</h1>
        <div className="panel p-6 border border-glass-border bg-surface-muted text-fg-muted text-sm">
          Builder enrichment is currently disabled. Toggle{' '}
          <code className="font-mono text-xs bg-canvas px-1.5 py-0.5 rounded">
            NEXT_PUBLIC_FEATURE_PROSPECT_ENRICH_ENABLED
          </code>{' '}
          to enable this feature.
        </div>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-c1" />
          <h1 className="text-3xl font-bold text-fg">Prospects</h1>
        </div>
        <p className="text-fg-muted mt-2 text-sm">
          {total} prospect{total === 1 ? '' : 's'} · enrichment status, contact data, and pitch history
        </p>
      </div>

      {/* Filters */}
      <div className="panel border border-glass-border bg-surface-muted/40 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search company, contact, domain, founder…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-canvas border border-glass-border rounded pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-c1"
          />
        </div>
        <select
          value={confidenceFilter}
          onChange={(e) => setConfidenceFilter(e.target.value as Confidence)}
          className="bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
        >
          <option value="">All confidence</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="LIKELY">Likely</option>
          <option value="UNVERIFIED">Unverified</option>
          <option value="NULL">Not enriched</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-canvas border border-glass-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-c1"
        >
          <option value="">All statuses</option>
          <option value="NEW">New</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="QUALIFIED">Qualified</option>
          <option value="CONVERTED">Converted</option>
          <option value="DEAD">Dead</option>
        </select>
        <button
          onClick={() => load()}
          className="ml-auto px-3 py-2 text-sm font-medium bg-canvas border border-glass-border rounded hover:bg-white/5 text-fg flex items-center gap-1.5 transition"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="panel p-4 border border-data-negative bg-data-negative-bg text-data-negative-fg text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="panel border border-glass-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-glass-border bg-surface-muted/40">
              <tr className="text-left text-[11px] uppercase tracking-wide text-fg-muted">
                <th className="py-3 px-4 font-semibold">Company</th>
                <th className="py-3 px-4 font-semibold">City</th>
                <th className="py-3 px-4 font-semibold">Contact</th>
                <th className="py-3 px-4 font-semibold">Email</th>
                <th className="py-3 px-4 font-semibold">Last Enriched</th>
                <th className="py-3 px-4 font-semibold">Volume</th>
                <th className="py-3 px-4 font-semibold">ICP</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && prospects.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-fg-muted">
                    Loading…
                  </td>
                </tr>
              ) : prospects.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-fg-subtle">
                    {searchTerm || confidenceFilter || statusFilter
                      ? 'No prospects match the current filters.'
                      : 'No prospects yet. Run the enrichment cron to populate the queue.'}
                  </td>
                </tr>
              ) : (
                prospects.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-glass-border/60 hover:bg-white/5 transition"
                  >
                    <td className="py-3 px-4">
                      <Link
                        href={`/admin/prospects/${p.id}`}
                        className="font-medium text-fg hover:text-c1 transition"
                      >
                        {p.companyName}
                      </Link>
                      {p.domain && (
                        <div className="text-[11px] text-fg-subtle font-mono">
                          {p.domain}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-fg-muted">
                      {p.city ? `${p.city}${p.state ? ', ' + p.state : ''}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-fg-muted">
                      {p.founderName || p.contactName || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-fg text-xs font-mono truncate max-w-[200px]">
                          {p.email || '—'}
                        </span>
                        <ConfidenceBadge value={p.enrichmentConfidence} />
                        {p.bouncedAt && (
                          <span className="text-[10px] text-data-negative-fg">
                            bounced
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-fg-muted whitespace-nowrap">
                      {fmtDate(p.enrichmentRunAt)}
                    </td>
                    <td className="py-3 px-4 text-fg-muted">
                      {p.estimatedAnnualVolume != null
                        ? `${p.estimatedAnnualVolume.toLocaleString()}/yr`
                        : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <IcpBadge tier={p.icpTier} />
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-[11px] uppercase tracking-wide text-fg-muted">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/admin/prospects/${p.id}`}
                          className="px-2.5 py-1 text-xs font-medium bg-canvas border border-glass-border rounded hover:bg-white/5 text-fg flex items-center gap-1 transition"
                        >
                          View
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                        <button
                          onClick={() => handleReenrich(p.id)}
                          disabled={enriching === p.id}
                          className="px-2.5 py-1 text-xs font-medium bg-signal/15 border border-c1/40 rounded hover:bg-signal/25 text-fg flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${enriching === p.id ? 'animate-spin' : ''}`}
                          />
                          {enriching === p.id ? 'Queuing…' : 'Re-enrich'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-fg-muted">
          <div>
            Page {page} of {totalPages} · {total} total
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 bg-canvas border border-glass-border rounded hover:bg-white/5 text-fg disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 bg-canvas border border-glass-border rounded hover:bg-white/5 text-fg disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 ${
              toast.tone === 'success'
                ? 'bg-data-positive text-white'
                : 'bg-data-negative text-white'
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
