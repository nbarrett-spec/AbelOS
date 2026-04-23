'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  RefreshCw, AlertTriangle, Settings,
  CheckCircle2, Clock, Zap, ChevronRight, Database, Activity,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  LiveDataIndicator, Dialog,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { useLiveTopic } from '@/hooks/useLiveTopic'

// ──────────────────────────────────────────────────────────────────────────
// Accounting → Integrations dashboard
// ──────────────────────────────────────────────────────────────────────────
// Dawn's at-a-glance view of every data source she depends on. Polls
// /api/ops/sync-health/v2 every 30 seconds, shows an alert banner when
// sources go stale, and lets her retry/configure/drill into each source.
// ──────────────────────────────────────────────────────────────────────────

interface SyncHealthRow {
  key: string
  label: string
  description: string
  category: string
  provider: string
  status: 'green' | 'amber' | 'red' | 'unknown'
  configured: boolean
  syncEnabled: boolean
  lastSync: {
    at: string
    status: string
    recordsProcessed: number
    ageMs: number
    ageHuman: string
  } | null
  errorMessage: string | null
  staleHours: number
  isStale: boolean
  staleReason: string | null
  configPath: string
  retryPath: string | null
}

interface SyncHealthData {
  asOf: string
  rows: SyncHealthRow[]
  summary: { total: number; green: number; amber: number; red: number; unknown: number; stale: number }
  alertBanner: string | null
}

interface SyncLogEntry {
  id: string
  provider: string
  syncType: string
  direction: string
  status: string
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsFailed: number
  errorMessage: string | null
  startedAt: string
  completedAt: string
  durationMs: number
}

const STATUS_LABEL: Record<SyncHealthRow['status'], string> = {
  green: 'Healthy',
  amber: 'Stale',
  red: 'Error',
  unknown: 'Not set up',
}

function fmtAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`
  return `${Math.floor(ms / 86400000)}d ago`
}

export default function AccountingIntegrationsPage() {
  const router = useRouter()
  const [data, setData] = useState<SyncHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState<number | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [drillRow, setDrillRow] = useState<SyncHealthRow | null>(null)
  const [drillLogs, setDrillLogs] = useState<SyncLogEntry[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveEvent = useLiveTopic(['syncLogs', 'integrations'])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/sync-health/v2')
      if (!res.ok) throw new Error(`status ${res.status}`)
      setData(await res.json())
      setTick(Date.now())
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const id = setInterval(fetchData, 30000)
    return () => clearInterval(id)
  }, [fetchData])
  useEffect(() => { if (liveEvent) fetchData() }, [liveEvent, fetchData])

  async function triggerSync(key: string) {
    setSyncing(key)
    try {
      const res = await fetch('/api/ops/sync-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: key }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Sync error: ${j.error || res.status}`)
      } else {
        setTimeout(fetchData, 1500)
      }
    } finally {
      setSyncing(null)
    }
  }

  async function openDrill(row: SyncHealthRow) {
    setDrillRow(row)
    setDrillLoading(true)
    try {
      const res = await fetch(`/api/ops/sync-health/v2?provider=${encodeURIComponent(row.provider)}`)
      const j = await res.json()
      setDrillLogs(j.logs || [])
    } finally {
      setDrillLoading(false)
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, SyncHealthRow[]> = {}
    for (const r of data?.rows ?? []) {
      if (!g[r.category]) g[r.category] = []
      g[r.category].push(r)
    }
    return g
  }, [data])

  if (loading || !data) {
    return (
      <div className="p-6 space-y-5">
        <PageHeader eyebrow="Accounting → Integrations" title="Sync Health" description="Live status of every data source you depend on." />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Accounting → Integrations"
        title="Sync Health"
        description="Live status of every data source. Polls every 30 seconds."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      {error && (
        <div className="p-3 rounded-md border border-data-negative/40 bg-data-negative/10 text-data-negative text-sm">
          Couldn't load sync health: {error}
        </div>
      )}

      {data.alertBanner && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-accent/40 bg-accent/10">
          <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
          <span className="text-sm font-medium text-fg flex-1">{data.alertBanner}</span>
          <Badge variant="warning" size="xs">{data.summary.stale + data.summary.red} to review</Badge>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard title="Healthy"   value={data.summary.green}   icon={<CheckCircle2 className="w-3.5 h-3.5" />}   accent="positive" />
        <KPICard title="Stale"     value={data.summary.amber}   icon={<Clock className="w-3.5 h-3.5" />}          accent="accent" />
        <KPICard title="Errors"    value={data.summary.red}     icon={<AlertTriangle className="w-3.5 h-3.5" />}  accent="negative" />
        <KPICard title="Not setup" value={data.summary.unknown} icon={<Settings className="w-3.5 h-3.5" />}       accent="neutral" />
        <KPICard title="Total"     value={data.summary.total}   icon={<Database className="w-3.5 h-3.5" />}       accent="brand" />
      </div>

      {Object.entries(grouped).map(([cat, rows]) => (
        <Card key={cat} variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle className="capitalize">{cat}</CardTitle>
              <CardDescription>{rows.length} source{rows.length === 1 ? '' : 's'}</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-2">
            <div className="divide-y divide-border">
              {rows.map(r => (
                <div key={r.key} className="flex items-center gap-3 py-3">
                  <span className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0',
                    r.status === 'green' && 'bg-data-positive',
                    r.status === 'amber' && 'bg-accent',
                    r.status === 'red' && 'bg-data-negative',
                    r.status === 'unknown' && 'bg-fg-subtle',
                  )} aria-label={STATUS_LABEL[r.status]} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-fg text-[13px]">{r.label}</span>
                      <Badge
                        variant={r.status === 'green' ? 'success' : r.status === 'red' ? 'danger' : r.status === 'amber' ? 'warning' : 'neutral'}
                        size="xs"
                      >
                        {STATUS_LABEL[r.status]}
                      </Badge>
                      {!r.syncEnabled && r.configured && (
                        <Badge variant="neutral" size="xs">paused</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-muted truncate">{r.description}</div>
                    {r.errorMessage && (
                      <div className="text-[11px] text-data-negative truncate mt-0.5">
                        <span className="font-medium">Error:</span> {r.errorMessage}
                      </div>
                    )}
                    {r.staleReason && !r.errorMessage && (
                      <div className="text-[11px] text-accent mt-0.5">{r.staleReason}</div>
                    )}
                  </div>

                  <div className="text-right shrink-0 hidden sm:block">
                    {r.lastSync ? (
                      <>
                        <div className="text-[11px] font-semibold text-fg tabular-nums">{fmtRelative(r.lastSync.at)}</div>
                        <div className="text-[10px] text-fg-subtle tabular-nums">{fmtAbsoluteTime(r.lastSync.at)}</div>
                        <div className="text-[10px] text-fg-subtle">{r.lastSync.recordsProcessed.toLocaleString()} rows</div>
                      </>
                    ) : (
                      <span className="text-[11px] text-fg-subtle italic">Never synced</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.retryPath && r.configured && (
                      <button
                        onClick={() => triggerSync(r.key)}
                        disabled={syncing === r.key}
                        className="btn btn-secondary btn-xs"
                        title="Trigger manual sync"
                      >
                        <Zap className={cn('w-3 h-3', syncing === r.key && 'animate-pulse')} />
                        {syncing === r.key ? 'Syncing' : 'Sync'}
                      </button>
                    )}
                    <button
                      onClick={() => router.push(r.configPath)}
                      className="btn btn-ghost btn-xs"
                      title="Configure"
                    >
                      <Settings className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => openDrill(r)}
                      className="btn btn-ghost btn-xs"
                      title="View sync history"
                    >
                      <Activity className="w-3 h-3" />
                      <ChevronRight className="w-3 h-3 -ml-1" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ))}

      <Dialog
        open={!!drillRow}
        onClose={() => { setDrillRow(null); setDrillLogs([]) }}
        title={drillRow ? `${drillRow.label} — Last 20 syncs` : undefined}
        description={drillRow ? drillRow.description : undefined}
        size="xl"
      >
        {drillLoading ? (
          <div className="py-10 text-center text-fg-muted text-sm">Loading sync history…</div>
        ) : drillLogs.length === 0 ? (
          <EmptyState icon="package" size="compact" title="No sync history" description="This integration has not run yet." />
        ) : (
          <DataTable
            data={drillLogs}
            rowKey={(r) => r.id}
            density="compact"
            columns={[
              { key: 'completedAt', header: 'When', sortable: true, width: '160px',
                cell: (r) => (
                  <div>
                    <div className="text-[11px] text-fg">{fmtAbsoluteTime(r.completedAt)}</div>
                    <div className="text-[10px] text-fg-subtle">{fmtRelative(r.completedAt)}</div>
                  </div>
                ) },
              { key: 'syncType', header: 'Type',
                cell: (r) => <span className="font-mono text-[11px]">{r.syncType}</span> },
              { key: 'status', header: 'Status', width: '110px',
                cell: (r) => <StatusBadge status={r.status} size="sm" /> },
              { key: 'recordsProcessed', header: 'Processed', numeric: true, width: '80px',
                cell: (r) => <span className="tabular-nums text-[11px]">{r.recordsProcessed?.toLocaleString() ?? 0}</span> },
              { key: 'recordsCreated', header: 'New', numeric: true, width: '60px',
                cell: (r) => <span className="tabular-nums text-[11px] text-data-positive">{r.recordsCreated ?? 0}</span> },
              { key: 'recordsUpdated', header: 'Updated', numeric: true, width: '70px',
                cell: (r) => <span className="tabular-nums text-[11px]">{r.recordsUpdated ?? 0}</span> },
              { key: 'recordsFailed', header: 'Failed', numeric: true, width: '60px',
                cell: (r) => <span className={cn('tabular-nums text-[11px]', r.recordsFailed > 0 && 'text-data-negative font-semibold')}>{r.recordsFailed ?? 0}</span> },
              { key: 'durationMs', header: 'Duration', numeric: true, width: '80px',
                cell: (r) => <span className="tabular-nums text-[11px] text-fg-muted">{((r.durationMs ?? 0) / 1000).toFixed(1)}s</span> },
              { key: 'errorMessage', header: 'Error',
                cell: (r) => <span className="text-[11px] text-data-negative truncate max-w-[300px] block">{r.errorMessage || '—'}</span> },
            ]}
          />
        )}
      </Dialog>
    </div>
  )
}
