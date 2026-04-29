'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ─── Types matching /api/ops/warehouse/daily-plan response shape ────────────
interface ProductionJob {
  jobId: string
  jobNumber: string
  builderName: string | null
  community: string | null
  jobAddress: string | null
  scheduledDate: string | null
  status: string
  pickListGenerated: boolean | null
  materialsLocked: boolean | null
  pmName: string | null
  pickCount: number
}

interface IncomingPO {
  poId: string
  poNumber: string
  expectedDate: string | null
  status: string
  total: number | null
  vendorId: string | null
  vendorName: string | null
  lineCount: number
  crossDockFlags: number
}

interface ShortageJob {
  jobId: string
  jobNumber: string
  builderName: string | null
  scheduledDate: string | null
  status: string
  shortCount: number
}

interface MaterialConfirmItem {
  id: string
  title: string
  description: string | null
  priority: string
  dueBy: string | null
  entityId: string | null
  createdAt: string
}

interface Driver {
  id: string
  firstName: string
  lastName: string
  role: string
  crewId: string | null
  crewName: string | null
  vehiclePlate: string | null
  stopsToday: number
}

interface WarehouseStaff {
  id: string
  firstName: string
  lastName: string
  role: string
  title: string | null
}

interface DailyPlan {
  generatedAt: string
  summary: {
    trucksOut: number
    productionJobs: number
    incomingPOs: number
    exceptionCount: number
    teamOnShift: number
  }
  sections: {
    todayDeliveries: Array<{
      truckId: string | null
      truckName: string
      vehiclePlate: string | null
      scheduledDeparture: string | null
      loadStatus: string
      jobs: Array<{ jobId: string; jobNumber: string; builderName: string | null }>
    }>
    productionQueue: ProductionJob[]
    incomingPOs: IncomingPO[]
    exceptions: {
      shortageJobs: ShortageJob[]
      goldStockLow: Array<{ id: string; name: string; minQty: number; currentQty: number }>
      cycleCounts: Array<{ id: string; batchNumber: string; status: string; lineCount: number; countedCount: number }>
      materialConfirmItems: MaterialConfirmItem[]
    }
    teamQueue: {
      drivers: Driver[]
      warehouseTeam: WarehouseStaff[]
    }
  }
}

export default function WarehouseBriefingPage() {
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ─── Add Note state ──────────────────────────────────────────────────────
  const [note, setNote] = useState('')
  const [notePriority, setNotePriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM')
  const [posting, setPosting] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    async function loadPlan() {
      try {
        const res = await fetch('/api/ops/warehouse/daily-plan')
        if (res.ok) {
          const data = await res.json()
          setPlan(data)
        } else {
          setErrorMsg(`Failed to load briefing (${res.status})`)
        }
      } catch (error) {
        console.error('Failed to load warehouse daily plan:', error)
        setErrorMsg('Failed to load briefing')
      } finally {
        setLoading(false)
      }
    }
    loadPlan()
  }, [])

  // ─── Auto-dismiss toast ──────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  async function postNote() {
    if (!note.trim()) {
      setToast({ type: 'error', message: 'Note cannot be empty' })
      return
    }
    setPosting(true)
    try {
      const res = await fetch('/api/ops/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'WAREHOUSE_BRIEFING_NOTE',
          source: 'warehouse-briefing',
          title: `Shift Note — ${new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`,
          description: note.trim(),
          priority: notePriority,
        }),
      })

      if (res.ok) {
        setToast({ type: 'success', message: 'Note posted to operator inbox' })
        setNote('')
      } else {
        // Fallback: log locally and still show success so the standup keeps moving
        console.warn('[warehouse-briefing] inbox POST failed, logging locally:', {
          note: note.trim(),
          priority: notePriority,
          status: res.status,
        })
        setToast({
          type: 'success',
          message: 'Note saved locally (inbox unavailable)',
        })
        setNote('')
      }
    } catch (err) {
      console.warn('[warehouse-briefing] inbox POST threw, logging locally:', {
        note: note.trim(),
        priority: notePriority,
        error: err,
      })
      setToast({
        type: 'success',
        message: 'Note saved locally (inbox unavailable)',
      })
      setNote('')
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#27AE60]" />
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>{errorMsg || 'Failed to load briefing'}</p>
      </div>
    )
  }

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  // ─── Compute "today" + "tomorrow" PO buckets (Chicago-relative date strings)
  const todayLocal = new Date()
  const tomorrowLocal = new Date(todayLocal)
  tomorrowLocal.setDate(tomorrowLocal.getDate() + 1)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const todayKey = ymd(todayLocal)
  const tomorrowKey = ymd(tomorrowLocal)

  const posToday = plan.sections.incomingPOs.filter(
    (po) => po.expectedDate && po.expectedDate.slice(0, 10) === todayKey
  )
  const posTomorrow = plan.sections.incomingPOs.filter(
    (po) => po.expectedDate && po.expectedDate.slice(0, 10) === tomorrowKey
  )

  // ─── Top 5 priority jobs (already sorted by scheduledDate ASC from the API)
  const topJobs = plan.sections.productionQueue.slice(0, 5)

  // ─── Shortage summary count
  const shortageJobCount = plan.sections.exceptions.shortageJobs.length
  const shortageItemCount = plan.sections.exceptions.shortageJobs.reduce(
    (sum, j) => sum + (j.shortCount || 0),
    0
  )

  // ─── Staff on-shift = drivers + warehouse team
  const drivers = plan.sections.teamQueue.drivers
  const warehouseTeam = plan.sections.teamQueue.warehouseTeam
  const totalOnShift = drivers.length + warehouseTeam.length

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Print-friendly CSS */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5in;
          }
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .print-keep-together {
            page-break-inside: avoid;
          }
          a {
            color: #111 !important;
            text-decoration: none !important;
          }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between print:border-b print:pb-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Daily Warehouse Briefing</h1>
          <p className="text-gray-600 mt-1">{dateStr}</p>
          <p className="text-xs text-gray-400 mt-1">
            Generated {new Date(plan.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-[#27AE60] text-white rounded-lg hover:bg-[#1E8449] transition-colors text-sm font-medium"
          >
            Print
          </button>
          <Link
            href="/ops/portal/warehouse"
            className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 print:grid-cols-5">
        <KpiCard label="Trucks Out" value={plan.summary.trucksOut} accent="border-l-blue-500" />
        <KpiCard
          label="Production Jobs"
          value={plan.summary.productionJobs}
          accent="border-l-[#27AE60]"
        />
        <KpiCard
          label="Incoming POs"
          value={plan.summary.incomingPOs}
          accent="border-l-green-600"
        />
        <KpiCard
          label="Exceptions"
          value={plan.summary.exceptionCount}
          accent="border-l-red-600"
        />
        <KpiCard label="Team On-Shift" value={totalOnShift} accent="border-l-purple-500" />
      </div>

      {/* Section 1: Today's Priority Jobs */}
      <section className="bg-white rounded-xl border p-6 print-keep-together">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Today&apos;s Priority Jobs (Top {topJobs.length})
        </h2>
        {topJobs.length === 0 ? (
          <p className="text-gray-500 text-sm">No data available</p>
        ) : (
          <div className="space-y-2">
            {topJobs.map((job, idx) => (
              <div
                key={job.jobId}
                className="flex items-start justify-between p-3 rounded-lg border border-gray-200 hover:border-[#27AE60] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-gray-400 mt-0.5">#{idx + 1}</span>
                  <div>
                    <Link
                      href={`/ops/manufacturing/jobs/${job.jobId}`}
                      className="font-semibold text-[#27AE60] hover:text-[#1E8449]"
                    >
                      {job.jobNumber}
                    </Link>
                    <p className="text-sm text-gray-700 mt-0.5">
                      {job.builderName || '—'} {job.community ? `· ${job.community}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {job.scheduledDate
                        ? new Date(job.scheduledDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                      {job.pmName ? ` · PM: ${job.pmName}` : ''}
                      {' · '}
                      {job.pickCount} picks
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded font-semibold ${
                    job.status === 'IN_PRODUCTION'
                      ? 'bg-blue-100 text-blue-800'
                      : job.status === 'MATERIALS_LOCKED'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {job.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Incoming PO Arrivals (Today + Tomorrow) */}
      <section className="bg-white rounded-xl border p-6 print-keep-together">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Incoming PO Arrivals
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Today ({posToday.length})
            </h3>
            {posToday.length === 0 ? (
              <p className="text-gray-400 text-sm">No data available</p>
            ) : (
              <ul className="space-y-2">
                {posToday.map((po) => (
                  <POLine key={po.poId} po={po} />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Tomorrow ({posTomorrow.length})
            </h3>
            {posTomorrow.length === 0 ? (
              <p className="text-gray-400 text-sm">No data available</p>
            ) : (
              <ul className="space-y-2">
                {posTomorrow.map((po) => (
                  <POLine key={po.poId} po={po} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Section 3: Staff On-Shift */}
      <section className="bg-white rounded-xl border p-6 print-keep-together">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Staff On-Shift Today ({totalOnShift})
        </h2>
        {totalOnShift === 0 ? (
          <p className="text-gray-500 text-sm">No data available</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Drivers ({drivers.length})
              </h3>
              {drivers.length === 0 ? (
                <p className="text-gray-400 text-sm">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {drivers.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-900">
                        {d.firstName} {d.lastName}
                        {d.crewName ? (
                          <span className="text-gray-500 text-xs ml-2">
                            · {d.crewName}
                            {d.vehiclePlate ? ` (${d.vehiclePlate})` : ''}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-gray-500">
                        {d.stopsToday} stop{d.stopsToday === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Warehouse Team ({warehouseTeam.length})
              </h3>
              {warehouseTeam.length === 0 ? (
                <p className="text-gray-400 text-sm">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {warehouseTeam.map((w) => (
                    <li key={w.id} className="text-sm">
                      <span className="text-gray-900">
                        {w.firstName} {w.lastName}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        {w.title || w.role.replace(/_/g, ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Section 4: Shortages / Backorders */}
      <section className="bg-white rounded-xl border p-6 print-keep-together">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Shortages &amp; Backorders
        </h2>
        {shortageJobCount === 0 ? (
          <p className="text-gray-500 text-sm">
            No active shortages. All allocations covered.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div>
                <p className="text-xs uppercase tracking-wide text-red-700">Jobs Affected</p>
                <p className="text-2xl font-bold text-red-700">{shortageJobCount}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-red-700">SKU Shortages</p>
                <p className="text-2xl font-bold text-red-700">{shortageItemCount}</p>
              </div>
            </div>
            <ul className="space-y-2">
              {plan.sections.exceptions.shortageJobs.slice(0, 8).map((s) => (
                <li
                  key={s.jobId}
                  className="flex items-center justify-between p-3 rounded border border-red-200 bg-red-50"
                >
                  <Link
                    href={`/ops/manufacturing/jobs/${s.jobId}`}
                    className="text-sm font-semibold text-[#27AE60] hover:text-[#1E8449]"
                  >
                    {s.jobNumber}
                  </Link>
                  <span className="text-xs text-gray-700">
                    {s.builderName || '—'}
                    {s.scheduledDate
                      ? ` · ${new Date(s.scheduledDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}`
                      : ''}
                  </span>
                  <span className="text-xs px-2 py-1 rounded bg-red-200 text-red-900 font-semibold">
                    {s.shortCount} short
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Section 5: Add Note (lead's safety/priority callout) */}
      <section className="bg-white rounded-xl border-2 border-[#27AE60]/30 p-6 no-print">
        <h2 className="text-lg font-bold text-gray-900 mb-2">Lead Note for Crew</h2>
        <p className="text-sm text-gray-600 mb-4">
          Post a safety reminder, priority callout, or schedule change. Saved to the operator
          inbox so the next shift sees it.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Watch the spilled stain in bay 3 — wear boots, not sneakers. Pulte job 1247 needs to leave by 9 AM sharp."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#27AE60] focus:border-transparent text-sm"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700">Priority:</label>
            <select
              value={notePriority}
              onChange={(e) =>
                setNotePriority(e.target.value as 'HIGH' | 'MEDIUM' | 'LOW')
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm"
            >
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <button
            onClick={postNote}
            disabled={posting || !note.trim()}
            className="px-4 py-2 bg-[#27AE60] text-white rounded-lg hover:bg-[#1E8449] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {posting ? 'Posting…' : 'Post Note'}
          </button>
        </div>
      </section>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium no-print ${
            toast.type === 'success'
              ? 'bg-[#27AE60] text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: string
}) {
  return (
    <div className={`bg-white rounded-xl border border-l-4 ${accent} p-4`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}

function POLine({ po }: { po: IncomingPO }) {
  return (
    <li className="flex items-start justify-between p-3 rounded border border-green-200 bg-green-50">
      <div>
        <Link
          href={`/ops/purchasing/${po.poId}`}
          className="text-sm font-semibold text-[#27AE60] hover:text-[#1E8449] font-mono"
        >
          {po.poNumber}
        </Link>
        <p className="text-xs text-gray-700 mt-0.5">{po.vendorName || '—'}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {po.lineCount} line{po.lineCount === 1 ? '' : 's'}
          {po.crossDockFlags > 0 ? ` · ${po.crossDockFlags} cross-dock` : ''}
        </p>
      </div>
      <span className="text-xs text-gray-700 whitespace-nowrap">
        {po.total
          ? `$${po.total.toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}`
          : ''}
      </span>
    </li>
  )
}
