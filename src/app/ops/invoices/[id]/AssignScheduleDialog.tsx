'use client'

import { useState, useEffect } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Dialog: assign a crew + date to a LABOR invoice line.
// Calls POST /api/ops/invoices/[id]/items/[itemId]/assign-schedule and
// returns the server response to the parent via onSuccess so the parent
// re-renders without a page reload.
// ──────────────────────────────────────────────────────────────────────────

interface Crew {
  id: string
  name: string
  active?: boolean
}

interface Item {
  id: string
  description: string
  lineType: string
  installationId?: string | null
  installationScheduledDate?: string | null
  installationCrewName?: string | null
  scheduleEntryId?: string | null
  scheduleEntryScheduledDate?: string | null
  scheduleEntryCrewName?: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: (payload: any) => void
  invoiceId: string
  item: Item | null
  crews: Crew[]
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // yyyy-mm-dd for <input type="date">.
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function AssignScheduleDialog({
  open, onClose, onSuccess, invoiceId, item, crews,
}: Props) {
  const [crewId, setCrewId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scopeNotes, setScopeNotes] = useState('')
  const [installationType, setInstallationType] = useState<'INSTALLATION' | 'SCHEDULE'>('INSTALLATION')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed defaults from the current assignment (if any) when the dialog opens.
  useEffect(() => {
    if (!open || !item) return
    const existingCrewId =
      crews.find(c => c.name === item.installationCrewName)?.id ||
      crews.find(c => c.name === item.scheduleEntryCrewName)?.id ||
      ''
    const existingDate =
      toDateInputValue(item.installationScheduledDate) ||
      toDateInputValue(item.scheduleEntryScheduledDate) ||
      ''
    setCrewId(existingCrewId)
    setScheduledDate(existingDate)
    setScopeNotes('')
    setInstallationType(item.scheduleEntryId && !item.installationId ? 'SCHEDULE' : 'INSTALLATION')
    setError(null)
  }, [open, item, crews])

  if (!open || !item) return null

  const submit = async () => {
    setError(null)
    if (!crewId) { setError('Pick a crew.'); return }
    if (!scheduledDate) { setError('Pick a date.'); return }
    setSaving(true)
    try {
      const res = await fetch(
        `/api/ops/invoices/${invoiceId}/items/${item.id}/assign-schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            crewId,
            scheduledDate: new Date(scheduledDate).toISOString(),
            scopeNotes: scopeNotes.trim() || undefined,
            installationType,
          }),
        },
      )
      const payload = await res.json()
      if (!res.ok) {
        setError(payload?.error || 'Failed to assign schedule')
        setSaving(false)
        return
      }
      onSuccess(payload)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const hasExisting = Boolean(item.installationId || item.scheduleEntryId)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg text-gray-900">
              {hasExisting ? 'Reassign labor' : 'Schedule labor'}
            </h3>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {hasExisting && (
          <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
            Currently assigned to{' '}
            <span className="font-medium text-gray-700">
              {item.installationCrewName || item.scheduleEntryCrewName || 'a crew'}
            </span>{' '}
            on{' '}
            <span className="font-medium text-gray-700">
              {toDateInputValue(item.installationScheduledDate || item.scheduleEntryScheduledDate) || 'unknown date'}
            </span>. Saving will create a new assignment and unlink the old one.
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Crew</label>
          <select
            value={crewId}
            onChange={e => setCrewId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]/30 focus:border-[#0f2a3e]"
          >
            <option value="">Select a crew...</option>
            {crews.filter(c => c.active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Scheduled date</label>
          <input
            type="date"
            value={scheduledDate}
            onChange={e => setScheduledDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]/30 focus:border-[#0f2a3e]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Type</label>
          <div className="flex gap-2 text-sm">
            <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="installationType"
                value="INSTALLATION"
                checked={installationType === 'INSTALLATION'}
                onChange={() => setInstallationType('INSTALLATION')}
              />
              <span>Install (field work)</span>
            </label>
            <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="installationType"
                value="SCHEDULE"
                checked={installationType === 'SCHEDULE'}
                onChange={() => setInstallationType('SCHEDULE')}
              />
              <span>Schedule entry</span>
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Notes (optional)</label>
          <textarea
            value={scopeNotes}
            onChange={e => setScopeNotes(e.target.value)}
            rows={2}
            placeholder="Scope of work, access details, etc."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2a3e]/30 focus:border-[#0f2a3e]"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !crewId || !scheduledDate}
            className="px-4 py-2 text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : hasExisting ? 'Reassign' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
