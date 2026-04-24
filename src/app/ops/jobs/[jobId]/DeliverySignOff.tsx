'use client'

// ── DeliverySignOff ─────────────────────────────────────────────────────
// Job-detail surface that lets a PM verify and stamp sign-off on deliveries
// (and, when the row exists, installations). Sign-off POSTs to
// /api/ops/jobs/[id]/pm-signoff and writes an AuditLog entry at
// entity='delivery' or 'installation', action='PM_SIGNOFF'.
//
// Reads deliveries & installations straight from the Job detail payload
// at /api/ops/jobs/[id] (no new list endpoint needed). After a successful
// sign-off we refetch so the row visibly updates.
//
// Feature flag: NEXT_PUBLIC_FEATURE_DELIVERY_SIGNOFF. 'off' → render null.
// ────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Camera, AlertTriangle, RefreshCw } from 'lucide-react'

const ENABLED = process.env.NEXT_PUBLIC_FEATURE_DELIVERY_SIGNOFF !== 'off'

interface DeliveryRow {
  id: string
  deliveryNumber: string
  status: string
  address: string | null
  createdAt: string
  departedAt: string | null
  arrivedAt: string | null
  completedAt: string | null
  signedBy: string | null
  loadPhotos: string[] | null
  sitePhotos: string[] | null
  notes: string | null
  crewId: string | null
}

interface InstallationRow {
  id: string
  installNumber: string
  status: string
  scheduledDate: string | null
  startedAt: string | null
  completedAt: string | null
  passedQC: boolean
  beforePhotos: string[] | null
  afterPhotos: string[] | null
  notes: string | null
  crewId: string | null
}

interface CrewRow {
  id: string
  name: string | null
}

// Signable statuses — must match the server-side allowlist.
const DELIVERY_SIGNABLE = new Set([
  'COMPLETE',
  'UNLOADING',
  'ARRIVED',
  'PARTIAL_DELIVERY',
])
const INSTALLATION_SIGNABLE = new Set(['COMPLETE', 'PUNCH_LIST'])

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function photoCount(arr: string[] | null | undefined): number {
  return Array.isArray(arr) ? arr.length : 0
}

function isDeliverySigned(d: DeliveryRow): boolean {
  if (!d.notes) return false
  return d.notes.includes('PM-SIGNOFF:')
}
function isInstallationSigned(i: InstallationRow): boolean {
  if (!i.notes) return false
  return i.notes.includes('PM-SIGNOFF:')
}

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: 'bg-gray-100 text-gray-700',
  LOADING: 'bg-yellow-100 text-yellow-800',
  IN_TRANSIT: 'bg-orange-100 text-orange-800',
  ARRIVED: 'bg-blue-100 text-blue-800',
  UNLOADING: 'bg-blue-100 text-blue-800',
  COMPLETE: 'bg-green-100 text-green-800',
  PARTIAL_DELIVERY: 'bg-yellow-100 text-yellow-800',
  REFUSED: 'bg-red-100 text-red-800',
  RESCHEDULED: 'bg-gray-100 text-gray-600',
  // Installation
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  PUNCH_LIST: 'bg-red-100 text-red-800',
  REWORK: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

export default function DeliverySignOff({ jobId }: { jobId: string }) {
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [installations, setInstallations] = useState<InstallationRow[]>([])
  const [crews, setCrews] = useState<Record<string, CrewRow>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const j = await res.json()
      setDeliveries(Array.isArray(j.deliveries) ? j.deliveries : [])
      setInstallations(Array.isArray(j.installations) ? j.installations : [])
      setError(null)

      // Best-effort crew name lookup. Failure is silent — the column is
      // optional context, not critical.
      const crewIds = new Set<string>()
      for (const d of j.deliveries || []) if (d.crewId) crewIds.add(d.crewId)
      for (const i of j.installations || []) if (i.crewId) crewIds.add(i.crewId)
      if (crewIds.size > 0) {
        try {
          const qr = await fetch('/api/ops/crews', { cache: 'no-store' })
          if (qr.ok) {
            const cj = await qr.json()
            const list: CrewRow[] = Array.isArray(cj) ? cj : cj.crews || []
            const map: Record<string, CrewRow> = {}
            for (const c of list) map[c.id] = c
            setCrews(map)
          }
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    if (!ENABLED) return
    fetchAll()
  }, [fetchAll])

  const signOff = useCallback(
    async (kind: 'delivery' | 'installation', rowId: string) => {
      setSubmittingId(rowId)
      try {
        const body =
          kind === 'delivery'
            ? { deliveryId: rowId }
            : { installationId: rowId }
        const res = await fetch(`/api/ops/jobs/${jobId}/pm-signoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.message || j?.error || `Failed: ${res.status}`)
        }
        await fetchAll()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'sign-off failed')
      } finally {
        setSubmittingId(null)
      }
    },
    [jobId, fetchAll],
  )

  if (!ENABLED) return null

  return (
    <div className="bg-white rounded-lg border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Delivery & Install Sign-off
        </h2>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          aria-label="Refresh delivery and install list"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {/* Deliveries */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Deliveries ({deliveries.length})
        </p>
        {loading && deliveries.length === 0 ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-gray-400">No deliveries scheduled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 pr-3 font-medium">#</th>
                  <th className="text-left py-2 pr-3 font-medium">Scheduled</th>
                  <th className="text-left py-2 pr-3 font-medium">Status</th>
                  <th className="text-left py-2 pr-3 font-medium">Crew</th>
                  <th className="text-left py-2 pr-3 font-medium">Signed By</th>
                  <th className="text-left py-2 pr-3 font-medium">Photos</th>
                  <th className="text-right py-2 pl-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const signable = DELIVERY_SIGNABLE.has(d.status)
                  const signed = isDeliverySigned(d)
                  const photos = photoCount(d.loadPhotos) + photoCount(d.sitePhotos)
                  const scheduled = d.departedAt || d.createdAt
                  return (
                    <tr
                      key={d.id}
                      className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-3 font-mono text-xs text-[#0f2a3e]">
                        {d.deliveryNumber}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">
                        {formatDate(scheduled)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                            STATUS_COLOR[d.status] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {d.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">
                        {d.crewId ? crews[d.crewId]?.name || '—' : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">
                        {d.signedBy ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                            {d.signedBy}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5" />
                          {photos}
                        </span>
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {signed ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            PM signed
                          </span>
                        ) : signable ? (
                          <button
                            onClick={() => signOff('delivery', d.id)}
                            disabled={submittingId === d.id}
                            className="text-xs px-2.5 py-1 rounded bg-[#C6A24E] text-white hover:bg-[#A8882A] disabled:opacity-50 font-medium"
                          >
                            {submittingId === d.id ? 'Signing…' : 'Sign off as PM'}
                          </button>
                        ) : (
                          // [TODO] /ops/deliveries/[id] detail route isn't
                          // implemented yet — graceful empty link.
                          <Link
                            href={`/ops/deliveries?jobId=${jobId}`}
                            className="text-xs text-gray-500 hover:underline"
                          >
                            View
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Installations */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Installations ({installations.length})
        </p>
        {installations.length === 0 ? (
          <p className="text-sm text-gray-400">No installations scheduled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 pr-3 font-medium">#</th>
                  <th className="text-left py-2 pr-3 font-medium">Scheduled</th>
                  <th className="text-left py-2 pr-3 font-medium">Status</th>
                  <th className="text-left py-2 pr-3 font-medium">Crew</th>
                  <th className="text-left py-2 pr-3 font-medium">QC</th>
                  <th className="text-left py-2 pr-3 font-medium">Photos</th>
                  <th className="text-right py-2 pl-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {installations.map((i) => {
                  const signable = INSTALLATION_SIGNABLE.has(i.status)
                  const signed = isInstallationSigned(i)
                  const photos =
                    photoCount(i.beforePhotos) + photoCount(i.afterPhotos)
                  return (
                    <tr
                      key={i.id}
                      className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-3 font-mono text-xs text-[#0f2a3e]">
                        {i.installNumber}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">
                        {formatDate(i.scheduledDate)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                            STATUS_COLOR[i.status] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {i.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">
                        {i.crewId ? crews[i.crewId]?.name || '—' : '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {i.passedQC ? (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Pass
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5" />
                          {photos}
                        </span>
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {signed ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            PM signed
                          </span>
                        ) : signable ? (
                          <button
                            onClick={() => signOff('installation', i.id)}
                            disabled={submittingId === i.id}
                            className="text-xs px-2.5 py-1 rounded bg-[#C6A24E] text-white hover:bg-[#A8882A] disabled:opacity-50 font-medium"
                          >
                            {submittingId === i.id ? 'Signing…' : 'Sign off as PM'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
