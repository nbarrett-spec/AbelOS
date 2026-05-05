'use client'

/**
 * /ops/accounting/journal-entries — Journal Entries list.
 *
 * FIX-4 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05).
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

interface JournalEntryRow {
  id: string
  entryNumber: string
  date: string
  description: string
  reference: string | null
  status: 'DRAFT' | 'POSTED' | 'REVERSED' | 'VOID'
  totalDebits: number
  totalCredits: number
  lineCount: number
  createdAt: string
}

const STATUSES = ['DRAFT', 'POSTED', 'REVERSED', 'VOID'] as const

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadge(s: string) {
  switch (s) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700'
    case 'POSTED':
      return 'bg-green-100 text-green-700'
    case 'REVERSED':
      return 'bg-amber-100 text-amber-700'
    case 'VOID':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState<JournalEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (statusFilter) p.set('status', statusFilter)
      if (search) p.set('search', search)
      if (dateFrom) p.set('dateFrom', dateFrom)
      if (dateTo) p.set('dateTo', dateTo)
      p.set('limit', '200')
      const res = await fetch(`/api/ops/accounting/journal-entries?${p.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setEntries(data.entries || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load entries')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search, dateFrom, dateTo])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Journal Entries"
        description="The general ledger. Every adjustment, accrual, correction, and non-transactional posting lives here."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Accounting' },
          { label: 'Journal Entries' },
        ]}
        actions={
          <Link href="/ops/accounting/journal-entries/new" className="btn btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> New Entry
          </Link>
        }
      />

      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Entry # / description / reference…"
              className="input pl-9 w-full"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input min-w-[120px]"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input min-w-[140px]"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input min-w-[140px]"
            title="To date"
          />
          {(statusFilter || search || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setStatusFilter('')
                setSearch('')
                setDateFrom('')
                setDateTo('')
              }}
              className="text-xs text-fg-subtle hover:text-fg"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs text-fg-muted">
          {entries.length} entries
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-900">
          {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <p className="text-sm text-fg-muted mb-3">No journal entries yet.</p>
          <Link href="/ops/accounting/journal-entries/new" className="btn btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> Create the first entry
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Entry #</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Date</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Description</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Lines</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Debit</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => {
                const balanced = Math.abs(e.totalDebits - e.totalCredits) < 0.005
                return (
                  <tr key={e.id} className="hover:bg-surface-muted/40">
                    <td className="px-4 py-2">
                      <Link
                        href={`/ops/accounting/journal-entries/${e.id}`}
                        className="font-mono text-brand hover:underline"
                      >
                        {e.entryNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-fg-muted">{formatDate(e.date)}</td>
                    <td className="px-4 py-2">
                      <div className="text-fg truncate max-w-[400px]" title={e.description}>
                        {e.description}
                      </div>
                      {e.reference && (
                        <div className="text-[11px] text-fg-subtle truncate">
                          ref: {e.reference}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusBadge(e.status)}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">
                      {e.lineCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(e.totalDebits)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className={!balanced ? 'text-data-negative font-bold' : ''}>
                        {formatCurrency(e.totalCredits)}
                      </span>
                      {!balanced && e.status === 'DRAFT' && (
                        <div className="text-[10px] text-data-negative italic">
                          unbalanced
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
