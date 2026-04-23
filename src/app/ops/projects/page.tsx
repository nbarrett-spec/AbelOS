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
  jobId: string
  name: string
  planName: string | null
  lotNumber: string | null
  subdivision: string | null
  builderId: string
  builderName: string
  status: string
  pmId: string | null
  pmName: string | null
  pmActive: boolean | null
  jobCount: number
  overdueJobs: number
  nextMilestone: string | null
  daysToNext: number | null
  alerts: string[]
  orderTotal: number | null
  materialShortQty: number | null
}

interface RosterEntry {
  id: string
  name: string
  role: string
  active: boolean
  jobCount: number
}

interface CommandResponse {
  asOf: string
  scope: 'all' | 'pm'
  pmFilterId: string | null
  isPrivileged: boolean
  viewerStaffId: string | null
  total: number
  groups: Array<{
    pmId: string | null
    pmName: string
    pmActive: boolean | null
    projects: CommandRow[]
  }>
  pmRoster: RosterEntry[] | null
  summary: {
    totalProjects: number
    withAlerts: number
    overdueTotal: number
    unassigned: number
    shortMaterial: number
    exStaffPM: number
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
  // Selected PM: 'all' | '<staffId>' | 'self'. 'self' is the default for PMs;
  // privileged users default to 'all'. We resolve the actual param on load.
  const [pmSelection, setPmSelection] = useState<string>('')

  const load = useCallback(
    async (selection: string = pmSelection) => {
      setLoading(true)
      setError(null)
      try {
        const qs: string[] = []
        if (selection === 'all') qs.push('all=1')
        else if (selection && selection !== 'self') qs.push(`pmId=${encodeURIComponent(selection)}`)
        const url = `/api/ops/projects/command-center${qs.length ? '?' + qs.join('&') : ''}`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: CommandResponse = await res.json()
        setData(json)
        // First response seeds the selector if the caller didn't pre-pick one
        if (!pmSelection) {
          if (json.isPrivileged) setPmSelection('all')
          else setPmSelection('self')
        }
      } catch (e: any) {
        setError(e?.message)
      } finally {
        setLoading(false)
      }
    },
    [pmSelection],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const filteredGroups = data?.groups
    .map((g) => ({
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
    }))
    .filter((g) => g.projects.length > 0)

  const showPicker = !!data && (data.isPrivileged || !!data.pmRoster)

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Project Management"
          title="PM Command Center"
          description={
            data?.isPrivileged
              ? 'Every active job grouped by the PM who owns it. Alerts, milestones, and a one-click standup.'
              : "Your active jobs. Switch to another PM's view via the picker above."
          }
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Projects' }]}
          actions={
            <div className="flex items-center gap-2">
              {showPicker && data?.pmRoster && (
                <select
                  className="input text-sm h-8 min-w-[200px]"
                  value={pmSelection}
                  onChange={(e) => {
                    setPmSelection(e.target.value)
                    load(e.target.value)
                  }}
                >
                  {data.isPrivileged ? (
                    <option value="all">All PMs ({data.summary.totalProjects})</option>
                  ) : (
                    <option value="self">My jobs only</option>
                  )}
                  {!data.isPrivileged && <option value="all">All PMs</option>}
                  <optgroup label="Active PMs">
                    {data.pmRoster
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.jobCount})
                        </option>
                      ))}
                  </optgroup>
                  {data.pmRoster.some((p) => !p.active) && (
                    <optgroup label="Ex-staff (jobs need reassignment)">
                      {data.pmRoster
                        .filter((p) => !p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.jobCount})
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              )}
              <Button variant="ghost" size="sm" loading={loading} onClick={() => load()}>
                Refresh
              </Button>
            </div>
          }
        />

        {error && (
          <Card
            padding="xs"
            className="border-data-negative/40 bg-data-negative-bg text-data-negative-fg"
          >
            {error}
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPICard title="Active Jobs" value={data?.summary.totalProjects ?? '—'} accent="brand" />
          <KPICard
            title="With Alerts"
            value={data?.summary.withAlerts ?? '—'}
            accent={data?.summary.withAlerts ? 'negative' : 'positive'}
          />
          <KPICard
            title="Overdue"
            value={data?.summary.overdueTotal ?? '—'}
            accent={data && data.summary.overdueTotal > 0 ? 'negative' : 'positive'}
          />
          <KPICard
            title="Material Short"
            value={data?.summary.shortMaterial ?? '—'}
            accent={data && data.summary.shortMaterial > 0 ? 'negative' : 'positive'}
          />
          <KPICard
            title="Ex-Staff PM"
            value={data?.summary.exStaffPM ?? '—'}
            accent={data && data.summary.exStaffPM > 0 ? 'accent' : 'neutral'}
          />
        </div>

        <div className="flex items-center justify-between">
          <input
            className="input w-72 text-sm"
            placeholder="Filter job, builder, community…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-fg-muted">
            {filteredGroups?.length ?? 0} PM
            {(filteredGroups?.length ?? 0) === 1 ? '' : 's'} with work
          </div>
        </div>

        <div className="space-y-5">
          {!filteredGroups?.length && !loading && (
            <EmptyState
              title="No active jobs"
              description="No jobs in the active pipeline for this view. Try switching the PM filter or check back after new orders are booked."
            />
          )}
          {filteredGroups?.map((group) => (
            <Card key={group.pmId ?? 'unassigned'} padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-muted/40">
                <div>
                  <div className="text-sm font-semibold text-fg flex items-center gap-2">
                    {group.pmName}
                    {group.pmActive === false && (
                      <Badge variant="danger" size="xs">
                        ex-staff
                      </Badge>
                    )}
                    <span className="ml-1 text-xs text-fg-muted font-normal">
                      ({group.projects.length} job{group.projects.length === 1 ? '' : 's'})
                    </span>
                  </div>
                  {group.pmActive === false && (
                    <div className="text-[11px] text-data-negative mt-0.5">
                      These jobs need reassignment — PM no longer on staff.
                    </div>
                  )}
                </div>
                {group.pmId && group.pmActive !== false && (
                  <Button variant="outline" size="sm" onClick={() => openStandup(group.pmId!)}>
                    Generate standup
                  </Button>
                )}
              </div>
              <DataTable
                data={group.projects}
                rowKey={(r) => r.jobId}
                empty="No jobs."
                columns={[
                  {
                    key: 'name',
                    header: 'Job',
                    cell: (r) => (
                      <Link href={`/ops/jobs/${r.jobId}`} className="hover:underline">
                        <div className="text-sm font-medium font-mono">{r.name}</div>
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
                        {r.status.replace(/_/g, ' ')}
                      </Badge>
                    ),
                  },
                  {
                    key: 'next',
                    header: 'Next milestone',
                    cell: (r) =>
                      r.nextMilestone ? (
                        <>
                          <div className="text-xs font-mono tabular-nums">
                            {new Date(r.nextMilestone).toLocaleDateString('en-US')}
                          </div>
                          <div
                            className={`text-[11px] font-mono tabular-nums ${
                              r.daysToNext != null && r.daysToNext < 0
                                ? 'text-data-negative'
                                : r.daysToNext != null && r.daysToNext < 3
                                ? 'text-data-warning'
                                : 'text-fg-subtle'
                            }`}
                          >
                            {r.daysToNext != null
                              ? r.daysToNext < 0
                                ? `${Math.abs(r.daysToNext)}d overdue`
                                : `in ${r.daysToNext}d`
                              : ''}
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
                      r.orderTotal != null ? (
                        <span className="font-mono tabular-nums">
                          ${Math.round(r.orderTotal).toLocaleString()}
                        </span>
                      ) : (
                        '—'
                      ),
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
                <KPICard
                  title="Completed Yday"
                  value={standup.counts.completedYesterday}
                  accent="positive"
                />
                <KPICard
                  title="Committing Today"
                  value={standup.counts.committedToday}
                  accent="brand"
                />
                <KPICard
                  title="Blocked"
                  value={standup.counts.blocked}
                  accent={standup.counts.blocked > 0 ? 'negative' : 'positive'}
                />
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
