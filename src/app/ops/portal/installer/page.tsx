'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  HardHat, MapPin, Clock, Play, AlertTriangle, Navigation, Users, Calendar,
  Sun, Cloud, ChevronRight, Home, Route as RouteIcon, CheckCircle2,
} from 'lucide-react'
import KPICard from '@/components/ui/KPICard'
import Button from '@/components/ui/Button'
import Badge, { StatusBadge } from '@/components/ui/Badge'
import Sheet from '@/components/ui/Sheet'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import { useToast } from '@/contexts/ToastContext'

// ── Types ────────────────────────────────────────────────────────────────

interface InstallerJob {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  latitude: number | null
  longitude: number | null
  status: string
  scopeType: string
  scheduledDate: string | null
  actualDate: string | null
  orderNumber: string | null
  deliveryNotes: string | null
  pm: { id: string; firstName: string; lastName: string } | null
  highPriorityNotes: { body: string; priority: string; noteType: string }[]
  distanceFromPrevMi: number | null
}

interface TodayResponse {
  date: string
  kpis: { total: number; completed: number; inProgress: number; remaining: number }
  jobs: InstallerJob[]
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Nothing to map — we pass the raw status to StatusBadge which has its own map.

function formatTimeWindow(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function friendlyDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function InstallerTodayPage() {
  const { addToast } = useToast()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheetJob, setSheetJob] = useState<InstallerJob | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/ops/portal/installer/today')
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError('Could not load today queue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const grouped = useMemo(() => {
    if (!data?.jobs) return [] as Array<{ community: string; jobs: InstallerJob[] }>
    const map = new Map<string, InstallerJob[]>()
    for (const j of data.jobs) {
      const k = j.community || 'Unassigned'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(j)
    }
    return Array.from(map.entries()).map(([community, jobs]) => ({ community, jobs }))
  }, [data])

  const startInstall = async (jobId: string) => {
    setStarting(jobId)
    try {
      const res = await fetch(`/api/ops/portal/installer/jobs/${jobId}/start`, { method: 'POST' })
      if (!res.ok) throw new Error('fail')
      addToast({ type: 'success', title: 'Install started', message: 'Status set to INSTALLING.' })
      await loadData()
      setSheetJob(null)
    } catch {
      addToast({ type: 'error', title: 'Could not start install', message: 'Please try again.' })
    } finally {
      setStarting(null)
    }
  }

  const dateFriendly = data?.date ? friendlyDate(data.date) : '—'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle">Installer</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-fg flex items-center gap-2 mt-1">
            <HardHat className="w-7 h-7 text-accent-fg" />
            {greeting}
          </h1>
          <p className="text-[13px] text-fg-muted mt-1">{dateFriendly}</p>
        </div>

        {/* Weather placeholder strip */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
          <Sun className="w-4 h-4 text-accent-fg" />
          <div className="text-[12px] text-fg-muted">
            <span className="font-mono font-semibold text-fg">72°F</span> · Clear · DFW
          </div>
          <Cloud className="w-4 h-4 text-fg-subtle ml-1" />
        </div>
      </div>

      {/* Quick action bar */}
      <div className="grid grid-cols-3 gap-2">
        <Link href="/ops/portal/installer/briefing" className="col-span-1">
          <Button variant="ghost" size="md" fullWidth className="!min-h-[48px]" icon={<Sun className="w-4 h-4" />}>
            <span className="hidden sm:inline">Morning</span> Briefing
          </Button>
        </Link>
        <Link href="/ops/portal/installer/schedule" className="col-span-1">
          <Button variant="ghost" size="md" fullWidth className="!min-h-[48px]" icon={<Calendar className="w-4 h-4" />}>
            7-Day <span className="hidden sm:inline">Schedule</span>
          </Button>
        </Link>
        <Button variant="ghost" size="md" fullWidth className="!min-h-[48px]" icon={<RouteIcon className="w-4 h-4" />} onClick={loadData}>
          Refresh
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard
          title="Today's Jobs"
          value={data?.kpis.total ?? (loading ? '—' : 0)}
          accent="brand"
          icon={<Home className="w-4 h-4" />}
          loading={loading}
        />
        <KPICard
          title="Completed"
          value={data?.kpis.completed ?? (loading ? '—' : 0)}
          accent="positive"
          icon={<CheckCircle2 className="w-4 h-4" />}
          loading={loading}
        />
        <KPICard
          title="Remaining"
          value={data?.kpis.remaining ?? (loading ? '—' : 0)}
          accent="accent"
          icon={<Clock className="w-4 h-4" />}
          loading={loading}
        />
        <KPICard
          title="Avg Time / Install"
          value={'—'}
          subtitle="No data yet"
          accent="neutral"
          loading={loading}
        />
      </div>

      {/* Job list */}
      {error ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-data-negative mx-auto mb-2" />
          <p className="text-[13px] text-fg-muted">{error}</p>
          <Button onClick={loadData} size="md" className="mt-3 !min-h-[48px]">Retry</Button>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !data || data.jobs.length === 0 ? (
        <EmptyState
          title="No installs scheduled"
          description="Nothing on the board for today. Check the 7-day schedule or your briefing."
        />
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.community} className="space-y-2">
              <div className="flex items-center justify-between pl-1">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-fg-subtle" />
                  <span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-fg-subtle">
                    {group.community}
                  </span>
                </div>
                <span className="text-[11px] text-fg-subtle font-mono">{group.jobs.length}</span>
              </div>
              <div className="space-y-2">
                {group.jobs.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    onOpen={() => setSheetJob(j)}
                    onStart={() => startInstall(j.id)}
                    starting={starting === j.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail sheet */}
      {sheetJob && (
        <Sheet
          open={!!sheetJob}
          onClose={() => setSheetJob(null)}
          title={sheetJob.jobNumber}
          subtitle={[sheetJob.builderName, sheetJob.community, sheetJob.lotBlock].filter(Boolean).join(' · ')}
          tabs={['details']}
          footer={
            <div className="flex gap-2">
              <Link href={`/ops/portal/installer/${sheetJob.id}`} className="flex-1">
                <Button variant="ghost" size="lg" fullWidth className="!min-h-[48px]">
                  Open Full Detail
                </Button>
              </Link>
              {sheetJob.status !== 'INSTALLING' && sheetJob.status !== 'COMPLETE' && (
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Play className="w-4 h-4" />}
                  onClick={() => startInstall(sheetJob.id)}
                  loading={starting === sheetJob.id}
                  className="flex-1 !min-h-[48px]"
                >
                  Start Install
                </Button>
              )}
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={sheetJob.status} />
              <span className="text-[12px] text-fg-muted font-mono">
                <Clock className="w-3.5 h-3.5 inline mr-1" />
                {formatTimeWindow(sheetJob.scheduledDate)}
              </span>
            </div>
            {sheetJob.jobAddress && (
              <div className="rounded-lg border border-border bg-surface-muted p-3">
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-fg-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-medium text-fg">{sheetJob.jobAddress}</p>
                    {sheetJob.community && (
                      <p className="text-[12px] text-fg-muted mt-0.5">{sheetJob.community}</p>
                    )}
                    {sheetJob.latitude && sheetJob.longitude && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${sheetJob.latitude},${sheetJob.longitude}`}
                        target="_blank"
                        rel="noopener"
                        className="text-[12px] text-accent-fg font-medium mt-2 inline-flex items-center gap-1"
                      >
                        <Navigation className="w-3 h-3" /> Navigate
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
            {sheetJob.deliveryNotes && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-fg-subtle mb-1">
                  Delivery notes
                </p>
                <p className="text-[13px] text-fg whitespace-pre-wrap">{sheetJob.deliveryNotes}</p>
              </div>
            )}
            {sheetJob.highPriorityNotes.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-data-negative-fg mb-1">
                  High-priority notes
                </p>
                <ul className="space-y-1.5">
                  {sheetJob.highPriorityNotes.map((n, i) => (
                    <li key={i} className="text-[13px] text-fg rounded-md bg-data-negative-bg px-2 py-1.5">
                      {n.body}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sheetJob.pm && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-fg-subtle mb-1">
                  Project manager
                </p>
                <p className="text-[13px] text-fg">{sheetJob.pm.firstName} {sheetJob.pm.lastName}</p>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ── Job Card ────────────────────────────────────────────────────────────

function JobCard({
  job,
  onOpen,
  onStart,
  starting,
}: {
  job: InstallerJob
  onOpen: () => void
  onStart: () => void
  starting: boolean
}) {
  const canStart = job.status !== 'INSTALLING' && job.status !== 'COMPLETE'
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <button
        onClick={onOpen}
        className="w-full text-left p-4 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-fg font-mono">{job.jobNumber}</span>
              <StatusBadge status={job.status} size="xs" />
            </div>
            <p className="text-[13px] text-fg mt-1 truncate">{job.builderName}</p>
            {job.jobAddress && (
              <p className="text-[12px] text-fg-muted mt-0.5 flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{job.jobAddress}</span>
              </p>
            )}
            {job.lotBlock && (
              <p className="text-[11px] text-fg-subtle mt-0.5 font-mono">{job.lotBlock}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[12px] font-mono text-fg-muted">
              {formatTimeWindow(job.scheduledDate)}
            </p>
            {job.distanceFromPrevMi !== null && (
              <p className="text-[10px] text-fg-subtle mt-1 font-mono">
                +{job.distanceFromPrevMi} mi
              </p>
            )}
          </div>
        </div>
        {job.highPriorityNotes.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-data-negative" />
            <span className="text-[11px] text-data-negative-fg font-medium">
              {job.highPriorityNotes.length} high-priority note{job.highPriorityNotes.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </button>
      <div className="flex border-t border-border">
        <Link
          href={`/ops/portal/installer/${job.id}`}
          className="flex-1 flex items-center justify-center gap-2 h-12 text-[13px] font-medium text-fg-muted hover:text-fg hover:bg-surface-muted border-r border-border transition-colors"
        >
          Details <ChevronRight className="w-4 h-4" />
        </Link>
        {canStart ? (
          <button
            onClick={onStart}
            disabled={starting}
            className="flex-1 flex items-center justify-center gap-2 h-12 text-[13px] font-semibold text-accent-fg hover:bg-accent-subtle transition-colors disabled:opacity-50"
          >
            {starting ? 'Starting…' : (<><Play className="w-4 h-4" /> Start install</>)}
          </button>
        ) : (
          <Link
            href={`/ops/portal/installer/${job.id}`}
            className="flex-1 flex items-center justify-center gap-2 h-12 text-[13px] font-semibold text-fg hover:bg-surface-muted transition-colors"
          >
            {job.status === 'INSTALLING' ? 'Continue' : 'View'}
          </Link>
        )}
      </div>
    </div>
  )
}
