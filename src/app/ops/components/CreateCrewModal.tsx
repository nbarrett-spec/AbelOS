'use client'

import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'

interface StaffMember {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  department: string
  active: boolean
}

interface CreateCrewModalProps {
  onClose: () => void
  onCrewCreated: () => void
}

export function CreateCrewModal({ onClose, onCrewCreated }: CreateCrewModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    crewType: 'DELIVERY',
    vehicleId: '',
    vehiclePlate: '',
  })

  const [memberIds, setMemberIds] = useState<string[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchingStaff, setFetchingStaff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStaff = async () => {
      try {
        setFetchingStaff(true)
        const res = await fetch('/api/ops/staff?active=true')
        if (res.ok) {
          const data = await res.json()
          setStaff(Array.isArray(data) ? data : data.staff || [])
        }
      } catch (err) {
        console.error('Failed to fetch staff:', err)
      } finally {
        setFetchingStaff(false)
      }
    }
    fetchStaff()
  }, [])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const toggleMember = (staffId: string) => {
    setMemberIds((prev) =>
      prev.includes(staffId) ? prev.filter((id) => id !== staffId) : [...prev, staffId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/ops/crews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          crewType: formData.crewType,
          vehicleId: formData.vehicleId || null,
          vehiclePlate: formData.vehiclePlate || null,
          memberIds: memberIds.length > 0 ? memberIds : [],
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to create crew')
      }

      onCrewCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const selectedStaffCount = memberIds.length
  const availableStaff = staff.filter((s) => s.active)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="panel panel-elevated max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="eyebrow">Operations</div>
            <h2 className="text-lg font-semibold text-fg">Create New Crew</h2>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="panel panel-live p-3 flex items-start gap-2 text-sm text-data-negative">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Basic Info */}
          <section className="space-y-4">
            <h3 className="eyebrow">Basic Information</h3>

            <div>
              <label className="label">Crew Name <span className="text-data-negative">*</span></label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="e.g., Delivery Team A, Install Crew - Sean"
                className="input"
              />
            </div>

            <div>
              <label className="label">Crew Type <span className="text-data-negative">*</span></label>
              <select name="crewType" value={formData.crewType} onChange={handleChange} className="input">
                <option value="DELIVERY">Delivery</option>
                <option value="INSTALLATION">Installation</option>
                <option value="DELIVERY_AND_INSTALL">Delivery & Installation</option>
              </select>
            </div>
          </section>

          <div className="divider" />

          {/* Vehicle Info */}
          <section className="space-y-4">
            <h3 className="eyebrow">Vehicle Information (Optional)</h3>

            <div>
              <label className="label">Vehicle ID</label>
              <input
                type="text"
                name="vehicleId"
                value={formData.vehicleId}
                onChange={handleChange}
                placeholder="Vehicle ID"
                className="input"
              />
            </div>

            <div>
              <label className="label">License Plate</label>
              <input
                type="text"
                name="vehiclePlate"
                value={formData.vehiclePlate}
                onChange={handleChange}
                placeholder="e.g., ABC-123"
                className="input font-mono"
              />
            </div>
          </section>

          <div className="divider" />

          {/* Team Members */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">Team Members</h3>
              <Badge variant="orange" size="sm">{selectedStaffCount} selected</Badge>
            </div>

            {fetchingStaff ? (
              <div className="p-4 text-center text-sm text-fg-muted">Loading staff...</div>
            ) : availableStaff.length === 0 ? (
              <div className="p-4 text-center text-sm text-fg-muted">No active staff available</div>
            ) : (
              <div className="max-h-64 overflow-y-auto scrollbar-thin panel p-2 space-y-1">
                {availableStaff.map((staffMember) => {
                  const checked = memberIds.includes(staffMember.id)
                  return (
                    <label
                      key={staffMember.id}
                      className={cn(
                        'flex items-start gap-3 p-2 rounded-md transition-colors cursor-pointer',
                        checked ? 'bg-accent-subtle' : 'hover:bg-surface-muted'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(staffMember.id)}
                        className="mt-0.5 w-4 h-4 rounded accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-fg">
                          {staffMember.firstName} {staffMember.lastName}
                        </p>
                        <p className="text-xs text-fg-subtle truncate">{staffMember.email}</p>
                        <p className="text-xs text-fg-muted mt-0.5">
                          {staffMember.role}
                          {staffMember.department && ` · ${staffMember.department}`}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </section>

          <div className="border-t border-border pt-4 flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.name || !formData.crewType}
              className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Crew'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
