'use client'

/**
 * /ops/accounting/journal-entries/[id] — detail view.
 *
 * FIX-4 + FIX-5 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05).
 * Read-only view of any entry (DRAFT/POSTED/REVERSED/VOID), with
 * Post / Reverse / Void actions depending on status. Embedded
 * DocumentAttachments lets accounting attach the supporting invoice,
 * receipt, or bank statement that backs the entry.
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  XCircle,
  Loader2,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import DocumentAttachments from '@/components/ops/DocumentAttachments'

interface AccountInfo {
  id: string
  code: string
  name: string
  type: string
}

interface JournalEntryLine {
  id: string
  accountId: string
  account: AccountInfo
  debit: number
  credit: number
  memo: string | null
}

interface JournalEntry {
  id: string
  entryNumber: string
  date: string
  description: string
  reference: string | null
  status: 'DRAFT' | 'POSTED' | 'REVERSED' | 'VOID'
  reversalOf: string | null
  approvedById: string | null
  approvedAt: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
  lines: JournalEntryLine[]
  totalDebits: number
  totalCredits: number
  isBalanced: boolean
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v)
}

function formatDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

export default function JournalEntryDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id || ''

  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'post' | 'reverse' | 'void' | null>(null)

  const initialPostError = searchParams.get('post-error')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/accounting/journal-entries/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setEntry(data)
    } catch (e: any) {
      setError(e?.message || 'Failed to load entry')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
    if (initialPostError) setError(decodeURIComponent(initialPostError))
  }, [load, initialPostError])

  const handlePost = async () => {
    if (!entry) return
    if (!confirm(`Post entry ${entry.entryNumber}? Once posted, you can't edit — only reverse.`))
      return
    setBusy('post')
    setError(null)
    try {
      const res = await fetch(`/api/ops/accounting/journal-entries/${entry.id}/post`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: any) {
      setError(e?.message || 'Post failed')
    } finally {
      setBusy(null)
    }
  }

  const handleReverse = async () => {
    if (!entry) return
    if (
      !confirm(
        `Create a reversing entry for ${entry.entryNumber}? The original stays as POSTED and gets flipped to REVERSED; a new entry posts the opposite of every line.`,
      )
    )
      return
    setBusy('reverse')
    setError(null)
    try {
      const res = await fetch(
        `/api/ops/accounting/journal-entries/${entry.id}/reverse`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      router.push(`/ops/accounting/journal-entries/${data.reversal.id}`)
    } catch (e: any) {
      setError(e?.message || 'Reverse failed')
    } finally {
      setBusy(null)
    }
  }

  const handleVoid = async () => {
    if (!entry) return
    if (
      !confirm(
        `Void ${entry.entryNumber}? The row stays for audit but the entry is marked VOID. This is for entries that were created in error.`,
      )
    )
      return
    setBusy('void')
    setError(null)
    try {
      const res = await fetch(`/api/ops/accounting/journal-entries/${entry.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: any) {
      setError(e?.message || 'Void failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-sm text-fg-muted">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading entry…
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Accounting"
          title="Journal Entry"
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Accounting' },
            { label: 'Journal Entries', href: '/ops/accounting/journal-entries' },
          ]}
        />
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-900">
          {error || 'Entry not found'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        eyebrow="Accounting"
        title={entry.entryNumber}
        description={entry.description}
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Accounting' },
          { label: 'Journal Entries', href: '/ops/accounting/journal-entries' },
          { label: entry.entryNumber },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/ops/accounting/journal-entries" className="btn btn-secondary btn-sm">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </Link>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-900">{error}</span>
        </div>
      )}

      {/* Header summary */}
      <div className="bg-white rounded-lg border p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-fg-muted uppercase tracking-wider">Status</div>
          <div className="mt-1">
            <span
              className={`px-2 py-1 rounded text-xs font-semibold uppercase tracking-wider ${statusBadge(entry.status)}`}
            >
              {entry.status}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-muted uppercase tracking-wider">Date</div>
          <div className="text-sm text-fg mt-1">
            {new Date(entry.date).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-muted uppercase tracking-wider">Total Debits</div>
          <div className="text-base font-semibold tabular-nums text-fg mt-1">
            {formatCurrency(entry.totalDebits)}
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-muted uppercase tracking-wider">Total Credits</div>
          <div className="text-base font-semibold tabular-nums text-fg mt-1">
            {formatCurrency(entry.totalCredits)}
          </div>
          {!entry.isBalanced && (
            <div className="text-[11px] text-data-negative italic">unbalanced</div>
          )}
        </div>
        {entry.reference && (
          <div className="col-span-2 md:col-span-4 pt-3 border-t">
            <div className="text-xs text-fg-muted uppercase tracking-wider">Reference</div>
            <div className="text-sm text-fg mt-1">{entry.reference}</div>
          </div>
        )}
        {entry.reversalOf && (
          <div className="col-span-2 md:col-span-4 pt-3 border-t">
            <div className="text-xs text-fg-muted uppercase tracking-wider">Reverses</div>
            <Link
              href={`/ops/accounting/journal-entries/${entry.reversalOf}`}
              className="text-sm text-brand hover:underline"
            >
              View original entry →
            </Link>
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">Lines</div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Account</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Memo</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Debit</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entry.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">
                  <div className="font-mono text-xs text-fg-muted">{l.account.code}</div>
                  <div className="text-fg">{l.account.name}</div>
                  <div className="text-[10px] text-fg-subtle uppercase tracking-wider">
                    {l.account.type}
                  </div>
                </td>
                <td className="px-4 py-2 text-fg-muted text-[12px]">{l.memo || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {l.debit > 0 ? formatCurrency(l.debit) : <span className="text-fg-subtle">—</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {l.credit > 0 ? formatCurrency(l.credit) : <span className="text-fg-subtle">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-muted border-t-2">
            <tr>
              <td className="px-4 py-2 text-sm font-semibold" colSpan={2}>
                Totals
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {formatCurrency(entry.totalDebits)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {formatCurrency(entry.totalCredits)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Actions */}
      {(entry.status === 'DRAFT' || entry.status === 'POSTED') && (
        <div className="bg-white rounded-lg border p-4 flex flex-wrap items-center gap-2">
          {entry.status === 'DRAFT' && (
            <button
              onClick={handlePost}
              disabled={busy !== null || !entry.isBalanced}
              className="btn btn-primary btn-sm"
              title={!entry.isBalanced ? 'Balance the entry first' : undefined}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {busy === 'post' ? 'Posting…' : 'Post Entry'}
            </button>
          )}
          {entry.status === 'POSTED' && (
            <button
              onClick={handleReverse}
              disabled={busy !== null}
              className="btn btn-secondary btn-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {busy === 'reverse' ? 'Reversing…' : 'Reverse Entry'}
            </button>
          )}
          <button
            onClick={handleVoid}
            disabled={busy !== null}
            className="btn btn-ghost btn-sm text-data-negative"
          >
            <XCircle className="w-3.5 h-3.5" />
            {busy === 'void' ? 'Voiding…' : 'Void Entry'}
          </button>
        </div>
      )}

      {/* FIX-5 — Document attachments (writes to DocumentVault.journalEntryId) */}
      <div className="bg-white rounded-lg border p-5">
        <DocumentAttachments
          entityType="journalEntry"
          entityId={entry.id}
          defaultCategory="REPORT"
          allowedCategories={['REPORT', 'CORRESPONDENCE', 'INVOICE', 'CONTRACT', 'GENERAL']}
          title="Supporting Documents"
        />
      </div>

      {/* Audit */}
      <div className="text-xs text-fg-subtle space-y-1">
        <div>Created {formatDateTime(entry.createdAt)}</div>
        {entry.approvedAt && <div>Posted {formatDateTime(entry.approvedAt)}</div>}
        <div>Updated {formatDateTime(entry.updatedAt)}</div>
      </div>
    </div>
  )
}
