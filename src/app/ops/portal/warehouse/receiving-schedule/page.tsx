'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Card, Button, EmptyState } from '@/components/ui'
import { Truck } from 'lucide-react'

// W-17 — Inbound Receiving Schedule (14-day view)

interface ScheduleDay {
  date: string
  isToday: boolean
  isWeekend: boolean
  pos: Array<{
    id: string
    poNumber: string
    vendorName: string
    status: string
    itemCount: number
    total: number | null
    expectedDate: string
  }>
}

export default function ReceivingSchedulePage() {
  const [days, setDays] = useState<ScheduleDay[]>([])
  const [loading, setLoading] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string>('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/warehouse/receiving-schedule')
      if (res.ok) {
        const data = await res.json()
        setDays(data.days || [])
        setGeneratedAt(data.generatedAt || '')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const fmtDate = (s: string) =>
    new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const fmtMoney = (n: number | null) => (n ? `$${Math.round(n).toLocaleString()}` : '—')

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Warehouse"
          title="Inbound Receiving Schedule"
          description="POs expected in the next 14 days. Plan dock availability and staffing."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Warehouse', href: '/ops/portal/warehouse' }, { label: 'Receiving Schedule' }]}
          actions={
            <Button variant="ghost" size="sm" loading={loading} onClick={load}>
              Refresh
            </Button>
          }
        />

        {generatedAt && (
          <div className="text-xs text-fg-subtle">
            Last refreshed {new Date(generatedAt).toLocaleTimeString()}
          </div>
        )}

        {/* Desktop horizontal grid */}
        <div className="hidden lg:flex gap-2 overflow-x-auto pb-3">
          {days.map((day) => (
            <Card
              key={day.date}
              padding="sm"
              className={`min-w-[200px] flex-shrink-0 ${day.isToday ? 'ring-2 ring-data-warning' : ''} ${day.isWeekend ? 'opacity-60' : ''}`}
            >
              <div className="text-[11px] font-semibold uppercase text-fg-muted">
                {day.isToday ? 'Today' : fmtDate(day.date)}
              </div>
              <div className="text-xs text-fg-subtle mb-2">{day.pos.length} PO{day.pos.length === 1 ? '' : 's'}</div>
              {day.pos.length > 1 && (
                <div className="text-[10px] text-data-warning mb-2 font-semibold">⚠ Conflict — multiple POs</div>
              )}
              <div className="space-y-2">
                {day.pos.map((po) => (
                  <Link
                    key={po.id}
                    href={`/ops/purchasing/${po.id}`}
                    className="block border rounded p-2 hover:bg-surface-muted text-xs"
                  >
                    <div className="font-mono font-semibold">{po.poNumber}</div>
                    <div className="text-fg-muted truncate">{po.vendorName}</div>
                    <div className="flex justify-between mt-1">
                      <span>{po.itemCount} items</span>
                      <span className="font-mono tabular-nums">{fmtMoney(po.total)}</span>
                    </div>
                  </Link>
                ))}
                {day.pos.length === 0 && (
                  <div className="text-[10px] text-fg-subtle italic">No POs</div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Mobile stacked list */}
        <div className="lg:hidden space-y-3">
          {days
            .filter((d) => d.pos.length > 0)
            .map((day) => (
              <Card key={day.date} padding="sm">
                <div className="text-sm font-semibold mb-2">
                  {day.isToday ? 'Today' : fmtDate(day.date)}
                </div>
                <div className="space-y-2">
                  {day.pos.map((po) => (
                    <Link
                      key={po.id}
                      href={`/ops/purchasing/${po.id}`}
                      className="block border rounded p-2 hover:bg-surface-muted"
                    >
                      <div className="flex justify-between">
                        <div className="font-mono font-semibold text-sm">{po.poNumber}</div>
                        <div className="font-mono tabular-nums text-sm">{fmtMoney(po.total)}</div>
                      </div>
                      <div className="text-xs text-fg-muted">{po.vendorName} · {po.itemCount} items</div>
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          {!loading && days.every((d) => d.pos.length === 0) && (
            <EmptyState icon={<Truck />} title="No incoming POs" description="No purchase orders are scheduled for the next 14 days." />
          )}
        </div>
      </div>
    </div>
  )
}
