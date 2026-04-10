'use client'

import { useState, useEffect } from 'react'

interface Integration {
  provider: string
  name: string
  description: string
  status: string
  lastSync?: string
  lastSyncStatus?: string
  config?: any
  recentSyncs: SyncLog[]
}

interface SyncLog {
  id: string
  syncType: string
  status: string
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsFailed: number
  durationMs: number
  startedAt: string
  errorMessage?: string
}

const STATUS_COLORS: Record<string, string> = {
  CONNECTED: '#10B981',
  CONFIGURING: '#F59E0B',
  ERROR: '#EF4444',
  DISABLED: '#9CA3AF',
  PENDING: '#6B7280',
}

const PROVIDER_ICONS: Record<string, string> = {
  QUICKBOOKS_DESKTOP: '💰',
  BUILDERTREND: '🏗️',
  BOISE_CASCADE: '🌲',
  INFLOW: '📦',
  ECI_BOLT: '⚡',
  GMAIL: '📧',
  HYPHEN: '🔗',
  BPW_PULTE: '🏠',
}

const PROVIDER_ACTIONS: Record<string, { label: string; href: string }[]> = {
  QUICKBOOKS_DESKTOP: [
    { label: 'Download QWC File', href: '/api/ops/integrations/quickbooks/qwc' },
    { label: 'View QB Status', href: '/ops/integrations/quickbooks' },
  ],
  BUILDERTREND: [
    { label: 'Manage Projects', href: '/ops/integrations/buildertrend' },
  ],
  BOISE_CASCADE: [
    { label: 'Upload Price Sheet', href: '/ops/integrations/supplier-pricing' },
  ],
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [configForm, setConfigForm] = useState<Record<string, string>>({})
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [origin, setOrigin] = useState('')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    setOrigin(window.location.origin)
    fetchIntegrations()
  }, [])

  async function fetchIntegrations() {
    try {
      const res = await fetch('/api/ops/integrations')
      const data = await res.json()
      setIntegrations(data.integrations || [])
    } catch (err) {
      console.error('Failed to fetch integrations:', err)
    } finally {
      setLoading(false)
    }
  }

  async function triggerSync(provider: string) {
    setSyncing(provider)
    try {
      const res = await fetch('/api/ops/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action: 'sync' }),
      })
      const result = await res.json()
      showToast(`Sync ${result.status}: ${result.recordsProcessed || 0} records processed, ${result.recordsCreated || 0} created, ${result.recordsUpdated || 0} updated`)
      fetchIntegrations()
    } catch (err) {
      console.error('Sync error:', err)
    } finally {
      setSyncing(null)
    }
  }

  async function saveConfig(provider: string) {
    try {
      const res = await fetch('/api/ops/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...configForm }),
      })
      if (res.ok) {
        setConfiguring(null)
        setConfigForm({})
        fetchIntegrations()
      }
    } catch (err) {
      console.error('Config save error:', err)
    }
  }

  async function testConnection(provider: string) {
    try {
      const res = await fetch('/api/ops/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action: 'test', ...configForm }),
      })
      const result = await res.json()
      showToast(result.success ? `Connected! ${result.message}` : `Failed: ${result.message}`, result.success ? 'success' : 'error')
    } catch (err) {
      console.error('Test error:', err)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50, padding: '12px 20px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', color: 'white', fontSize: 14, fontWeight: 500, background: toastType === 'success' ? '#16a34a' : '#dc2626' }}>
          {toast}
        </div>
      )}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>System Integrations</h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
          Connect InFlow, ECI Bolt, Gmail, and Hyphen to keep your data in sync
        </p>
      </div>

      {loading ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading integrations...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {integrations.map(integration => (
            <div key={integration.provider} style={{
              padding: 24,
              backgroundColor: 'white',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 28 }}>{PROVIDER_ICONS[integration.provider]}</span>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{integration.name}</h3>
                    <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{integration.description}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    backgroundColor: (STATUS_COLORS[integration.status] || '#9CA3AF') + '15',
                    color: STATUS_COLORS[integration.status] || '#9CA3AF',
                    fontSize: 12,
                    fontWeight: 600,
                  }}>
                    {integration.status === 'CONNECTED' ? '● Connected' : integration.status}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => {
                    if (configuring === integration.provider) {
                      setConfiguring(null)
                    } else {
                      setConfiguring(integration.provider)
                      setConfigForm({})
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#f3f4f6',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    color: '#374151',
                  }}
                >
                  {configuring === integration.provider ? 'Cancel' : '⚙️ Configure'}
                </button>
                {integration.status === 'CONNECTED' && (
                  <button
                    onClick={() => triggerSync(integration.provider)}
                    disabled={syncing === integration.provider}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#1B4F72',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: syncing === integration.provider ? 'wait' : 'pointer',
                      opacity: syncing === integration.provider ? 0.6 : 1,
                    }}
                  >
                    {syncing === integration.provider ? '⏳ Syncing...' : '🔄 Sync Now'}
                  </button>
                )}
              </div>

              {/* Config Form */}
              {configuring === integration.provider && (
                <div style={{
                  marginTop: 16,
                  padding: 16,
                  backgroundColor: '#f9fafb',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Configuration</h4>
                  {integration.provider === 'INFLOW' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={labelStyle}>API Key</label>
                        <input style={inputStyle} type="password" placeholder="Enter InFlow API key"
                          value={configForm.apiKey || ''} onChange={e => setConfigForm({...configForm, apiKey: e.target.value})} />
                      </div>
                      <div>
                        <label style={labelStyle}>Company ID</label>
                        <input style={inputStyle} placeholder="Your InFlow company ID"
                          value={configForm.companyId || ''} onChange={e => setConfigForm({...configForm, companyId: e.target.value})} />
                      </div>
                    </div>
                  )}
                  {integration.provider === 'ECI_BOLT' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={labelStyle}>API Key</label>
                        <input style={inputStyle} type="password" placeholder="ECI Bolt API key"
                          value={configForm.apiKey || ''} onChange={e => setConfigForm({...configForm, apiKey: e.target.value})} />
                      </div>
                      <div>
                        <label style={labelStyle}>Base URL</label>
                        <input style={inputStyle} placeholder="https://api.ecibolt.com"
                          value={configForm.baseUrl || ''} onChange={e => setConfigForm({...configForm, baseUrl: e.target.value})} />
                      </div>
                      <div>
                        <label style={labelStyle}>Company ID</label>
                        <input style={inputStyle} placeholder="Bolt account ID"
                          value={configForm.companyId || ''} onChange={e => setConfigForm({...configForm, companyId: e.target.value})} />
                      </div>
                    </div>
                  )}
                  {integration.provider === 'GMAIL' && (
                    <div>
                      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                        Gmail requires OAuth2 setup through Google Cloud Console. Configure a project with Gmail API enabled, create OAuth credentials for the abellumber.com domain, then enter the details below.
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={labelStyle}>Google Client ID</label>
                          <input style={inputStyle} placeholder="xxxx.apps.googleusercontent.com"
                            value={configForm.clientId || ''} onChange={e => setConfigForm({...configForm, clientId: e.target.value})} />
                        </div>
                        <div>
                          <label style={labelStyle}>Google Client Secret</label>
                          <input style={inputStyle} type="password" placeholder="Client secret"
                            value={configForm.clientSecret || ''} onChange={e => setConfigForm({...configForm, clientSecret: e.target.value})} />
                        </div>
                      </div>
                    </div>
                  )}
                  {integration.provider === 'HYPHEN' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={labelStyle}>API Key</label>
                        <input style={inputStyle} type="password" placeholder="Hyphen API key"
                          value={configForm.apiKey || ''} onChange={e => setConfigForm({...configForm, apiKey: e.target.value})} />
                      </div>
                      <div>
                        <label style={labelStyle}>Base URL</label>
                        <input style={inputStyle} placeholder="https://api.hyphen.com"
                          value={configForm.baseUrl || ''} onChange={e => setConfigForm({...configForm, baseUrl: e.target.value})} />
                      </div>
                      <div>
                        <label style={labelStyle}>Supplier ID</label>
                        <input style={inputStyle} placeholder="Abel's supplier ID"
                          value={configForm.companyId || ''} onChange={e => setConfigForm({...configForm, companyId: e.target.value})} />
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <button onClick={() => testConnection(integration.provider)} style={{ padding: '8px 16px', backgroundColor: '#E67E22', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Test Connection
                    </button>
                    <button onClick={() => saveConfig(integration.provider)} style={{ padding: '8px 16px', backgroundColor: '#1B4F72', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Save Configuration
                    </button>
                  </div>
                </div>
              )}

              {/* Recent Syncs */}
              {integration.recentSyncs.length > 0 && (
                <div style={{ marginTop: 16, borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>RECENT SYNC ACTIVITY</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {integration.recentSyncs.slice(0, 3).map(sync => (
                      <div key={sync.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            backgroundColor: sync.status === 'SUCCESS' ? '#10B981' : sync.status === 'PARTIAL' ? '#F59E0B' : '#EF4444',
                          }} />
                          <span style={{ color: '#374151' }}>{sync.syncType}</span>
                          <span style={{ color: '#9ca3af' }}>
                            {sync.recordsProcessed} processed, {sync.recordsCreated} new, {sync.recordsUpdated} updated
                            {sync.recordsFailed > 0 && <span style={{ color: '#EF4444' }}>, {sync.recordsFailed} failed</span>}
                          </span>
                        </div>
                        <span style={{ color: '#9ca3af' }}>
                          {new Date(sync.startedAt).toLocaleString()} · {(sync.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Last Sync */}
              {integration.lastSync && (
                <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                  Last synced: {new Date(integration.lastSync).toLocaleString()} · Status: {integration.lastSyncStatus}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Webhook URLs Info */}
      <div style={{
        marginTop: 32,
        padding: 20,
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Webhook Endpoints</h3>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          Configure these URLs in your external systems to receive real-time updates:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'InFlow', url: '/api/webhooks/inflow' },
            { label: 'Gmail (Pub/Sub)', url: '/api/webhooks/gmail' },
            { label: 'Hyphen', url: '/api/webhooks/hyphen' },
          ].map(wh => (
            <div key={wh.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', width: 120 }}>{wh.label}:</span>
              <code style={{ fontSize: 12, color: '#1B4F72', backgroundColor: '#EBF5FB', padding: '4px 8px', borderRadius: 4 }}>
                {origin}{wh.url}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }
