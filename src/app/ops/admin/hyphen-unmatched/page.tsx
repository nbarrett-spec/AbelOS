'use client'

// ──────────────────────────────────────────────────────────────────────────
// /ops/admin/hyphen-unmatched
//
// Review queue for HyphenDocument rows that couldn't be confidently tied to
// a Job. Lets an admin pick a Job via free-text search and assign.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, AlertTriangle, Search, CheckCircle2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

interface UnmatchedDoc {
  id: string
  sourceId: string
  eventType: string
  docCategory: string | null
  fileName: string | null
  fileUrl: string | null
  fileSizeBytes: number | null
  poNumber: string | null
  builderName: string | null
  jobAddress: string | null
  lotBlock: string | null
  planElvSwing: string | null
  matchConfidence: string | null
  matchMethod: string | null
  jobId: string | null
  builderId: string | null
  scrapedAt: string
}

interface JobSearchResult {
  id: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  lotBlock: string | null
  community: string | null
  status: string
}

function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function confBadgeClasses(c: string | null): string {
  if (c === 'UNMATCHED') return 'bg-red-100 text-red-800'
  if (c === 'LOW') return 'bg-orange-100 text-orange-800'
  if (c === 'MEDIUM') return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-700'
}

export default function HyphenUnmatchedPage() {
  const [docs, setDocs] = useState<UnmatchedDoc[]>([])
  const [counts, setCounts] = useState<{ total: number; unmatched: number; low: number; medium: number }>({
    total: 0, unmatched: 0, low: 0, medium: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeAssign, setActiveAssign] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/ops/hyphen/unmatched?limit=500', { cache: 'no-store' })
      if (!r.ok) throw new Error(`Failed: ${r.status}`)
      const j = await r.json()
      setDocs(j.docs || [])
      setCounts(j.counts || counts)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Hyphen — Unmatched Documents"
        description="Hyphen docs that couldn't be confidently tied to a Job. Assign each to the right Job so the PM sees it under their Documents tab."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'Hyphen Unmatched' },
        ]}
        actions={
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-surface-elev text-fg-on-accent hover:opacity-90 font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Needs review" value={counts.total} color="text-fg" />
        <StatCard label="Unmatched" value={counts.unmatched} color="text-red-600" />
        <StatCard label="Low confidence" value={counts.low} color="text-orange-600" />
        <StatCard label="Medium confidence" value={counts.medium} color="text-amber-600" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">File</th>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">PO</th>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">Builder</th>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">Address / Lot</th>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">Confidence</th>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">Scraped</th>
              <th className="text-left text-[11px] uppercase tracking-wider text-fg-muted font-semibold px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-fg-subtle text-sm">Loading…</td>
              </tr>
            )}
            {!loading && docs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-fg-subtle text-sm">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-500" />
                  No unmatched documents. All Hyphen scrapes are correlating.
                </td>
              </tr>
            )}
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-row-hover">
                <td className="px-4 py-2">
                  <div className="text-sm font-medium text-fg max-w-[260px] truncate">
                    {d.fileName || `${d.eventType}`}
                  </div>
                  <div className="text-[11px] text-fg-muted">
                    {d.docCategory || d.eventType}
                  </div>
                </td>
                <td className="px-4 py-2 text-sm font-mono tabular-nums text-fg">
                  {d.poNumber || '—'}
                </td>
                <td className="px-4 py-2 text-sm text-fg max-w-[180px] truncate">
                  {d.builderName || '—'}
                </td>
                <td className="px-4 py-2 text-sm text-fg-muted max-w-[240px]">
                  <div className="truncate">{d.jobAddress || '—'}</div>
                  {d.lotBlock && (
                    <div className="text-[11px] text-fg-muted font-mono">Lot {d.lotBlock}</div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${confBadgeClasses(d.matchConfidence)}`}>
                    {d.matchConfidence || '—'}
                  </span>
                </td>
                <td className="px-4 py-2 text-[11px] text-fg-muted font-mono tabular-nums">
                  {fmtAgo(d.scrapedAt)}
                </td>
                <td className="px-4 py-2">
                  {activeAssign === d.id ? (
                    <AssignDropdown
                      docId={d.id}
                      seedQuery={d.poNumber || d.jobAddress || d.builderName || ''}
                      onDone={() => {
                        setActiveAssign(null)
                        load()
                      }}
                      onCancel={() => setActiveAssign(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setActiveAssign(d.id)}
                      className="px-3 py-1 text-xs rounded border border-signal text-signal hover:bg-signal-subtle font-medium"
                    >
                      Assign to Job
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <p className="text-xs text-fg-muted uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold font-mono tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

function AssignDropdown({
  docId,
  seedQuery,
  onDone,
  onCancel,
}: {
  docId: string
  seedQuery: string
  onDone: () => void
  onCancel: () => void
}) {
  const [q, setQ] = useState(seedQuery)
  const [results, setResults] = useState<JobSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q || q.length < 2) { setResults([]); return }
      setSearching(true)
      try {
        const r = await fetch(`/api/ops/jobs?search=${encodeURIComponent(q)}&limit=15`, { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json()
          // /api/ops/jobs returns { jobs, total, ... } — use jobs.
          setResults((j.jobs || []).slice(0, 15))
        }
      } catch {
        /* ignore */
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  const assign = async (jobId: string) => {
    setAssigning(true)
    setErr(null)
    try {
      const r = await fetch(`/api/ops/hyphen/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (!r.ok) throw new Error(`Failed: ${r.status}`)
      onDone()
    } catch (e: any) {
      setErr(e?.message || 'Assign failed')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 min-w-[320px]">
      <div className="flex items-center gap-1">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs by # / address / PO"
            className="w-full border border-border-strong rounded pl-7 pr-2 py-1 text-xs bg-surface text-fg"
            autoFocus
          />
        </div>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-[11px] text-fg-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      {searching && <div className="text-[11px] text-fg-muted">Searching…</div>}
      {results.length > 0 && (
        <div className="border border-border rounded max-h-48 overflow-y-auto bg-surface shadow-sm">
          {results.map((j) => (
            <button
              key={j.id}
              disabled={assigning}
              onClick={() => assign(j.id)}
              className="w-full text-left px-2 py-1.5 hover:bg-row-hover border-b border-border last:border-b-0 disabled:opacity-50"
            >
              <div className="text-xs font-semibold text-signal">{j.jobNumber}</div>
              <div className="text-[11px] text-fg-muted truncate">
                {j.builderName} · {j.jobAddress || j.community || '—'}
                {j.lotBlock ? ` · Lot ${j.lotBlock}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
