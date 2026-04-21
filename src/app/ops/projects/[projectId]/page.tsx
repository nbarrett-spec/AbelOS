'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PageHeader, Card, Badge, Button, KPICard } from '@/components/ui'
import PresenceAvatars from '@/components/ui/PresenceAvatars'

interface Milestone {
  kind: 'QUOTE' | 'ORDER' | 'JOB' | 'DELIVERY'
  id: string
  label: string
  start: string
  end: string | null
  status: string
  critical: boolean
  meta?: any
}

interface TimelineResponse {
  project: {
    id: string
    name: string
    status: string
    planName: string | null
    lotNumber: string | null
    subdivision: string | null
    builderName: string
  }
  axis: {
    start: string
    end: string
    spanDays: number
  }
  milestones: Milestone[]
}

const KIND_STYLE: Record<Milestone['kind'], string> = {
  QUOTE: 'bg-forecast text-forecast-fg border-forecast',
  ORDER: 'bg-brand text-fg-on-accent border-brand',
  JOB: 'bg-accent text-fg-on-accent border-accent',
  DELIVERY: 'bg-data-positive text-white border-data-positive',
}

export default function ProjectTimelinePage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params?.projectId as string
  const [data, setData] = useState<TimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Milestone | null>(null)

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    fetch(`/api/ops/projects/${projectId}/timeline`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-canvas text-fg p-6">
        <div className="max-w-[1600px] mx-auto">Loading timeline…</div>
      </div>
    )
  }

  const axisStart = new Date(data.axis.start).getTime()
  const axisEnd = new Date(data.axis.end).getTime()
  const span = Math.max(axisEnd - axisStart, 24 * 60 * 60 * 1000)

  function barGeometry(m: Milestone) {
    const s = new Date(m.start).getTime()
    const e = m.end ? new Date(m.end).getTime() : s + 12 * 60 * 60 * 1000 // 12h dot
    const left = ((s - axisStart) / span) * 100
    const width = Math.max(0.6, ((e - s) / span) * 100)
    return { left, width }
  }

  // Group milestones by kind for rows
  const kinds: Milestone['kind'][] = ['QUOTE', 'ORDER', 'JOB', 'DELIVERY']

  // Axis ticks
  const tickCount = 8
  const ticks: { label: string; left: number }[] = []
  for (let i = 0; i <= tickCount; i++) {
    const t = axisStart + (span * i) / tickCount
    ticks.push({
      label: new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      left: (i / tickCount) * 100,
    })
  }

  // Now line
  const now = Date.now()
  const nowPct = now >= axisStart && now <= axisEnd ? ((now - axisStart) / span) * 100 : null

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1600px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Project"
          title={data.project.name}
          description={[data.project.subdivision, data.project.planName, data.project.lotNumber]
            .filter(Boolean)
            .join(' · ')}
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Projects', href: '/ops/projects' },
            { label: data.project.name },
          ]}
          actions={
            <div className="flex items-center gap-3">
              <PresenceAvatars recordId={data.project.id} recordType="project" />
              <Badge variant="neutral" size="lg">
                {data.project.status.replace('_', ' ')}
              </Badge>
            </div>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Builder" value={data.project.builderName} accent="neutral" />
          <KPICard title="Milestones" value={data.milestones.length} accent="brand" />
          <KPICard
            title="Critical path"
            value={data.milestones.filter((m) => m.critical).length}
            accent="negative"
            subtitle="latest-finishing chain"
          />
          <KPICard title="Span (days)" value={data.axis.spanDays} accent="accent" />
        </div>

        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg">Gantt — timeline</h3>
            <div className="flex items-center gap-3 text-[11px] text-fg-muted">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-forecast" /> Quote
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-brand" /> Order
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-accent" /> Job
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-data-positive" /> Delivery
              </span>
            </div>
          </div>

          {/* Axis */}
          <div className="relative h-5 border-b border-border mb-2">
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex items-center"
                style={{ left: `${t.left}%`, transform: 'translateX(-50%)' }}
              >
                <div className="text-[10px] text-fg-muted font-numeric">{t.label}</div>
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="relative">
            {nowPct !== null && (
              <div
                className="absolute top-0 bottom-0 border-l-2 border-data-negative z-10 pointer-events-none"
                style={{ left: `${nowPct}%` }}
                title="today"
              >
                <div className="absolute -top-4 -translate-x-1/2 text-[10px] text-data-negative font-semibold">
                  TODAY
                </div>
              </div>
            )}
            {kinds.map((k) => {
              const rowItems = data.milestones.filter((m) => m.kind === k)
              if (rowItems.length === 0) return null
              return (
                <div key={k} className="relative mb-2">
                  <div className="text-[11px] text-fg-subtle uppercase tracking-wider mb-0.5">
                    {k}
                  </div>
                  <div className="relative h-7 bg-surface-muted/30 rounded-sm">
                    {rowItems.map((m) => {
                      const geo = barGeometry(m)
                      return (
                        <button
                          key={m.id}
                          onClick={() => setSelected(m)}
                          className={`absolute top-0.5 bottom-0.5 rounded-sm border px-1.5 text-[10px] font-medium truncate ${
                            KIND_STYLE[m.kind]
                          } ${m.critical ? 'ring-1 ring-data-negative' : ''}`}
                          style={{ left: `${geo.left}%`, width: `${geo.width}%` }}
                          title={`${m.label} · ${m.status}`}
                        >
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {selected && (
          <Card padding="md" className="border-accent/30">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow">{selected.kind}</div>
                <div className="text-sm font-semibold text-fg">{selected.label}</div>
                <div className="text-xs text-fg-muted mt-1">
                  Status: <Badge variant="neutral" size="sm">{selected.status.replace('_', ' ')}</Badge>
                </div>
                <div className="text-xs text-fg-muted mt-1">
                  {new Date(selected.start).toLocaleString()} —{' '}
                  {selected.end ? new Date(selected.end).toLocaleString() : 'open'}
                </div>
                {selected.meta && (
                  <div className="text-[11px] text-fg-subtle mt-2">
                    {Object.entries(selected.meta)
                      .filter(([, v]) => v != null)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
