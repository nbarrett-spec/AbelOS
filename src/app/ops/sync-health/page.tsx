'use client'

import { useState, useEffect, useCallback } from 'react'

interface SyncHealth {
  integrations: any[]
  latestSyncs: any[]
  recentErrors: any[]
  syncVolume: { last24h: any[]; last7d: any[] }
  cronRuns: Record<string, any[]>
  tableCounts: Record<string, number>
  staleness: Record<string, any>
  orphanedProducts: number
  dataSources: { products: any; orders: any }
  timestamp: string
}

export default function SyncHealthPage() {
  const [data, setData] = useState<SyncHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/sync-health')
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const json = await res.json()
      setData(json)
      setLastRefresh(new Date())
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [fetchData])

  const triggerSync = async (provider: string) => {
    setSyncing(provider)
    try {
      const res = await fetch('/api/ops/sync-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Sync failed')
      // Refresh data after sync
      setTimeout(fetchData, 2000)
    } catch (err: any) {
      alert(`Sync error: ${err.message}`)
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 20, height: 20, border: '3px solid #C6A24E', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <span style={{ color: '#6B5A4E', fontSize: 15 }}>Loading sync health data...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 16 }}>
          <strong style={{ color: '#991B1B' }}>Error loading sync data:</strong>
          <p style={{ color: '#DC2626', margin: '8px 0 0' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const providers = [
    { key: 'inflow', label: 'InFlow', desc: 'Products, inventory, POs, sales orders', color: '#2563EB' },
    { key: 'bolt', label: 'ECI Bolt', desc: 'Customers, orders, jobs, invoices', color: '#7C3AED' },
    { key: 'hyphen', label: 'Hyphen', desc: 'Brookfield schedules, payments, orders', color: '#059669' },
    { key: 'bpw', label: 'BPW Pulte', desc: 'Communities, jobs, schedules', color: '#D97706' },
  ]

  const stalenessKeys = Object.keys(data.staleness)

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', margin: 0 }}>Sync Health & Data Freshness</h1>
          <p style={{ fontSize: 13, color: '#8B7355', margin: '4px 0 0' }}>
            Live status of all data integrations — what's current, what's stale, what's broken
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            style={{ padding: '8px 16px', background: '#0f2a3e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Data Freshness Indicators */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stalenessKeys.map(key => {
          const s = data.staleness[key]
          const isStale = s.isStale
          return (
            <div key={key} style={{
              background: isStale ? '#FEF2F2' : '#F0FDF4',
              border: `1px solid ${isStale ? '#FECACA' : '#BBF7D0'}`,
              borderRadius: 8,
              padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize', color: '#6B5A4E' }}>{key}</span>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isStale ? '#EF4444' : '#22C55E',
                  display: 'inline-block',
                }} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: isStale ? '#DC2626' : '#16A34A', marginTop: 4 }}>
                {s.ageHuman}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                Threshold: {s.threshold}
              </div>
            </div>
          )
        })}
      </div>

      {/* Integration Status Cards */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f2a3e', marginBottom: 12 }}>Integration Status</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 32 }}>
        {providers.map(prov => {
          const config = data.integrations.find((i: any) => i.provider === prov.key.toUpperCase() || i.provider === prov.key)
          const syncs = data.latestSyncs.filter((s: any) => s.provider === prov.key.toUpperCase() || s.provider === prov.key)
          const vol24h = data.syncVolume.last24h.filter((v: any) => v.provider === prov.key.toUpperCase() || v.provider === prov.key)
          const isConnected = config?.status === 'CONNECTED'
          const isConfigured = !!config

          return (
            <div key={prov.key} style={{
              background: '#fff',
              border: '1px solid #E5E7EB',
              borderRadius: 10,
              overflow: 'hidden',
            }}>
              {/* Card header */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #F3F4F6',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#FAFAFA',
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: isConnected ? '#22C55E' : isConfigured ? '#F59E0B' : '#EF4444' }} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#1F2937' }}>{prov.label}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{prov.desc}</span>
                </div>
                <button
                  onClick={() => triggerSync(prov.key)}
                  disabled={syncing === prov.key || !isConnected}
                  style={{
                    padding: '6px 14px',
                    background: isConnected ? prov.color : '#D1D5DB',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: isConnected ? 'pointer' : 'not-allowed',
                    fontSize: 12,
                    fontWeight: 600,
                    opacity: syncing === prov.key ? 0.6 : 1,
                  }}
                >
                  {syncing === prov.key ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>

              {/* Config status */}
              {!isConfigured && (
                <div style={{ padding: '12px 16px', background: '#FEF3C7', borderBottom: '1px solid #FDE68A' }}>
                  <span style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>
                    ⚠ Not configured — go to Settings → Integrations to set up
                  </span>
                </div>
              )}
              {isConfigured && !isConnected && (
                <div style={{ padding: '12px 16px', background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
                  <span style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                    Status: {config.status} — check credentials
                  </span>
                </div>
              )}

              {/* Sync types */}
              <div style={{ padding: '12px 16px' }}>
                {syncs.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#9CA3AF', fontStyle: 'italic' }}>No sync history found</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {syncs.map((s: any, i: number) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 10px', background: '#F9FAFB', borderRadius: 6,
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{s.syncType}</div>
                          <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                            {s.recordsProcessed} processed • {s.recordsUpdated} updated • {s.recordsFailed} failed
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                            background: s.status === 'SUCCESS' ? '#DCFCE7' : s.status === 'PARTIAL' ? '#FEF3C7' : '#FEE2E2',
                            color: s.status === 'SUCCESS' ? '#166534' : s.status === 'PARTIAL' ? '#92400E' : '#991B1B',
                          }}>
                            {s.status}
                          </span>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                            {s.completedAt ? formatTimeAgo(new Date(s.completedAt)) : 'N/A'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 24h volume */}
              {vol24h.length > 0 && (
                <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #F3F4F6' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Last 24h</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {vol24h.map((v: any, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: '#6B7280' }}>
                        <span style={{ fontWeight: 600 }}>{v.syncType}:</span> {v.run_count} runs, {v.total_processed} records
                        {v.failed_runs > 0 && <span style={{ color: '#EF4444' }}> ({v.failed_runs} failed)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Table Counts + Data Sources */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
        {/* Record counts */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f2a3e', marginTop: 0, marginBottom: 12 }}>Record Counts</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', color: '#6B7280', fontWeight: 600 }}>Table</th>
                <th style={{ textAlign: 'right', padding: '6px 0', color: '#6B7280', fontWeight: 600 }}>Total</th>
                <th style={{ textAlign: 'right', padding: '6px 0', color: '#6B7280', fontWeight: 600 }}>Active/Open</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Products', data.tableCounts.products, data.tableCounts.active_products],
                ['Inventory Items', data.tableCounts.inventory_items, null],
                ['Orders', data.tableCounts.orders, data.tableCounts.open_orders],
                ['Jobs', data.tableCounts.jobs, data.tableCounts.active_jobs],
                ['Invoices', data.tableCounts.invoices, data.tableCounts.open_invoices],
                ['Purchase Orders', data.tableCounts.purchase_orders, data.tableCounts.open_pos],
                ['Builders', data.tableCounts.builders, null],
                ['Builder Orgs', data.tableCounts.builder_orgs, null],
                ['Vendors', data.tableCounts.vendors, null],
              ].map(([label, total, active], i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '8px 0', color: '#374151' }}>{label}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: '#1F2937' }}>{total?.toLocaleString() ?? '—'}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', color: '#6B7280' }}>{active != null ? active.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.orphanedProducts > 0 && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#FEF3C7', borderRadius: 6, fontSize: 12, color: '#92400E' }}>
              ⚠ {data.orphanedProducts} active products have no inventory record — may need InFlow inventory re-sync
            </div>
          )}
        </div>

        {/* Data sources breakdown */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f2a3e', marginTop: 0, marginBottom: 12 }}>Data Sources</h3>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Products</div>
            <SourceBar
              segments={[
                { label: 'InFlow', value: data.dataSources.products.from_inflow || 0, color: '#2563EB' },
                { label: 'Manual', value: data.dataSources.products.manual || 0, color: '#9CA3AF' },
              ]}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Orders</div>
            <SourceBar
              segments={[
                { label: 'InFlow', value: data.dataSources.orders.from_inflow || 0, color: '#2563EB' },
                { label: 'Bolt/Manual', value: data.dataSources.orders.manual_or_bolt || 0, color: '#7C3AED' },
              ]}
            />
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f2a3e', marginTop: 20, marginBottom: 12 }}>Cron Run History</h3>
          {Object.entries(data.cronRuns).map(([cronName, runs]) => {
            const recent = (runs as any[]).slice(0, 5)
            const lastRun = recent[0]
            return (
              <div key={cronName} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{cronName}</span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                    Last: {lastRun?.startedAt ? formatTimeAgo(new Date(lastRun.startedAt)) : 'Never'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {recent.map((run: any, i: number) => (
                    <div key={i} title={`${run.status} — ${run.startedAt ? new Date(run.startedAt).toLocaleString() : ''}`} style={{
                      flex: 1, height: 6, borderRadius: 3,
                      background: run.status === 'SUCCESS' ? '#22C55E' : run.status === 'RUNNING' ? '#3B82F6' : '#EF4444',
                    }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent Errors */}
      {data.recentErrors.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 20, marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#991B1B', marginTop: 0, marginBottom: 12 }}>
            Recent Sync Errors ({data.recentErrors.length})
          </h3>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#fff' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6B7280' }}>Provider</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6B7280' }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6B7280' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6B7280' }}>Error</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6B7280' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {data.recentErrors.map((err: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{err.provider}</td>
                    <td style={{ padding: '6px 8px' }}>{err.syncType}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: err.status === 'FAILED' ? '#FEE2E2' : '#FEF3C7',
                        color: err.status === 'FAILED' ? '#991B1B' : '#92400E',
                      }}>{err.status}</span>
                    </td>
                    <td style={{ padding: '6px 8px', color: '#DC2626', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {err.errorMessage || '—'}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                      {err.completedAt ? formatTimeAgo(new Date(err.completedAt)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function SourceBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return <div style={{ fontSize: 12, color: '#9CA3AF' }}>No data</div>

  return (
    <div>
      <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', marginBottom: 4 }}>
        {segments.map((s, i) => (
          <div key={i} style={{
            width: `${(s.value / total) * 100}%`,
            background: s.color,
            minWidth: s.value > 0 ? 2 : 0,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {segments.map((s, i) => (
          <span key={i} style={{ fontSize: 11, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}: {s.value.toLocaleString()} ({total > 0 ? Math.round((s.value / total) * 100) : 0}%)
          </span>
        ))}
      </div>
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}
