'use client'

import { useState, useEffect } from 'react'
import { Modal } from './Modal'

interface ScheduleEntryModalProps {
  isOpen: boolean
  entryId: string | null
  onClose: () => void
  onUpdate: () => void
}

const ENTRY_TYPE_COLORS: Record<string, string> = {
  DELIVERY: '#3B82F6',
  INSTALLATION: '#10B981',
  PICKUP: '#FBBF24',
  RETURN: '#F97316',
  INSPECTION: '#A78BFA',
  RESTOCKING: '#9CA3AF',
}

const STATUS_OPTIONS = ['TENTATIVE', 'FIRM', 'IN_PROGRESS', 'COMPLETED', 'RESCHEDULED', 'CANCELLED']

export function ScheduleEntryModal({ isOpen, entryId, onClose, onUpdate }: ScheduleEntryModalProps) {
  const [entry, setEntry] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Editable fields
  const [editStatus, setEditStatus] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editNotes, setEditNotes] = useState('')

  useEffect(() => {
    if (isOpen && entryId) {
      fetchEntry()
      setEditMode(false)
      setConfirmDelete(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, entryId])

  const fetchEntry = async () => {
    if (!entryId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/schedule/${entryId}`)
      if (!res.ok) throw new Error('Failed to load entry')
      const data = await res.json()
      setEntry(data)
      setEditStatus(data.status)
      setEditDate(data.scheduledDate ? new Date(data.scheduledDate).toISOString().split('T')[0] : '')
      setEditTime(data.scheduledTime || '')
      setEditNotes(data.notes || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!entryId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/schedule/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          scheduledDate: editDate,
          scheduledTime: editTime,
          notes: editNotes,
          ...(editStatus === 'IN_PROGRESS' && !entry.startedAt ? { startedAt: new Date().toISOString() } : {}),
          ...(editStatus === 'COMPLETED' && !entry.completedAt ? { completedAt: new Date().toISOString() } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed to update')
      const updated = await res.json()
      setEntry(updated)
      setEditMode(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!entryId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/schedule/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          ...(newStatus === 'IN_PROGRESS' ? { startedAt: new Date().toISOString() } : {}),
          ...(newStatus === 'COMPLETED' ? { completedAt: new Date().toISOString() } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      const updated = await res.json()
      setEntry(updated)
      setEditStatus(newStatus)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!entryId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/schedule/${entryId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onUpdate()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setEditMode(false)
    setConfirmDelete(false)
    setError(null)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={entry?.title || 'Schedule Entry'} size="xl">
      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading entry details...</div>
      ) : error && !entry ? (
        <div className="text-center py-8 text-red-500">{error}</div>
      ) : entry ? (
        <div className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}

          {/* Type & Status badges */}
          <div className="flex items-center gap-3">
            <span
              className="px-3 py-1 rounded text-white text-sm font-semibold"
              style={{ backgroundColor: ENTRY_TYPE_COLORS[entry.entryType] || '#9CA3AF' }}
            >
              {entry.entryType}
            </span>
            <span className={`px-3 py-1 rounded text-sm font-semibold border-2 ${
              entry.status === 'COMPLETED' ? 'border-green-500 text-green-700 bg-green-50' :
              entry.status === 'IN_PROGRESS' ? 'border-blue-500 text-blue-700 bg-blue-50' :
              entry.status === 'CANCELLED' ? 'border-red-500 text-red-700 bg-red-50 line-through' :
              entry.status === 'RESCHEDULED' ? 'border-orange-500 text-orange-700 bg-orange-50' :
              'border-gray-300 text-gray-700 bg-gray-50'
            }`}>
              {entry.status}
            </span>
          </div>

          {/* Quick status buttons */}
          {!editMode && !['COMPLETED', 'CANCELLED'].includes(entry.status) && (
            <div className="flex flex-wrap gap-2">
              {entry.status === 'TENTATIVE' && (
                <button onClick={() => handleStatusChange('FIRM')} disabled={saving}
                  className="px-3 py-1.5 text-sm bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14] disabled:opacity-50">
                  Confirm (Firm)
                </button>
              )}
              {['TENTATIVE', 'FIRM'].includes(entry.status) && (
                <button onClick={() => handleStatusChange('IN_PROGRESS')} disabled={saving}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  Start
                </button>
              )}
              {['FIRM', 'IN_PROGRESS'].includes(entry.status) && (
                <button onClick={() => handleStatusChange('COMPLETED')} disabled={saving}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  Complete
                </button>
              )}
              <button onClick={() => handleStatusChange('CANCELLED')} disabled={saving}
                className="px-3 py-1.5 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">
                Cancel
              </button>
            </div>
          )}

          {/* Detail fields */}
          {editMode ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Status</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Date</label>
                  <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Time</label>
                  <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes</label>
                <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                  rows={3} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Add notes..." />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-2 bg-[#3E2A1E] text-white rounded-lg text-sm font-medium hover:bg-[#2A1C14] disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={() => setEditMode(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Job info */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">Job Details</p>
                <p className="text-sm font-medium text-gray-900">{entry.job?.address || entry.jobAddress || 'No address'}</p>
                <p className="text-sm text-gray-600">{entry.builderName || entry.job?.builder?.name || 'Unknown builder'}</p>
                {entry.job?.community && (
                  <p className="text-xs text-gray-500">{entry.job.community}{entry.job.lotBlock ? ` - ${entry.job.lotBlock}` : ''}</p>
                )}
                {entry.job?.status && (
                  <p className="text-xs text-gray-400">Job status: {entry.job.status}</p>
                )}
              </div>

              {/* Schedule info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Scheduled Date</p>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {entry.scheduledDate
                      ? new Date(entry.scheduledDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Not set'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Time</p>
                  <p className="text-sm font-medium text-gray-900 mt-1">{entry.scheduledTime || 'Not set'}</p>
                </div>
              </div>

              {/* Crew */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Crew</p>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {entry.crew?.name || 'Unassigned'}
                  {entry.crew?.crewType && <span className="text-gray-500 ml-2">({entry.crew.crewType})</span>}
                </p>
              </div>

              {/* Timestamps */}
              {(entry.startedAt || entry.completedAt) && (
                <div className="grid grid-cols-2 gap-4">
                  {entry.startedAt && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Started</p>
                      <p className="text-sm text-gray-900 mt-1">
                        {new Date(entry.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                  {entry.completedAt && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Completed</p>
                      <p className="text-sm text-gray-900 mt-1">
                        {new Date(entry.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {entry.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Notes</p>
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{entry.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Action bar */}
          {!editMode && (
            <div className="flex items-center justify-between pt-4 border-t">
              <button onClick={() => setEditMode(true)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                Edit Entry
              </button>
              {confirmDelete ? (
                <div className="flex gap-2 items-center">
                  <span className="text-sm text-red-600">Are you sure?</span>
                  <button onClick={handleDelete} disabled={saving}
                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {saving ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                    No
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
