'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Sun, Users, MapPin, Clock, AlertTriangle, CheckSquare } from 'lucide-react'
import KPICard from '@/components/ui/KPICard'
import Skeleton from '@/components/ui/Skeleton'
import EmptyState from '@/components/ui/EmptyState'

interface Briefing {
  date: string
  installCount: number
  communities: Array<{ name: string; count: number }>
  firstStop: {
    jobNumber: string
    builderName: string
    community: string | null
    lotBlock: string | null
    jobAddress: string | null
    scheduledDate: string | null
  } | null
  ranLongYesterday: Array<{ id: string; jobNumber: string; builderName: string; community: string | null }>
  openPunchCount: number
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function friendlyDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function buildNarrative(b: Briefing): string {
  const parts: string[] = []
  parts.push(`${b.installCount} install${b.installCount === 1 ? '' : 's'} today`)
  if (b.communities.length > 0) {
    const top = b.communities.slice(0, 3).map((c) => `${c.count} at ${c.name}`).join(', ')
    parts.push(top)
  }
  if (b.firstStop) {
    const time = b.firstStop.scheduledDate ? formatTime(b.firstStop.scheduledDate) : 'TBD'
    parts.push(`First stop ${time} at ${b.firstStop.jobAddress || b.firstStop.jobNumber}`)
  }
  if (b.ranLongYesterday.length > 0) {
    parts.push(`${b.ranLongYesterday.length} job${b.ranLongYesterday.length === 1 ? '' : 's'} ran long yesterday`)
  }
  return parts.join('. ') + '.'
}

export default function InstallerBriefingPage() {
  const [data, setData] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/ops/portal/installer/briefing')
        if (!res.ok) throw new Error()
        const json = await res.json()
        setData(json)
      } catch {
        setError('Could not load briefing.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center gap-2">
        <Link href="/ops/portal/installer">
          <button className="w-12 h-12 flex items-center justify-center rounded-md hover:bg-surface-muted transition-colors" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-fg" />
          </button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-fg flex items-center gap-2">
            <Sun className="w-6 h-6 text-accent-fg" />
            {greeting}
          </h1>
          {data && <p className="text-[12px] text-fg-muted mt-0.5">{friendlyDate(data.date)}</p>}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error || !data ? (
        <EmptyState title="Briefing unavailable" description={error || 'No briefing available.'} />
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Your briefing</p>
            <p className="text-[14px] text-fg mt-2 leading-relaxed">{buildNarrative(data)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <KPICard
              title="Installs Today"
              value={data.installCount}
              accent="brand"
            />
            <KPICard
              title="Open Punch Items"
              value={data.openPunchCount}
              accent={data.openPunchCount > 0 ? 'accent' : 'positive'}
              subtitle="Across all jobs"
            />
          </div>

          {data.firstStop && (
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-fg-muted" />
                  <h2 className="text-[13px] font-semibold text-fg">First stop</h2>
                </div>
                <span className="text-[11px] font-mono text-fg-muted flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {formatTime(data.firstStop.scheduledDate)}
                </span>
              </div>
              <div className="px-4 py-3">
                <p className="text-[13px] font-mono font-semibold text-fg">{data.firstStop.jobNumber}</p>
                <p className="text-[13px] text-fg">{data.firstStop.builderName}</p>
                {data.firstStop.jobAddress && (
                  <p className="text-[12px] text-fg-muted mt-1">{data.firstStop.jobAddress}</p>
                )}
                {data.firstStop.community && (
                  <p className="text-[11px] text-fg-subtle mt-1">
                    {data.firstStop.community} {data.firstStop.lotBlock ? `· ${data.firstStop.lotBlock}` : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {data.communities.length > 0 && (
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Users className="w-4 h-4 text-fg-muted" />
                <h2 className="text-[13px] font-semibold text-fg">By community</h2>
              </div>
              <ul className="divide-y divide-border">
                {data.communities.map((c) => (
                  <li key={c.name} className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-[13px] text-fg">{c.name}</span>
                    <span className="text-[12px] font-mono font-semibold text-fg">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.ranLongYesterday.length > 0 && (
            <div className="rounded-xl border border-border bg-data-warning-bg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-data-warning-fg" />
                <h2 className="text-[13px] font-semibold text-data-warning-fg">Ran long yesterday</h2>
              </div>
              <ul className="divide-y divide-border">
                {data.ranLongYesterday.map((j) => (
                  <li key={j.id} className="px-4 py-2.5">
                    <p className="text-[13px] font-mono font-semibold text-fg">{j.jobNumber}</p>
                    <p className="text-[12px] text-fg-muted">{j.builderName} {j.community ? `· ${j.community}` : ''}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link href="/ops/portal/installer">
            <div className="rounded-xl border border-border bg-accent-subtle hover:bg-accent hover:text-fg-on-accent px-5 py-4 text-center text-[14px] font-semibold text-accent-fg transition-colors flex items-center justify-center gap-2">
              <CheckSquare className="w-4 h-4" />
              Start the day
            </div>
          </Link>
        </>
      )}
    </div>
  )
}
