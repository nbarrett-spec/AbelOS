'use client'

/**
 * /ops/accounting/journal-entries/new — debit/credit grid form.
 *
 * FIX-4 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). Running
 * total at the bottom shows debit/credit balance — must equal zero
 * to save (POST validates the same way).
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

interface Account {
  id: string
  code: string
  name: string
  type: string
}

interface LineRow {
  key: string
  accountId: string
  debit: number
  credit: number
  memo: string
}

function newKey() {
  return `je-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n)
}

export default function NewJournalEntryPage() {
  const router = useRouter()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<LineRow[]>([
    { key: newKey(), accountId: '', debit: 0, credit: 0, memo: '' },
    { key: newKey(), accountId: '', debit: 0, credit: 0, memo: '' },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load accounts (active only)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/ops/accounting/chart-of-accounts')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setAccounts(data.accounts || [])
        }
      } catch {}
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const totals = useMemo(() => {
    const totalDebits = lines.reduce((s, l) => s + (l.debit || 0), 0)
    const totalCredits = lines.reduce((s, l) => s + (l.credit || 0), 0)
    return {
      totalDebits,
      totalCredits,
      diff: totalDebits - totalCredits,
      balanced: Math.abs(totalDebits - totalCredits) < 0.005,
    }
  }, [lines])

  const updateLine = <K extends keyof LineRow>(key: string, field: K, value: LineRow[K]) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l
        const updated = { ...l, [field]: value }
        // Auto-clear the opposite column so a row only ever has D OR C
        if (field === 'debit' && value && Number(value) > 0) updated.credit = 0
        if (field === 'credit' && value && Number(value) > 0) updated.debit = 0
        return updated
      }),
    )
  }

  const addLine = () =>
    setLines((prev) => [...prev, { key: newKey(), accountId: '', debit: 0, credit: 0, memo: '' }])

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)))

  const handleSubmit = async (postImmediately: boolean) => {
    setError(null)
    if (!date) return setError('Date is required')
    if (!description.trim()) return setError('Description is required')
    if (lines.some((l) => !l.accountId)) {
      return setError('Every line needs an account')
    }
    if (lines.some((l) => l.debit < 0 || l.credit < 0)) {
      return setError('Amounts cannot be negative')
    }
    if (lines.some((l) => l.debit === 0 && l.credit === 0)) {
      return setError('Every line needs either a debit OR credit > 0')
    }
    if (postImmediately && !totals.balanced) {
      return setError(
        `Cannot post — debits (${fmt(totals.totalDebits)}) ≠ credits (${fmt(totals.totalCredits)})`,
      )
    }

    setSubmitting(true)
    try {
      // Create as draft
      const res = await fetch('/api/ops/accounting/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description: description.trim(),
          reference: reference.trim() || undefined,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo.trim() || undefined,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const created = await res.json()

      // Optionally post immediately
      if (postImmediately) {
        const postRes = await fetch(
          `/api/ops/accounting/journal-entries/${created.id}/post`,
          { method: 'POST' },
        )
        if (!postRes.ok) {
          const data = await postRes.json().catch(() => ({}))
          // Created as draft, posting failed — user can retry on detail page
          router.push(
            `/ops/accounting/journal-entries/${created.id}?post-error=${encodeURIComponent(data.error || 'Post failed')}`,
          )
          return
        }
      }
      router.push(`/ops/accounting/journal-entries/${created.id}`)
    } catch (e: any) {
      setError(e?.message || 'Failed to save entry')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        eyebrow="Accounting"
        title="New Journal Entry"
        description="Pick accounts, enter debits + credits. The entry must balance to post."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Accounting' },
          { label: 'Journal Entries', href: '/ops/accounting/journal-entries' },
          { label: 'New' },
        ]}
        actions={
          <button onClick={() => router.back()} className="btn btn-secondary btn-sm">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-900">{error}</span>
        </div>
      )}

      {/* Header fields */}
      <div className="bg-white rounded-lg border p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Description *</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input w-full"
              placeholder="What is this entry for?"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="label">Reference (optional)</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="input w-full"
            placeholder="Invoice #, PO #, document reference, free text…"
          />
        </div>
      </div>

      {/* Lines grid */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center mb-3">
          <h2 className="text-sm font-semibold text-fg">Lines</h2>
          <button
            type="button"
            onClick={addLine}
            className="btn btn-secondary btn-xs ml-auto"
          >
            <Plus className="w-3 h-3" /> Add line
          </button>
        </div>

        <div className="hidden md:grid grid-cols-[2fr_120px_120px_2fr_32px] gap-2 px-1 pb-2 border-b border-border">
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider">
            Account
          </div>
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">
            Debit
          </div>
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">
            Credit
          </div>
          <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider">
            Memo
          </div>
          <div />
        </div>

        <div className="divide-y divide-border">
          {lines.map((l) => (
            <div
              key={l.key}
              className="grid grid-cols-1 md:grid-cols-[2fr_120px_120px_2fr_32px] gap-2 py-2 px-1 items-center"
            >
              <select
                value={l.accountId}
                onChange={(e) => updateLine(l.key, 'accountId', e.target.value)}
                className="input text-sm"
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min={0}
                value={l.debit || ''}
                onChange={(e) =>
                  updateLine(l.key, 'debit', Math.max(0, Number(e.target.value) || 0))
                }
                placeholder="0.00"
                className="input text-right tabular-nums text-sm"
              />
              <input
                type="number"
                step="0.01"
                min={0}
                value={l.credit || ''}
                onChange={(e) =>
                  updateLine(l.key, 'credit', Math.max(0, Number(e.target.value) || 0))
                }
                placeholder="0.00"
                className="input text-right tabular-nums text-sm"
              />
              <input
                type="text"
                value={l.memo}
                onChange={(e) => updateLine(l.key, 'memo', e.target.value)}
                className="input text-sm"
                placeholder="Line memo (optional)"
              />
              <button
                type="button"
                onClick={() => removeLine(l.key)}
                disabled={lines.length <= 2}
                className="text-fg-subtle hover:text-data-negative disabled:opacity-30 disabled:cursor-not-allowed justify-self-center"
                title={lines.length <= 2 ? 'At least 2 lines required' : 'Remove line'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Totals row */}
        <div
          className={`mt-3 grid grid-cols-[2fr_120px_120px_2fr_32px] gap-2 px-1 py-2 border-t-2 font-semibold ${
            totals.balanced ? 'border-green-300 bg-green-50' : 'border-data-negative bg-red-50'
          }`}
        >
          <div className="text-sm text-fg">Totals</div>
          <div className="text-right tabular-nums text-sm">${fmt(totals.totalDebits)}</div>
          <div className="text-right tabular-nums text-sm">${fmt(totals.totalCredits)}</div>
          <div
            className={`text-sm ${totals.balanced ? 'text-data-positive' : 'text-data-negative'}`}
          >
            {totals.balanced ? '✓ Balanced' : `Diff: $${fmt(Math.abs(totals.diff))}`}
          </div>
          <div />
        </div>
      </div>

      {/* Submit row */}
      <div className="bg-white rounded-lg border p-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={submitting}
          className="btn btn-secondary btn-md"
        >
          {submitting ? 'Saving…' : 'Save as Draft'}
        </button>
        <button
          type="button"
          onClick={() => handleSubmit(true)}
          disabled={submitting || !totals.balanced}
          className="btn btn-primary btn-md flex-1"
          title={!totals.balanced ? 'Balance the entry before posting' : undefined}
        >
          {submitting ? 'Saving…' : 'Save & Post'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/ops/accounting/journal-entries')}
          className="btn btn-ghost btn-md"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
