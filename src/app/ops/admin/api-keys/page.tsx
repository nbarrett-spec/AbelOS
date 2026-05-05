'use client'

/**
 * /ops/admin/api-keys — API Key generator + manager.
 *
 * Lets ADMIN users mint and revoke API keys for the Aegis MCP and
 * other service-to-service surfaces. The raw key is shown ONCE on
 * creation; afterwards only the 8-char prefix is visible — same
 * pattern AWS/GitHub/Stripe use.
 *
 * Backed by /api/ops/admin/api-keys (list + create) and /[id] (revoke).
 */
import { useEffect, useState } from 'react'
import { Key, Plus, Copy, CheckCircle2, AlertTriangle, ShieldOff } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'

interface ApiKeyRow {
  id: string
  name: string
  scope: string
  prefix: string
  createdById: string | null
  createdByName: string | null
  createdAt: string
  revokedAt: string | null
  revokedById: string | null
  revokedByName: string | null
  lastUsedAt: string | null
  notes: string | null
}

interface JustCreatedKey {
  id: string
  name: string
  scope: string
  prefix: string
  rawKey: string
}

const SCOPES = [
  { value: 'mcp', label: 'MCP', description: 'Aegis MCP server (/api/mcp + tool surface)' },
  { value: 'admin', label: 'Admin', description: 'Same as MCP — granted admin-equivalent access' },
  { value: 'agent', label: 'Agent', description: 'Reserved for future /api/agent-hub usage' },
] as const

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function relativeTime(d: string | null): string {
  if (!d) return 'never'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Generate-dialog state
  const [genOpen, setGenOpen] = useState(false)
  const [genName, setGenName] = useState('')
  const [genScope, setGenScope] = useState<string>('mcp')
  const [genNotes, setGenNotes] = useState('')
  const [generating, setGenerating] = useState(false)
  const [justCreated, setJustCreated] = useState<JustCreatedKey | null>(null)
  const [copied, setCopied] = useState(false)

  // Showing/hiding revoked rows
  const [showRevoked, setShowRevoked] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/admin/api-keys')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setKeys(data.keys || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleGenerate = async () => {
    if (!genName.trim()) return
    setGenerating(true)
    try {
      const res = await fetch('/api/ops/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: genName.trim(),
          scope: genScope,
          notes: genNotes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setJustCreated({
        id: data.id,
        name: data.name,
        scope: data.scope,
        prefix: data.prefix,
        rawKey: data.rawKey,
      })
      setGenName('')
      setGenScope('mcp')
      setGenNotes('')
      setGenOpen(false)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to generate key')
    } finally {
      setGenerating(false)
    }
  }

  const handleRevoke = async (k: ApiKeyRow) => {
    if (
      !confirm(
        `Revoke "${k.name}" (${k.prefix}…)?\n\nThe key will stop working immediately. This cannot be undone.`,
      )
    )
      return
    try {
      const res = await fetch(`/api/ops/admin/api-keys/${k.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to revoke key')
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — user can manually select
    }
  }

  const visible = keys.filter((k) => showRevoked || !k.revokedAt)
  const activeCount = keys.filter((k) => !k.revokedAt).length
  const revokedCount = keys.length - activeCount

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="API Keys"
        description="Generate keys for the Aegis MCP and other service-to-service callers. Keys are shown once at creation — save them somewhere safe."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin' },
          { label: 'API Keys' },
        ]}
        actions={
          <button
            type="button"
            onClick={() => setGenOpen(true)}
            className="btn btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Generate Key
          </button>
        }
      />

      {/* Just-created key callout — persists until dismissed */}
      {justCreated && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-amber-900">
                Key generated — save it now
              </h3>
              <p className="text-xs text-amber-800 mt-1">
                <strong>{justCreated.name}</strong> ({justCreated.scope}) · this is the
                only time you&apos;ll see the full key. After you dismiss this banner only
                the prefix <code className="font-mono">{justCreated.prefix}…</code> will
                be shown.
              </p>
              <div className="mt-3 flex items-stretch gap-2">
                <code className="flex-1 px-3 py-2 bg-white border border-amber-300 rounded font-mono text-xs text-fg break-all">
                  {justCreated.rawKey}
                </code>
                <button
                  onClick={() => handleCopy(justCreated.rawKey)}
                  className="btn btn-secondary btn-sm shrink-0"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-amber-700 mt-2">
                Use as <code className="font-mono">Authorization: Bearer {justCreated.rawKey.slice(0, 8)}…</code>
              </p>
              <button
                onClick={() => setJustCreated(null)}
                className="text-xs text-amber-900 underline mt-3 hover:text-amber-700"
              >
                I&apos;ve saved it — dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-900">{error}</span>
        </div>
      )}

      {/* Status row + show-revoked toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-fg-muted">
          <strong className="text-fg">{activeCount}</strong> active
          {revokedCount > 0 && (
            <>
              {' · '}
              <strong className="text-fg">{revokedCount}</strong> revoked
            </>
          )}
        </span>
        {revokedCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(e) => setShowRevoked(e.target.checked)}
            />
            Show revoked
          </label>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <Key className="w-8 h-8 text-fg-subtle mx-auto mb-2" />
          <p className="text-sm text-fg-muted mb-3">
            {keys.length === 0
              ? 'No API keys yet — generate your first one to start using the MCP from external tools.'
              : 'No active keys (toggle "Show revoked" to see history).'}
          </p>
          <button
            type="button"
            onClick={() => setGenOpen(true)}
            className="btn btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Generate Key
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                <Th>Name</Th>
                <Th>Scope</Th>
                <Th>Prefix</Th>
                <Th>Created</Th>
                <Th>Last Used</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((k) => (
                <tr
                  key={k.id}
                  className={`hover:bg-surface-muted/40 ${k.revokedAt ? 'opacity-60' : ''}`}
                >
                  <Td>
                    <div className="font-medium text-fg">{k.name}</div>
                    {k.notes && (
                      <div className="text-xs text-fg-subtle mt-0.5 truncate max-w-[280px]">
                        {k.notes}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700">
                      {k.scope}
                    </span>
                  </Td>
                  <Td>
                    <code className="font-mono text-xs text-fg-muted">{k.prefix}…</code>
                  </Td>
                  <Td>
                    <div className="text-xs text-fg">{formatDate(k.createdAt)}</div>
                    {k.createdByName && (
                      <div className="text-[11px] text-fg-subtle">by {k.createdByName}</div>
                    )}
                  </Td>
                  <Td>
                    <span className={k.lastUsedAt ? 'text-fg' : 'text-fg-subtle italic text-xs'}>
                      {relativeTime(k.lastUsedAt)}
                    </span>
                  </Td>
                  <Td>
                    {k.revokedAt ? (
                      <div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-700">
                          Revoked
                        </span>
                        <div className="text-[11px] text-fg-subtle mt-0.5">
                          {formatDate(k.revokedAt)}
                          {k.revokedByName && ` by ${k.revokedByName}`}
                        </div>
                      </div>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-green-100 text-green-700">
                        Active
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(k)}
                        className="text-fg-subtle hover:text-data-negative inline-flex items-center gap-1 text-xs"
                        title="Revoke key"
                      >
                        <ShieldOff className="w-3.5 h-3.5" /> Revoke
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      <div className="text-xs text-fg-subtle leading-relaxed max-w-3xl">
        <p>
          The seed key in the <code className="font-mono">ABEL_MCP_API_KEY</code> Vercel
          env var continues to work — generated keys are an additional path, not a
          replacement. To rotate the seed key, edit the env var in Vercel and redeploy.
        </p>
        <p className="mt-2">
          Keys with scope <code>mcp</code> or <code>admin</code> authenticate against
          /api/mcp. Use them in any MCP client config:
        </p>
        <pre className="mt-2 p-2 bg-surface-muted rounded font-mono text-[11px] text-fg overflow-x-auto">
{`Authorization: Bearer <your-key>`}
        </pre>
      </div>

      {/* Generate dialog */}
      {genOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !generating && setGenOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-fg mb-4">Generate API Key</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                  placeholder='e.g. "Cowork MCP", "External Wrapper"'
                  className="input w-full"
                  autoFocus
                />
                <p className="text-[11px] text-fg-subtle mt-1">
                  Helps you identify which key is which when reading audit logs.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">Scope</label>
                <div className="space-y-1.5">
                  {SCOPES.map((s) => (
                    <label
                      key={s.value}
                      className={`flex items-start gap-2 p-2.5 rounded-md border cursor-pointer transition-colors ${
                        genScope === s.value
                          ? 'border-brand bg-brand-bg'
                          : 'border-border hover:border-border-strong'
                      }`}
                    >
                      <input
                        type="radio"
                        name="scope"
                        value={s.value}
                        checked={genScope === s.value}
                        onChange={(e) => setGenScope(e.target.value)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-fg">{s.label}</div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {s.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={genNotes}
                  onChange={(e) => setGenNotes(e.target.value)}
                  rows={2}
                  className="input w-full"
                  placeholder="Where is this key being used? Who has it?"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-4 mt-4 border-t border-border">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!genName.trim() || generating}
                className="btn btn-primary btn-sm flex-1 disabled:opacity-40"
              >
                {generating ? 'Generating…' : 'Generate Key'}
              </button>
              <button
                type="button"
                onClick={() => setGenOpen(false)}
                disabled={generating}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
    <td className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''}`}>{children}</td>
  )
}
