'use client'

import { useState, useEffect } from 'react'

// Direction badges
const DIRECTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PULL: { bg: 'bg-blue-100', text: 'text-blue-700', label: '↓ PULL' },
  PUSH: { bg: 'bg-green-100', text: 'text-green-700', label: '↑ PUSH' },
  INBOUND: { bg: 'bg-purple-100', text: 'text-purple-700', label: '← INBOUND' },
  BIDIRECTIONAL: { bg: 'bg-orange-100', text: 'text-orange-700', label: '↔ BIDIR' },
  INTERNAL: { bg: 'bg-gray-100', text: 'text-gray-700', label: '⟳ INTERNAL' },
  CONFIG: { bg: 'bg-slate-100', text: 'text-slate-700', label: '⚙ CONFIG' },
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  ACTIVE: { dot: 'bg-green-500', label: 'Active' },
  PENDING: { dot: 'bg-yellow-500', label: 'Pending' },
  CONFIGURING: { dot: 'bg-blue-500', label: 'Configuring' },
  ERROR: { dot: 'bg-red-500', label: 'Error' },
  NOT_CONFIGURED: { dot: 'bg-gray-400', label: 'Not Configured' },
  READY: { dot: 'bg-green-500', label: 'Ready' },
}

const PROVIDER_ICONS: Record<string, string> = {
  INFLOW: '📦',
  BUILDERTREND: '🏗️',
  BOISE_CASCADE: '🌲',
}

interface RouteInfo {
  name: string
  direction: string
  source: string
  target: string
  endpoint: string
  libFunction: string
  dataFields: string
  status: string
  stats: string | null
}

interface IntegrationGroup {
  integration: string
  provider: string
  routes: RouteInfo[]
}

interface ConfigInfo {
  provider: string
  status: string
  syncEnabled: boolean
  hasCredentials: boolean
  hasWebhookSecret: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
}

interface SyncLog {
  provider: string
  syncType: string
  direction: string
  status: string
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsFailed: number
  durationMs: number
  startedAt: string
  completedAt: string | null
  errorMessage: string | null
}

interface HealthData {
  auditTimestamp: string
  summary: {
    totalRoutes: number
    integrations: number
    configuredCount: number
    pendingCount: number
    errorCount: number
    recentSyncCount: number
    failedSyncCount: number
    partialSyncCount: number
  }
  routingMap: IntegrationGroup[]
  configs: ConfigInfo[]
  recentSyncs: SyncLog[]
  qbQueueStats: any
  btMappingStats: any
  supplierPriceStats: any
  productSyncStats: any
  builderQbStats: any
  invoiceQbStats: any
}

export default function RoutingAuditPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedIntegrations, setExpandedIntegrations] = useState<Set<string>>(new Set())
  const [selectedRoute, setSelectedRoute] = useState<RouteInfo | null>(null)
  const [tab, setTab] = useState<'routing' | 'configs' | 'syncs' | 'coverage'>('routing')

  useEffect(() => {
    loadHealth()
  }, [])

  async function loadHealth() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/integrations/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      // Expand all integrations by default
      const allProviders = new Set<string>(json.routingMap.map((g: IntegrationGroup) => g.provider))
      setExpandedIntegrations(allProviders)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleIntegration(provider: string) {
    setExpandedIntegrations(prev => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  function formatDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })
  }

  function formatBytes(bytes: number) {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Running integration health audit...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-10">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 font-medium">Health Check Failed</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
          <button onClick={loadHealth} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { summary, routingMap, configs, recentSyncs } = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integration Routing Audit</h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete data flow map across all integrations &middot; Audited {formatDate(data.auditTimestamp)}
          </p>
        </div>
        <button
          onClick={loadHealth}
          className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg text-sm hover:bg-[#163d5a] transition flex items-center gap-2"
        >
          <span>↻</span> Re-Audit
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <SummaryCard label="Total Routes" value={summary.totalRoutes} color="blue" />
        <SummaryCard label="Integrations" value={summary.integrations} color="blue" />
        <SummaryCard label="Connected" value={summary.configuredCount} color="green" />
        <SummaryCard label="Pending" value={summary.pendingCount} color="yellow" />
        <SummaryCard label="Errors" value={summary.errorCount} color="red" />
        <SummaryCard label="Recent Syncs" value={summary.recentSyncCount} color="blue" />
        <SummaryCard label="Failed Syncs" value={summary.failedSyncCount} color="red" />
        <SummaryCard label="Partial Syncs" value={summary.partialSyncCount} color="orange" />
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-0">
        {(['routing', 'configs', 'syncs', 'coverage'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t
                ? 'border-[#C6A24E] text-[#C6A24E]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'routing' && '🗺️ Routing Map'}
            {t === 'configs' && '⚙️ Configurations'}
            {t === 'syncs' && '🔄 Sync History'}
            {t === 'coverage' && '📊 Data Coverage'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'routing' && (
        <div className="space-y-4">
          {routingMap.map(group => (
            <div key={group.provider} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {/* Integration Header */}
              <button
                onClick={() => toggleIntegration(group.provider)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{PROVIDER_ICONS[group.provider] || '🔗'}</span>
                  <div className="text-left">
                    <h3 className="text-lg font-semibold text-gray-900">{group.integration}</h3>
                    <p className="text-xs text-gray-500">{group.routes.length} data routes</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <IntegrationStatusBadge configs={configs} provider={group.provider} />
                  <span className="text-gray-400 text-lg">
                    {expandedIntegrations.has(group.provider) ? '▾' : '▸'}
                  </span>
                </div>
              </button>

              {/* Routes Table */}
              {expandedIntegrations.has(group.provider) && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-4 py-2.5 font-medium text-gray-600 w-1/5">Route</th>
                        <th className="px-4 py-2.5 font-medium text-gray-600 w-20">Direction</th>
                        <th className="px-4 py-2.5 font-medium text-gray-600">Source → Target</th>
                        <th className="px-4 py-2.5 font-medium text-gray-600 w-24">Status</th>
                        <th className="px-4 py-2.5 font-medium text-gray-600">Stats</th>
                        <th className="px-4 py-2.5 font-medium text-gray-600 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.routes.map((route, idx) => {
                        const dir = DIRECTION_STYLES[route.direction] || DIRECTION_STYLES.INTERNAL
                        const status = STATUS_STYLES[route.status] || STATUS_STYLES.NOT_CONFIGURED
                        return (
                          <tr key={idx} className="border-t hover:bg-blue-50/30 transition">
                            <td className="px-4 py-3">
                              <span className="font-medium text-gray-900">{route.name}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${dir.bg} ${dir.text}`}>
                                {dir.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              <span className="font-mono text-xs">{route.source}</span>
                              <span className="mx-1.5 text-gray-400">→</span>
                              <span className="font-mono text-xs">{route.target}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                                <span className="text-xs text-gray-600">{status.label}</span>
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {route.stats || '—'}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setSelectedRoute(route)}
                                className="text-[#0f2a3e] hover:text-[#C6A24E] text-xs font-medium"
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'configs' && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Provider</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Sync Enabled</th>
                <th className="px-4 py-3 font-medium text-gray-600">Credentials</th>
                <th className="px-4 py-3 font-medium text-gray-600">Webhook Secret</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Sync</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Sync Status</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No integration configurations found. Visit the Integration Hub to set up connections.
                  </td>
                </tr>
              ) : (
                configs.map((cfg, idx) => {
                  const statusStyle = STATUS_STYLES[cfg.status] || STATUS_STYLES.NOT_CONFIGURED
                  return (
                    <tr key={idx} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                        <span>{PROVIDER_ICONS[cfg.provider] || '🔗'}</span>
                        {cfg.provider.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
                          <span className="text-xs">{cfg.status}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cfg.syncEnabled ? (
                          <span className="text-green-600 font-medium text-xs">✓ Enabled</span>
                        ) : (
                          <span className="text-gray-400 text-xs">✗ Disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {cfg.hasCredentials ? (
                          <span className="text-green-600 text-xs">✓ Present</span>
                        ) : (
                          <span className="text-red-500 text-xs">✗ Missing</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {cfg.hasWebhookSecret ? (
                          <span className="text-green-600 text-xs">✓ Set</span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(cfg.lastSyncAt)}</td>
                      <td className="px-4 py-3">
                        {cfg.lastSyncStatus ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            cfg.lastSyncStatus === 'SUCCESS' ? 'bg-green-100 text-green-700' :
                            cfg.lastSyncStatus === 'FAILED' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {cfg.lastSyncStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Never synced</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'syncs' && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-medium text-gray-700">Recent Sync Logs (Last 7 Days)</h3>
            <span className="text-xs text-gray-500">{recentSyncs.length} records</span>
          </div>
          {recentSyncs.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              <p className="text-lg mb-1">No sync activity</p>
              <p className="text-sm text-gray-400">No syncs have been executed in the last 7 days.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-t">
                  <th className="px-4 py-2.5 font-medium text-gray-600">Provider</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Type</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Direction</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Status</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Records</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Duration</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Started</th>
                  <th className="px-4 py-2.5 font-medium text-gray-600">Error</th>
                </tr>
              </thead>
              <tbody>
                {recentSyncs.map((sync, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {PROVIDER_ICONS[sync.provider] || '🔗'} {sync.provider.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{sync.syncType}</td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const d = DIRECTION_STYLES[sync.direction] || DIRECTION_STYLES.INTERNAL
                        return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${d.bg} ${d.text}`}>{d.label}</span>
                      })()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        sync.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                        sync.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                        sync.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {sync.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      <span title="Processed">{sync.recordsProcessed || 0}</span>
                      {' / '}
                      <span className="text-green-600" title="Created">{sync.recordsCreated || 0}↑</span>
                      {' / '}
                      <span className="text-blue-600" title="Updated">{sync.recordsUpdated || 0}~</span>
                      {sync.recordsFailed > 0 && (
                        <>
                          {' / '}
                          <span className="text-red-600" title="Failed">{sync.recordsFailed}✗</span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {sync.durationMs ? `${(sync.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{formatDate(sync.startedAt)}</td>
                    <td className="px-4 py-2.5 text-xs text-red-500 max-w-[200px] truncate" title={sync.errorMessage || ''}>
                      {sync.errorMessage || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'coverage' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Product Sync Coverage */}
          <CoverageCard
            title="Product ↔ InFlow"
            icon="📦"
            stats={data.productSyncStats}
            fields={[
              { label: 'Total Products', key: 'totalProducts' },
              { label: 'InFlow Linked', key: 'inflowLinked' },
              { label: 'Recently Synced', key: 'recentlySynced' },
            ]}
          />

          {/* Builder QB Coverage */}
          <CoverageCard
            title="Builder ↔ QuickBooks"
            icon="💰"
            stats={data.builderQbStats}
            fields={[
              { label: 'Total Builders', key: 'totalBuilders' },
              { label: 'QB Linked', key: 'qbLinked' },
              { label: 'QB Synced', key: 'qbSynced' },
            ]}
          />

          {/* Invoice QB Coverage */}
          <CoverageCard
            title="Invoice ↔ QuickBooks"
            icon="🧾"
            stats={data.invoiceQbStats}
            fields={[
              { label: 'Total Invoices', key: 'totalInvoices' },
              { label: 'QB Linked', key: 'qbLinked' },
              { label: 'QB Synced', key: 'qbSynced' },
            ]}
          />

          {/* QB Queue Stats */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📤</span>
              <h3 className="font-semibold text-gray-900">QB Sync Queue</h3>
            </div>
            {data.qbQueueStats?.error ? (
              <p className="text-sm text-gray-400">{data.qbQueueStats.error}</p>
            ) : data.qbQueueStats ? (
              <div className="space-y-2">
                <QueueRow label="Pending" value={data.qbQueueStats.PENDING || 0} color="yellow" />
                <QueueRow label="Processing" value={data.qbQueueStats.PROCESSING || 0} color="blue" />
                <QueueRow label="Completed" value={data.qbQueueStats.COMPLETED || 0} color="green" />
                <QueueRow label="Failed" value={data.qbQueueStats.FAILED || 0} color="red" />
              </div>
            ) : (
              <p className="text-sm text-gray-400">No queue data</p>
            )}
          </div>

          {/* BT Mapping Stats */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">🏗️</span>
              <h3 className="font-semibold text-gray-900">BuilderTrend Mappings</h3>
            </div>
            {data.btMappingStats?.error ? (
              <p className="text-sm text-gray-400">{data.btMappingStats.error}</p>
            ) : data.btMappingStats ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Projects</span>
                  <span className="font-semibold text-gray-900">{data.btMappingStats.total}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Mapped to Abel</span>
                  <span className="font-semibold text-green-600">{data.btMappingStats.mapped}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Unmapped</span>
                  <span className={`font-semibold ${data.btMappingStats.unmapped > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                    {data.btMappingStats.unmapped}
                  </span>
                </div>
                {data.btMappingStats.total > 0 && (
                  <div className="pt-2 border-t">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${(data.btMappingStats.mapped / data.btMappingStats.total * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-right">
                      {((data.btMappingStats.mapped / data.btMappingStats.total) * 100).toFixed(0)}% mapped
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No mapping data</p>
            )}
          </div>

          {/* Supplier Pricing Stats */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">🌲</span>
              <h3 className="font-semibold text-gray-900">Supplier Price Updates</h3>
            </div>
            {data.supplierPriceStats?.error ? (
              <p className="text-sm text-gray-400">{data.supplierPriceStats.error}</p>
            ) : data.supplierPriceStats ? (
              <div className="space-y-2">
                <QueueRow label="Pending" value={data.supplierPriceStats.PENDING || 0} color="yellow" />
                <QueueRow label="Approved" value={data.supplierPriceStats.APPROVED || 0} color="green" />
                <QueueRow label="Applied" value={data.supplierPriceStats.APPLIED || 0} color="blue" />
                <QueueRow label="Rejected" value={data.supplierPriceStats.REJECTED || 0} color="red" />
              </div>
            ) : (
              <p className="text-sm text-gray-400">No pricing data</p>
            )}
          </div>
        </div>
      )}

      {/* Route Detail Modal */}
      {selectedRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedRoute(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">{selectedRoute.name}</h3>
              <button onClick={() => setSelectedRoute(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <DetailRow label="Direction" value={
                (() => {
                  const d = DIRECTION_STYLES[selectedRoute.direction] || DIRECTION_STYLES.INTERNAL
                  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${d.bg} ${d.text}`}>{d.label}</span>
                })()
              } />
              <DetailRow label="Source" value={<span className="font-mono text-xs">{selectedRoute.source}</span>} />
              <DetailRow label="Target" value={<span className="font-mono text-xs">{selectedRoute.target}</span>} />
              <DetailRow label="Endpoint" value={<span className="font-mono text-xs break-all">{selectedRoute.endpoint}</span>} />
              <DetailRow label="Library Function" value={<span className="font-mono text-xs">{selectedRoute.libFunction}</span>} />
              <DetailRow label="Data Fields" value={<span className="text-xs text-gray-600">{selectedRoute.dataFields}</span>} />
              <DetailRow label="Status" value={
                (() => {
                  const s = STATUS_STYLES[selectedRoute.status] || STATUS_STYLES.NOT_CONFIGURED
                  return (
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                      <span className="text-xs">{s.label}</span>
                    </span>
                  )
                })()
              } />
              {selectedRoute.stats && (
                <DetailRow label="Stats" value={<span className="text-xs text-gray-600">{selectedRoute.stats}</span>} />
              )}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 rounded-b-xl flex justify-end">
              <button
                onClick={() => setSelectedRoute(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    red: 'bg-red-50 text-red-700',
    orange: 'bg-orange-50 text-orange-700',
  }
  return (
    <div className={`rounded-lg p-3 ${colorMap[color] || colorMap.blue}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[10px] font-medium opacity-70 uppercase tracking-wide">{label}</p>
    </div>
  )
}

function IntegrationStatusBadge({ configs, provider }: { configs: ConfigInfo[]; provider: string }) {
  const cfg = configs.find(c => c.provider === provider)
  if (!cfg) {
    return <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">Not Configured</span>
  }
  const colors: Record<string, string> = {
    CONNECTED: 'bg-green-100 text-green-700',
    PENDING: 'bg-yellow-100 text-yellow-700',
    CONFIGURING: 'bg-blue-100 text-blue-700',
    ERROR: 'bg-red-100 text-red-700',
    DISCONNECTED: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs px-2 py-1 rounded font-medium ${colors[cfg.status] || colors.PENDING}`}>
      {cfg.status}
    </span>
  )
}

function CoverageCard({ title, icon, stats, fields }: {
  title: string
  icon: string
  stats: any
  fields: { label: string; key: string }[]
}) {
  if (!stats) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">{icon}</span>
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    )
  }

  const total = stats[fields[0].key] || 1
  const linked = stats[fields[1].key] || 0

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="space-y-3">
        {fields.map(f => (
          <div key={f.key} className="flex justify-between text-sm">
            <span className="text-gray-500">{f.label}</span>
            <span className="font-semibold text-gray-900">{stats[f.key] ?? 0}</span>
          </div>
        ))}
        <div className="pt-2 border-t">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-[#0f2a3e] h-2 rounded-full transition-all"
              style={{ width: `${Math.min((linked / total) * 100, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-1 text-right">
            {((linked / total) * 100).toFixed(0)}% coverage
          </p>
        </div>
      </div>
    </div>
  )
}

function QueueRow({ label, value, color }: { label: string; value: number; color: string }) {
  const dots: Record<string, string> = {
    yellow: 'bg-yellow-500',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
  }
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-gray-500">
        <span className={`w-2 h-2 rounded-full ${dots[color]}`} />
        {label}
      </span>
      <span className={`font-semibold ${value > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{value}</span>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-gray-900">{value}</div>
    </div>
  )
}
