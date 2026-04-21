'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PageHeader,
  KPICard,
  Card,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Modal,
} from '@/components/ui'
import Link from 'next/link'

interface CommandRow {
  projectId: string
  name: string
  planName: string | null
  lotNumber: string | null
  subdivision: string | null
  builderId: string
  builderName: string
  status: string
  pmId: string | null
  pmName: string | null
  jobCount: number
  overdueJobs: number
  nextMilestone: string | null
  daysToNext: number | null
  alerts: string[]
  orderTotal: number | null
}

interface CommandResponse {
  total: number
  groups: Array<{
    pmId: string | null
    pmName: string
    projects: CommandRow[]
  }>
  summary: {
    totalProjects: number
    withAlerts: number
    overdueTotal: number
    unassigned: number
  }
}

interface StandupResponse {
  pm: { id: string; name: string; email: string }
  counts: { completedYesterday: number; committedToday: number; blocked: number }
  markdown: string
}

export default function ProjectsCommandCenter() {
  const [data, setData] = useState<CommandResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [standup, setStandup] = useState<StandupResponse | null>(null)
  const [standupOpen, setStandupOpen] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/projects/command-center')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function openStandup(pmId: string) {
    setStandupOpen(true)
    setStandup(null)
    try {
      const res = await fetch(`/api/ops/projects/standup/${pmId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStandup(await res.json())
    } catch {
      setStandup(null)
    }
  }

  const filteredGroups = data?.groups.map((g) => ({
    ...g,
    projects: g.projects.filter((p) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (p.planName || '').toLowerCase().includes(q) ||
        p.builderName.toLowerCase().includes(q) ||
        (p.subdivision || '').toLowerCase().includes(q)
      )
    }),
  })).filter((g) => g.projects.length > 0)

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Project Management"
          title="PM Command Center"
          description="Every active project grouped by the PM who owns it. Alerts, milestones, and a one-click standup."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Projects' }]}
          actions={
            <Button variant="ghost" size="sm" loading={loading} onClick={load}>
              Refresh
            </Button>
          }
        />

        {error && (
          <Card padding="xs" className="border-data-negative/40 bg-data-negative-bg text-data-negative-fg">
            {error}
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Active Projects" value={data?.summary.totalProjects ?? '—'} accent="brand" />
          <KPICard
            title="With Alerts"
            value={data?.summary.withAlerts ?? '—'}
            accent={data?.summary.withAlerts ? 'negative' : 'positive'}
          />
          <KPICard
            title="Overdue Jobs"
            value={data?.summary.overdueTotal ?? '—'}
            accent={data && data.summary.overdueTotal > 0 ? 'negative' : 'positive'}
          />
          <KPICard
            title="Unassigned"
            value={data?.summary.unassigned ?? '—'}
            accent={data && data.summary.unassigned > 0 ? 'accent' : 'neutral'}
          />
        </div>

        <div className="flex items-center justify-between">
          <input
            className="input w-72 text-sm"
            placeholder="Filter project, builder, plan…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-fg-muted">
            {filteredGroups?.length ?? 0} PM{(filteredGroups?.length ?? 0) === 1 ? '' : 's'} with work
          </div>
        </div>

        <div className="space-y-5">
          {!filteredGroups?.length && !loading && (
            <EmptyState title="No active projects" description="Projects will appear here once takeoffs or quotes advance." />
          )}
          {filteredGroups?.map((group) => (
            <Card key={group.pmId ?? 'unassigned'} padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-muted/40">
                <div>
                  <div className="text-sm font-semibold text-fg">
                    {group.pmName}
                    <span className="ml-2 text-xs text-fg-muted font-normal">
                      ({group.projects.length} project{group.projects.length === 1 ? '' : 's'})
                    </span>
                  </div>
                </div>
                {group.pmId && (
                  <Button variant="outline" size="sm" onClick={() => openStandup(group.pmId!)}>
                    Generate standup
                  </Button>
                )}
              </div>
              <DataTable
                data={group.projects}
                rowKey={(r) => r.projectId}
                empty="No projects."
                columns={[
                  {
                    key: 'name',
                    header: 'Project',
                    cell: (r) => (
                      <Link href={`/ops/projects/${r.projectId}`} className="hover:underline">
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="text-[11px] text-fg-subtle">
                          {[r.subdivision, r.planName, r.lotNumber].filter(Boolean).join(' · ')}
                        </div>
                      </Link>
                    ),
                  },
                  { key: 'builder', header: 'Builder', cell: (r) => r.builderName },
                  {
                    key: 'status',
                    header: 'Stage',
                    cell: (r) => (
                      <Badge variant="neutral" size="sm">
                        {r.status.replace('_', ' ')}
                      </Badge>
                    ),
                  },
                  {
                    key: 'next',
                    header: 'Next milestone',
                    cell: (r) =>
                      r.nextMilestone ? (
                        <>
                          <div className="text-xs">
                            {new Date(r.nextMilestone).toLocaleDateString('en-US')}
                          </div>
                          <div
                            className={`text-[11px] ${
                              (r.daysToNext ?? 0) < 3
                                ? 'text-data-warning'
                                : 'text-fg-subtle'
                            }`}
                          >
                            {r.daysToNext != null ? `in ${r.daysToNext}d` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="text-fg-subtle text-xs">—</span>
                      ),
                  },
                  {
                    key: 'alerts',
                    header: 'Alerts',
                    cell: (r) =>
                      r.alerts.length === 0 ? (
                        <span className="text-fg-subtle text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.alerts.map((a, i) => (
                            <Badge key={i} variant="danger" size="xs">
                              {a}
                            </Badge>
                          ))}
                        </div>
                      ),
                  },
                  {
                    key: 'total',
                    header: 'Order $',
                    numeric: true,
                    cell: (r) =>
                      r.orderTotal != null
                        ? `$${Math.round(r.orderTotal).toLocaleString()}`
                        : '—',
                  },
                ]}
              />
            </Card>
          ))}
        </div>
      </div>

      {standupOpen && (
        <Modal
          open={standupOpen}
          onClose={() => setStandupOpen(false)}
          title={standup ? `Standup — ${standup.pm.name}` : 'Generating standup…'}
          size="lg"
        >
          {!standup ? (
            <div className="p-6 text-sm text-fg-muted">Pulling jobs…</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <KPICard title="Completed Yday" value={standup.counts.completedYesterday} accent="positive" />
                <KPICard title="Committing Today" value={standup.counts.committedToday} accent="brand" />
                <KPICard title="Blocked" value={standup.counts.blocked} accent={standup.counts.blocked > 0 ? 'negative' : 'positive'} />
              </div>
              <pre className="panel p-4 text-xs whitespace-pre-wrap font-mono max-h-[60vh] overflow-y-auto">
                {standup.markdown}
              </pre>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(standup.markdown)}
                >
                  Copy markdown
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStandupOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
