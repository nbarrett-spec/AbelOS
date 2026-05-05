'use client'

/**
 * /ops/accounting/chart-of-accounts — Chart of Accounts manager.
 *
 * FIX-4 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). Lists all
 * accounts grouped by type with create form.
 *
 * The migration in scripts/migrate-aegis-ops-finance.sql seeds 23
 * starter accounts (Cash, AR, Inventory, AP, Equity, Revenue, COGS,
 * OpEx). Use this page to add custom accounts as needed.
 */
import { useEffect, useState, useCallback } from 'react'
import { Plus, AlertTriangle, BookOpen } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const
type AccountType = (typeof ACCOUNT_TYPES)[number]

interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  subType: string | null
  description: string | null
  isActive: boolean
  parentId: string | null
}

const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
}

const TYPE_COLOR: Record<AccountType, string> = {
  ASSET: 'bg-blue-100 text-blue-700 border-blue-200',
  LIABILITY: 'bg-amber-100 text-amber-700 border-amber-200',
  EQUITY: 'bg-purple-100 text-purple-700 border-purple-200',
  REVENUE: 'bg-green-100 text-green-700 border-green-200',
  EXPENSE: 'bg-red-100 text-red-700 border-red-200',
}

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('EXPENSE')
  const [subType, setSubType] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/accounting/chart-of-accounts?activeOnly=false')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setAccounts(data.accounts || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async () => {
    if (!code.trim() || !name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/accounting/chart-of-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          type,
          subType: subType.trim() || undefined,
          description: description.trim() || undefined,
          parentId: parentId || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setCode('')
      setName('')
      setType('EXPENSE')
      setSubType('')
      setDescription('')
      setParentId('')
      setShowAdd(false)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to create account')
    } finally {
      setCreating(false)
    }
  }

  const grouped = ACCOUNT_TYPES.map((t) => ({
    type: t,
    accounts: accounts.filter((a) => a.type === t).sort((a, b) => a.code.localeCompare(b.code)),
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Chart of Accounts"
        description="The set of accounts journal entries can post against. Seeded with 23 starter accounts; add custom ones below."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Accounting' },
          { label: 'Chart of Accounts' },
        ]}
        actions={
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> {showAdd ? 'Cancel' : 'Add Account'}
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-900">{error}</span>
        </div>
      )}

      {showAdd && (
        <div className="bg-white rounded-lg border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-fg">New Account</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">Code *</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input w-full"
                placeholder="e.g. 4050"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input w-full"
                placeholder="e.g. Revenue - Service Calls"
              />
            </div>
            <div>
              <label className="label">Type *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
                className="input w-full"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Sub-Type</label>
              <input
                type="text"
                value={subType}
                onChange={(e) => setSubType(e.target.value)}
                className="input w-full"
                placeholder="e.g. Operating Revenue"
              />
            </div>
            <div>
              <label className="label">Parent Account</label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="input w-full"
              >
                <option value="">(no parent)</option>
                {accounts
                  .filter((a) => a.type === type)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input w-full"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleCreate}
              disabled={creating || !code.trim() || !name.trim()}
              className="btn btn-primary btn-sm"
            >
              {creating ? 'Creating…' : 'Create Account'}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading…
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <BookOpen className="w-8 h-8 text-fg-subtle mx-auto mb-2" />
          <p className="text-sm text-fg-muted mb-3">
            No accounts yet — apply the migration script in
            <code className="font-mono px-1.5 py-0.5 bg-surface-muted rounded mx-1">
              scripts/migrate-aegis-ops-finance.sql
            </code>
            to seed 23 starter accounts.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ type, accounts: list }) => (
            <div key={type} className="bg-white rounded-lg border overflow-hidden">
              <div
                className={`px-4 py-2 border-b font-semibold text-sm uppercase tracking-wider ${TYPE_COLOR[type]}`}
              >
                {TYPE_LABEL[type]} ({list.length})
              </div>
              {list.length === 0 ? (
                <div className="px-4 py-3 text-xs text-fg-subtle italic">
                  No accounts of this type yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider w-24">Code</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Sub-Type</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.map((a) => (
                      <tr key={a.id} className="hover:bg-surface-muted/40">
                        <td className="px-4 py-2 font-mono text-xs text-fg-muted">{a.code}</td>
                        <td className="px-4 py-2 text-fg">
                          {a.name}
                          {a.description && (
                            <div className="text-[11px] text-fg-subtle mt-0.5">
                              {a.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-fg-muted text-xs">{a.subType || '—'}</td>
                        <td className="px-4 py-2">
                          {a.isActive ? (
                            <span className="text-[11px] text-data-positive">Active</span>
                          ) : (
                            <span className="text-[11px] text-fg-subtle">Inactive</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
