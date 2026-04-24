'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

type SyncMode = 'MIRROR' | 'BIDIRECTIONAL' | 'AEGIS_PRIMARY'
type SyncType = 'products' | 'inventory' | 'purchaseOrders' | 'salesOrders' | 'all'

interface SyncLog {
  id: string
  syncType: string
  direction: string
  status: string
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsSkipped: number
  recordsFailed: number
  errorMessage?: string
  startedAt: string
  completedAt?: string
  durationMs: number
}

interface InflowConfig {
  id: string
  status: string
  companyId: string
  hasApiKey: boolean
  hasWebhookSecret: boolean
  syncEnabled: boolean
  syncInterval: number
  lastSyncAt?: string
  lastSyncStatus?: string
  syncMode: SyncMode
}

const SYNC_MODES: { key: SyncMode; label: string; description: string; icon: string }[] = [
  {
    key: 'MIRROR',
    label: 'Mirror from InFlow',
    description: 'InFlow is the source of truth. Aegis pulls data from InFlow on a schedule. Use this while your team still enters everything in InFlow.',
    icon: '⬇️',
  },
  {
    key: 'BIDIRECTIONAL',
    label: 'Bidirectional Sync',
    description: 'Both systems stay in sync. Changes in InFlow pull to Aegis, and new orders in Aegis push to InFlow. Use this during the transition period.',
    icon: '🔄',
  },
  {
    key: 'AEGIS_PRIMARY',
    label: 'Aegis Primary',
    description: 'Aegis is the source of truth. InFlow receives read-only updates from Aegis. Use this once the team is fully on Aegis. After stabilizing, disconnect InFlow entirely.',
    icon: '⬆️',
  },
]

const SYNC_TYPES: { key: SyncType; label: string; icon: string }[] = [
  { key: 'products', label: 'Products & Catalog', icon: '📦' },
  { key: 'inventory', label: 'Stock Levels', icon: '📊' },
  { key: 'purchaseOrders', label: 'Purchase Orders', icon: '📋' },
  { key: 'salesOrders', label: 'Sales Orders', icon: '💰' },
  { key: 'all', label: 'Full Sync (All)', icon: '🔄' },
]

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function fmtDate(s?: string | null): string {
  if (!s) return 'Never'
  try {
    return new Date(s).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return '—' }
}

function statusBadge(status: string): { color: string; bg: string } {
  switch (status) {
    case 'SUCCESS': return { color: '#059669', bg: 'rgba(5, 150, 105, 0.1)' }
    case 'PARTIAL': return { color: '#D97706', bg: 'rgba(217, 119, 6, 0.1)' }
    case 'FAILED': return { color: '#DC2626', bg: 'rgba(220, 38, 38, 0.1)' }
    case 'CONNECTED': return { color: '#059669', bg: 'rgba(5, 150, 105, 0.1)' }
    case 'DISABLED': return { color: '#6B7280', bg: 'rgba(107, 114, 128, 0.1)' }
    default: return { color: '#6B7280', bg: 'rgba(107, 114, 128, 0.1)' }
  }
}

export default function InFlowIntegrationPage() {
  const { addToast } = useToast()

  const [config, setConfig] = useState<InflowConfig | null>(null)
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [lastSuccessful, setLastSuccessful] = useState<Record<string, any>>({})
  const [counts, setCounts] = useState({ products: 0, inventory: 0, inflowLinked: 0 })
  const [loading, setLoading] = useState(true)

  // Connect form
  const [showConnectForm, setShowConnectForm] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [connecting, setConnecting] = useState(false)

  // Sync state
  const [syncing, setSyncing] = useState<SyncType | null>(null)
  const [syncResults, setSyncResults] = useState<Record<string, any> | null>(null)

  // Mode change
  const [changingMode, setChangingMode] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/integrations/inflow')
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
        setSyncLogs(data.syncLogs || [])
        setLastSuccessful(data.lastSuccessful || {})
        setCounts(data.counts || { products: 0, inventory: 0, inflowLinked: 0 })
      }
    } catch (e) {
      console.error('Failed to load InFlow config:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleConnect = async () => {
    if (!apiKey || !companyId) {
      addToast({ title: 'Missing fields', message: 'API key and Company ID are required', type: 'error' })
      return
    }
    setConnecting(true)
    try {
      const res = await fetch('/api/ops/integrations/inflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, companyId, webhookSecret: webhookSecret || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast({ title: 'Connected', message: `InFlow connected — ${data.productCount ?? '?'} products found`, type: 'success' })
        setShowConnectForm(false)
        setApiKey('')
        setCompanyId('')
        setWebhookSecret('')
        loadData()
      } else {
        addToast({ title: 'Connection failed', message: data.detail || data.error, type: 'error' })
      }
    } catch (err: any) {
      addToast({ title: 'Error', message: err.message, type: 'error' })
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect InFlow? This will stop all syncing. Your Aegis data will remain intact.')) return
    try {
      const res = await fetch('/api/ops/integrations/inflow', { method: 'DELETE' })
      if (res.ok) {
        addToast({ title: 'Disconnected', message: 'InFlow integration disabled', type: 'warning' })
        loadData()
      }
    } catch (err: any) {
      addToast({ title: 'Error', message: err.message, type: 'error' })
    }
  }

  const handleSyncModeChange = async (mode: SyncMode) => {
    if (mode === 'BIDIRECTIONAL') {
      if (!confirm('Switch to Bidirectional? This will start PUSHING Aegis changes to InFlow. Only do this once your team is entering data in both systems.')) return
    }
    if (mode === 'AEGIS_PRIMARY') {
      if (!confirm('Switch to Aegis Primary? InFlow will become read-only and stop sending updates. Only do this once the team is fully off InFlow.')) return
    }
    setChangingMode(true)
    try {
      const res = await fetch('/api/ops/integrations/inflow', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncMode: mode }),
      })
      if (res.ok) {
        addToast({ title: 'Mode updated', message: `Sync mode set to ${mode.replace('_', ' ')}`, type: 'success' })
        loadData()
      }
    } catch (err: any) {
      addToast({ title: 'Error', message: err.message, type: 'error' })
    } finally {
      setChangingMode(false)
    }
  }

  const handleSync = async (syncType: SyncType) => {
    setSyncing(syncType)
    setSyncResults(null)
    try {
      const res = await fetch('/api/ops/integrations/inflow/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncType }),
      })
      const data = await res.json()
      if (res.ok) {
        setSyncResults(data.results)
        const totalCreated = Object.values(data.results || {}).reduce((sum: number, r: any) => sum + (r?.recordsCreated || 0), 0)
        const totalUpdated = Object.values(data.results || {}).reduce((sum: number, r: any) => sum + (r?.recordsUpdated || 0), 0)
        addToast({
          title: 'Sync complete',
          message: `${totalCreated} created, ${totalUpdated} updated${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`,
          type: data.errors?.length ? 'warning' : 'success',
        })
        loadData()
      } else {
        addToast({ title: 'Sync failed', message: data.error, type: 'error' })
      }
    } catch (err: any) {
      addToast({ title: 'Error', message: err.message, type: 'error' })
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--fg-muted)' }}>Loading InFlow integration…</div>
      </div>
    )
  }

  const isConnected = config?.status === 'CONNECTED'
  const currentMode = config?.syncMode || 'MIRROR'

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <div className="eyebrow">Integrations</div>
          <h1 className="heading-gradient" style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 0', letterSpacing: '-0.02em' }}>
            📦 InFlow Inventory
          </h1>
          <p style={{ color: 'var(--fg-muted)', margin: '6px 0 0', fontSize: 14 }}>
            {isConnected
              ? `Connected · Company ${config?.companyId} · ${currentMode.replace('_', ' ')} mode`
              : 'Not connected — add your InFlow API credentials to start syncing'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isConnected && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--data-negative)' }} onClick={handleDisconnect}>
              Disconnect
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowConnectForm(!showConnectForm)}>
            {isConnected ? 'Update Credentials' : 'Connect InFlow'}
          </button>
        </div>
      </header>

      {/* ── Connection Form ── */}
      {showConnectForm && (
        <section className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 12 }}>InFlow API Credentials</h3>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>
            Find these in InFlow → Settings → Integrations → API. The connection will be tested before saving.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>API Key</label>
              <input
                className="input"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Your InFlow API key"
              />
            </div>
            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>Company ID</label>
              <input
                className="input"
                type="text"
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                placeholder="e.g., abc123def456"
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>Webhook Secret (optional)</label>
            <input
              className="input"
              type="password"
              value={webhookSecret}
              onChange={e => setWebhookSecret(e.target.value)}
              placeholder="For real-time webhook verification"
              style={{ maxWidth: 400 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={connecting}>
              {connecting ? 'Testing connection…' : 'Test & Connect'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowConnectForm(false)}>Cancel</button>
          </div>
        </section>
      )}

      {!isConnected && !showConnectForm && (
        <section className="glass-card" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
          <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Connect InFlow to get started</h2>
          <p style={{ color: 'var(--fg-muted)', maxWidth: 500, margin: '0 auto 20px', fontSize: 14 }}>
            Once connected, Aegis will pull your product catalog, stock levels, purchase orders, and sales orders from InFlow.
            You control the sync direction as your team transitions.
          </p>
          <button className="btn btn-primary" onClick={() => setShowConnectForm(true)}>
            Connect InFlow
          </button>
        </section>
      )}

      {isConnected && (
        <>
          {/* ── Data Status Cards ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div className="glass-card" style={{ padding: 16 }}>
              <div className="eyebrow">Products in Aegis</div>
              <div style={{ fontSize: 28, fontWeight: 600, margin: '4px 0' }}>{counts.products.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{counts.inflowLinked} linked to InFlow</div>
            </div>
            <div className="glass-card" style={{ padding: 16 }}>
              <div className="eyebrow">Inventory Records</div>
              <div style={{ fontSize: 28, fontWeight: 600, margin: '4px 0' }}>{counts.inventory.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Stock level entries</div>
            </div>
            <div className="glass-card" style={{ padding: 16 }}>
              <div className="eyebrow">Last Sync</div>
              <div style={{ fontSize: 28, fontWeight: 600, margin: '4px 0' }}>{fmtDate(config?.lastSyncAt)}</div>
              {config?.lastSyncStatus && (
                <div style={{
                  fontSize: 12,
                  color: statusBadge(config.lastSyncStatus.toUpperCase()).color,
                }}>
                  {config.lastSyncStatus}
                </div>
              )}
            </div>
            <div className="glass-card" style={{ padding: 16 }}>
              <div className="eyebrow">Sync Mode</div>
              <div style={{ fontSize: 20, fontWeight: 600, margin: '4px 0' }}>
                {SYNC_MODES.find(m => m.key === currentMode)?.icon}{' '}
                {SYNC_MODES.find(m => m.key === currentMode)?.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                {currentMode === 'MIRROR' ? 'InFlow → Aegis' : currentMode === 'BIDIRECTIONAL' ? 'InFlow ↔ Aegis' : 'Aegis → InFlow'}
              </div>
            </div>
          </section>

          {/* ── Migration Mode Selector ── */}
          <section className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Migration Phase</h3>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>
              Move through these phases as your team transitions from InFlow to Aegis.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {SYNC_MODES.map((mode, idx) => {
                const isActive = currentMode === mode.key
                const phaseNum = idx + 1
                return (
                  <button
                    key={mode.key}
                    onClick={() => !isActive && handleSyncModeChange(mode.key)}
                    disabled={changingMode}
                    style={{
                      textAlign: 'left',
                      padding: 16,
                      borderRadius: 12,
                      border: isActive ? '2px solid var(--signal)' : '1px solid var(--border)',
                      background: isActive ? 'var(--signal-subtle)' : 'var(--surface)',
                      cursor: isActive ? 'default' : 'pointer',
                      opacity: changingMode && !isActive ? 0.5 : 1,
                      transition: 'all 150ms ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700,
                        background: isActive ? 'var(--signal)' : 'var(--border)',
                        color: isActive ? '#fff' : 'var(--fg-muted)',
                      }}>
                        {phaseNum}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {mode.icon} {mode.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                      {mode.description}
                    </div>
                    {isActive && (
                      <div style={{
                        marginTop: 8, fontSize: 11, fontWeight: 600,
                        color: 'var(--signal)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        ● Current Phase
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Sync Controls ── */}
          <section className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Run Sync</h3>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>
              {currentMode === 'MIRROR'
                ? 'Pull latest data from InFlow into Aegis.'
                : currentMode === 'BIDIRECTIONAL'
                ? 'Pull from InFlow and push Aegis changes back.'
                : 'Push Aegis data to InFlow (read-only for InFlow).'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {SYNC_TYPES.map(st => {
                const lastSync = lastSuccessful[st.key]
                const isSyncing = syncing === st.key || (syncing === 'all' && st.key !== 'all')
                return (
                  <button
                    key={st.key}
                    className="glass-card"
                    onClick={() => handleSync(st.key)}
                    disabled={syncing !== null}
                    style={{
                      textAlign: 'left',
                      padding: 14,
                      cursor: syncing !== null ? 'wait' : 'pointer',
                      border: '1px solid var(--border)',
                      opacity: syncing !== null && syncing !== st.key && syncing !== 'all' ? 0.5 : 1,
                      transition: 'all 150ms ease',
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{st.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{st.label}</div>
                    {isSyncing ? (
                      <div style={{ fontSize: 11, color: 'var(--signal)' }}>Syncing…</div>
                    ) : lastSync ? (
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                        Last: {fmtDate(lastSync.completedAt)} · {lastSync.recordsProcessed} records
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Never synced</div>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Sync Results (after running) ── */}
          {syncResults && (
            <section className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Latest Sync Results</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {Object.entries(syncResults).map(([key, result]: [string, any]) => {
                  if (!result || typeof result !== 'object' || result.info) return null
                  const badge = statusBadge(result.status || 'UNKNOWN')
                  return (
                    <div key={key} style={{
                      padding: 14, borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{key}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px',
                          borderRadius: 6, color: badge.color, background: badge.bg,
                        }}>
                          {result.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.8 }}>
                        <div>Created: <strong>{result.recordsCreated ?? 0}</strong></div>
                        <div>Updated: <strong>{result.recordsUpdated ?? 0}</strong></div>
                        <div>Skipped: <strong>{result.recordsSkipped ?? 0}</strong></div>
                        {(result.recordsFailed ?? 0) > 0 && (
                          <div style={{ color: 'var(--data-negative)' }}>Failed: <strong>{result.recordsFailed}</strong></div>
                        )}
                        {result.durationMs && <div>Duration: {fmtDuration(result.durationMs)}</div>}
                      </div>
                      {result.errorMessage && (
                        <div style={{
                          marginTop: 8, padding: 8, borderRadius: 6,
                          background: 'rgba(220, 38, 38, 0.05)',
                          fontSize: 11, color: 'var(--data-negative)',
                          wordBreak: 'break-word',
                        }}>
                          {result.errorMessage}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Sync History ── */}
          <section className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontWeight: 600, margin: 0 }}>Sync History</h3>
            </div>
            {syncLogs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
                No sync history yet. Run your first sync above.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="datatable density-comfortable" style={{ minWidth: 800 }}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Direction</th>
                      <th>Status</th>
                      <th className="num">Created</th>
                      <th className="num">Updated</th>
                      <th className="num">Failed</th>
                      <th>Duration</th>
                      <th>Started</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLogs.map(log => {
                      const badge = statusBadge(log.status)
                      return (
                        <tr key={log.id}>
                          <td style={{ fontWeight: 500, textTransform: 'capitalize' }}>{log.syncType}</td>
                          <td>
                            <span style={{ fontSize: 12 }}>
                              {log.direction === 'PULL' ? '⬇️ Pull' : log.direction === 'PUSH' ? '⬆️ Push' : '🔄 Both'}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 8px',
                              borderRadius: 6, color: badge.color, background: badge.bg,
                            }}>
                              {log.status}
                            </span>
                          </td>
                          <td className="num data-mono">{log.recordsCreated}</td>
                          <td className="num data-mono">{log.recordsUpdated}</td>
                          <td className="num data-mono" style={{ color: log.recordsFailed > 0 ? 'var(--data-negative)' : undefined }}>
                            {log.recordsFailed}
                          </td>
                          <td style={{ fontSize: 12 }}>{fmtDuration(log.durationMs)}</td>
                          <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(log.startedAt)}</td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--data-negative)' }}>
                            {log.errorMessage || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Webhook Info ── */}
          <section className="glass-card" style={{ padding: 20, marginTop: 24 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Real-time Webhooks</h3>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 12 }}>
              Configure InFlow to send webhooks for real-time sync. Point webhooks to:
            </p>
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              fontFamily: 'monospace', fontSize: 13,
              userSelect: 'all',
            }}>
              https://app.abellumber.com/api/webhooks/inflow
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-muted)' }}>
              {config?.hasWebhookSecret
                ? '✓ Webhook secret configured — signatures will be verified'
                : '⚠ No webhook secret — configure one above for production security'}
            </div>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 8 }}>
              Supported events: product.created, product.updated, inventory.adjusted, purchaseorder.received, order.statusChanged
            </p>
          </section>
        </>
      )}
    </div>
  )
}
