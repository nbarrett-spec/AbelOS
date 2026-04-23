'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calendar, MapPin, Clock } from 'lucide-react'
import { StatusBadge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'

interface ScheduleJob {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  scheduledDate: string | null
  status: string
  scopeType: string
}

interface ScheduleResponse {
  startDate: string
  days: Array<{ date: string; jobs: ScheduleJob[] }>
}

function friendlyDate(iso: string, isToday: boolean, isTomorrow: boolean): string {
  if (isToday) return 'Today'
  if (isTomorrow) return 'Tomorrow'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function InstallerSchedulePage() {
  const [data, setData] = useState<ScheduleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/ops/portal/installer/schedule')
        if (!res.ok) throw new Error()
        const json = await res.json()
        setData(json)
      } catch {
        setError('Could not load schedule.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

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
            <Calendar className="w-6 h-6 text-accent-fg" />
            7-Day Schedule
          </h1>
          <p className="text-[12px] text-fg-muted mt-0.5">Your install assignments through the week.</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <EmptyState title="Schedule unavailable" description={error} />
      ) : !data || data.days.length === 0 ? (
        <EmptyState title="Nothing scheduled" description="No installs scheduled in the next 7 days." />
      ) : (
        <div className="space-y-5">
          {data.days.map(({ date, jobs }) => (
            <div key={date}>
              <div className="sticky top-0 bg-canvas/90 backdrop-blur-md py-2 border-b border-border z-10">
                <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-fg-subtle">
                  {friendlyDate(date, date === todayStr, date === tomorrowStr)}
                </p>
                <p className="text-[10px] text-fg-subtle font-mono mt-0.5">
                  {new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {jobs.length} install{jobs.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="space-y-2 mt-2">
                {jobs.map((j) => (
                  <Link
                    key={j.id}
                    href={`/ops/portal/installer/${j.id}`}
                    className="block rounded-xl border border-border bg-surface p-4 hover:border-border-strong transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-mono font-semibold text-fg">{j.jobNumber}</span>
                          <StatusBadge status={j.status} size="xs" />
                        </div>
                        <p className="text-[13px] text-fg mt-1">{j.builderName}</p>
                        {j.community && (
                          <p className="text-[12px] text-fg-muted mt-0.5">{j.community} {j.lotBlock ? `· ${j.lotBlock}` : ''}</p>
                        )}
                        {j.jobAddress && (
                          <p className="text-[12px] text-fg-subtle mt-1 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {j.jobAddress}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[12px] font-mono text-fg-muted flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatTime(j.scheduledDate)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
