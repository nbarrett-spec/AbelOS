'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ActivitySquare, BarChart3, Database, RefreshCw, ZapOff, CheckCircle2, AlertCircle, Brain } from 'lucide-react'
import { KPICard, PageHeader } from '@/components/ui'

interface EntityScore {
  entity_id: string
  name: string
  type: string
  score: string // A, B, C, D, F
  confidence?: number
  health: string
  lastUpdated?: string
}

interface BrainHealth {
  online: boolean
  status: string
  entityCount?: number
  lastSync?: string
  uptime?: number
  version?: string
}

interface KnowledgeStats {
  products?: number
  customers?: number
  vendors?: number
  staff?: number
  inventory?: number
  deals?: number
  [key: string]: number | undefined
}

interface SyncStatus {
  products: { synced: number; total: number }
  customers: { synced: number; total: number }
  vendors: { synced: number; total: number }
  [key: string]: { synced: number; total: number }
}

export default function BrainDashboard() {
  const [scores, setScores] = useState<EntityScore[]>([])
  const [health, setHealth] = useState<BrainHealth | null>(null)
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [scoresResp, healthResp, statsResp] = await Promise.all([
        fetch('/api/ops/brain/scores'),
        fetch('/api/ops/brain/proxy?path=health'),
        fetch('https://jarvis-command-center-navy.vercel.app/api/knowledge?view=stats').catch(() => ({
          ok: false as const,
          json: async () => null,
        })),
      ])

      const scoresData = await scoresResp.json()
      const healthData = await healthResp.json()
      const statsData = statsResp.ok ? await (statsResp as Response).json() : null

      if (scoresData.scores) {
        setScores(scoresData.scores)
      }
      if (healthData) {
        setHealth(healthData)
      }
      if (statsData?.stats) {
        setStats(statsData.stats)
      }

      // Build sync status from scores (assume all accounts with scores are synced)
      const syncEstimate: SyncStatus = {
        products: { synced: stats?.products || 0, total: 5000 },
        customers: { synced: scoresData.scores?.filter((s: EntityScore) => s.type === 'customer').length || 0, total: 100 },
        vendors: { synced: scoresData.scores?.filter((s: EntityScore) => s.type === 'vendor').length || 0, total: 50 },
      }
      setSyncStatus(syncEstimate)
    } catch (err) {
      console.error('Failed to load brain data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const response = await fetch('/api/ops/brain/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (response.ok) {
        console.log('Sync results:', data)
        setTimeout(() => loadAll(), 3000)
      } else {
        console.error('Sync returned error:', data)
      }
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Loading" title="Brain Intelligence" description="Fetching knowledge base stats…" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
      </div>
    )
  }

  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const scoreGrade = (s: string) => {
    const base = s?.charAt(0) || '?'
    if (base === 'A') return 'bg-emerald-100 text-emerald-700'
    if (base === 'B') return 'bg-green-100 text-green-700'
    if (base === 'C') return 'bg-yellow-100 text-yellow-700'
    if (base === 'D') return 'bg-orange-100 text-orange-700'
    if (base === 'F') return 'bg-red-100 text-red-700'
    return 'bg-gray-100 text-gray-700'
  }

  const topScores = scores.slice(0, 10).sort((a, b) => {
    const scoreOrder = { A: 0, B: 1, C: 2, D: 3, F: 4 }
    const aScore = scoreOrder[a.score?.charAt(0) as keyof typeof scoreOrder] ?? 5
    const bScore = scoreOrder[b.score?.charAt(0) as keyof typeof scoreOrder] ?? 5
    return aScore - bScore
  })

  const scoreBreakdown = {
    A: scores.filter(s => s.score?.startsWith('A')).length,
    B: scores.filter(s => s.score?.startsWith('B')).length,
    C: scores.filter(s => s.score?.startsWith('C')).length,
    D: scores.filter(s => s.score?.startsWith('D')).length,
    F: scores.filter(s => s.score?.startsWith('F')).length,
  }

  const totalEntities = Object.values(scoreBreakdown).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5 animate-enter">
      <div className="flex items-start justify-between">
        <PageHeader
          eyebrow={todayDate}
          title="Brain Intelligence"
          description="NUC knowledge base, entity scores, and sync status."
        />
        <button
          onClick={handleSync}
          disabled={syncing}
          className="mt-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-[#0a1a28] transition-colors disabled:bg-gray-300 font-medium flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Brain Health KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Brain Status"
          accent="brand"
          value={health?.online ? 'Online' : 'Offline'}
          icon={health?.online ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
          subtitle={health?.status || 'Connecting...'}
        />
        <KPICard
          title="Total Entities"
          accent="accent"
          value={totalEntities.toLocaleString()}
          subtitle={`${stats?.customers || 0} customers · ${stats?.vendors || 0} vendors`}
          icon={<Database className="w-3.5 h-3.5" />}
        />
        <KPICard
          title="Knowledge Entries"
          accent="positive"
          value={(health?.entityCount || 5725).toLocaleString()}
          subtitle="JSONL records loaded"
          icon={<Brain className="w-3.5 h-3.5" />}
        />
        <KPICard
          title="Last Sync"
          accent="forecast"
          value={health?.lastSync ? new Date(health.lastSync).toLocaleTimeString() : 'Never'}
          subtitle={health?.lastSync ? `${Math.round((Date.now() - new Date(health.lastSync).getTime()) / 60000)}m ago` : 'Pending'}
          icon={<ActivitySquare className="w-3.5 h-3.5" />}
        />
      </div>

      {/* Entity Score Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-brand" />
              Entity Score Distribution
            </h3>
          </div>
          <div className="space-y-3">
            {Object.entries(scoreBreakdown)
              .sort(([aGrade], [bGrade]) => {
                const order = ['A', 'B', 'C', 'D', 'F']
                return order.indexOf(aGrade) - order.indexOf(bGrade)
              })
              .map(([grade, count]) => {
                const pct = totalEntities > 0 ? (count / totalEntities) * 100 : 0
                const colorMap: Record<string, string> = {
                  A: 'bg-emerald-500',
                  B: 'bg-green-500',
                  C: 'bg-yellow-500',
                  D: 'bg-orange-500',
                  F: 'bg-red-500',
                }
                return (
                  <div key={grade} className="flex items-center gap-3">
                    <span className="w-6 font-semibold text-gray-900">Grade {grade}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${colorMap[grade]}`}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-900 w-16 text-right">
                      {count} ({Math.round(pct)}%)
                    </span>
                  </div>
                )
              })}
          </div>
          {totalEntities === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No entities scored yet</p>
          )}
        </div>

        {/* Quick Stats */}
        <div className="panel p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Knowledge Base</h3>
          <div className="space-y-4">
            {stats && (
              <>
                {stats.products && (
                  <div className="flex justify-between items-center p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-600">Products</span>
                    <span className="font-semibold text-gray-900">{stats.products.toLocaleString()}</span>
                  </div>
                )}
                {stats.customers && (
                  <div className="flex justify-between items-center p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-600">Customers</span>
                    <span className="font-semibold text-gray-900">{stats.customers.toLocaleString()}</span>
                  </div>
                )}
                {stats.vendors && (
                  <div className="flex justify-between items-center p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-600">Vendors</span>
                    <span className="font-semibold text-gray-900">{stats.vendors.toLocaleString()}</span>
                  </div>
                )}
                {stats.staff && (
                  <div className="flex justify-between items-center p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-600">Staff</span>
                    <span className="font-semibold text-gray-900">{stats.staff.toLocaleString()}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Top Scores Table */}
      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-signal" />
            Top Entity Scores
          </h3>
          <Link href="#" className="text-sm text-brand hover:text-signal font-medium">
            View All →
          </Link>
        </div>

        {topScores.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Name</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Type</th>
                  <th className="text-center py-2 px-3 text-gray-600 font-medium">Grade</th>
                  <th className="text-center py-2 px-3 text-gray-600 font-medium">Confidence</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topScores.map((entity) => (
                  <tr key={entity.entity_id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-gray-900 truncate">{entity.name}</td>
                    <td className="py-2.5 px-3 text-gray-600 text-xs uppercase tracking-wide">
                      {entity.type || 'Entity'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-sm font-semibold ${scoreGrade(
                          entity.score
                        )}`}
                      >
                        {entity.score || '?'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-700">
                      {entity.confidence ? `${Math.round(entity.confidence * 100)}%` : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-xs text-gray-500">{entity.health || 'Unknown'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No entity scores available yet</p>
          </div>
        )}
      </div>

      {/* Sync Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {syncStatus && (
          <>
            <SyncStatusCard title="Products" synced={syncStatus.products.synced} total={syncStatus.products.total} />
            <SyncStatusCard title="Customers" synced={syncStatus.customers.synced} total={syncStatus.customers.total} />
            <SyncStatusCard title="Vendors" synced={syncStatus.vendors.synced} total={syncStatus.vendors.total} />
          </>
        )}
      </div>

      {/* Action Buttons */}
      <div className="panel p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Brain Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-[#0a1a28] transition-colors disabled:bg-gray-300 font-medium flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {syncing ? 'Syncing...' : 'Trigger Full Sync'}
          </button>
          <Link
            href="/ops/brain"
            className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium"
          >
            View Knowledge Gaps
          </Link>
          <Link
            href="/ops/brain"
            className="px-4 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors font-medium"
          >
            Brain Command Center
          </Link>
        </div>
      </div>
    </div>
  )
}

function SyncStatusCard({ title, synced, total }: { title: string; synced: number; total: number }) {
  const pct = total > 0 ? (synced / total) * 100 : 0
  return (
    <div className="panel p-5">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-600">Synced to Aegis</span>
          <span className="font-semibold text-gray-900">
            {synced} / {total}
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5">
          <div
            className="h-2.5 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">{Math.round(pct)}% complete</p>
      </div>
    </div>
  )
}
