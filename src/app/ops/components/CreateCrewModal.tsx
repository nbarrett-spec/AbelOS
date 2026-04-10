'use client'

import { useState, useEffect } from 'react'

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

const CREW_TYPES = ['DELIVERY', 'INSTALLATION', 'DELIVERY_AND_INSTALL']

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
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const toggleMember = (staffId: string) => {
    setMemberIds((prev) =>
      prev.includes(staffId)
        ? prev.filter((id) => id !== staffId)
        : [...prev, staffId]
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Create New Crew</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 text-sm">Basic Information</h3>

            <div>
              <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
                Crew Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="e.g., Delivery Team A, Install Crew - Sean"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E67E22]"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
                Crew Type *
              </label>
              <select
                name="crewType"
                value={formData.crewType}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E67E22]"
              >
                <option value="DELIVERY">Delivery</option>
                <option value="INSTALLATION">Installation</option>
                <option value="DELIVERY_AND_INSTALL">Delivery & Installation</option>
              </select>
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="space-y-4 border-t pt-4">
            <h3 className="font-semibold text-gray-900 text-sm">Vehicle Information (Optional)</h3>

            <div>
              <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
                Vehicle ID
              </label>
              <input
                type="text"
                name="vehicleId"
                value={formData.vehicleId}
                onChange={handleChange}
                placeholder="Vehicle ID"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E67E22]"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
                License Plate
              </label>
              <input
                type="text"
                name="vehiclePlate"
                value={formData.vehiclePlate}
                onChange={handleChange}
                placeholder="e.g., ABC-123"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E67E22] font-mono"
              />
            </div>
          </div>

          {/* Team Members */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Team Members</h3>
              <span className="text-xs bg-[#E67E22] text-white px-2.5 py-1 rounded-full">
                {selectedStaffCount} selected
              </span>
            </div>

            {fetchingStaff ? (
              <div className="p-4 text-center text-sm text-gray-500">Loading staff...</div>
            ) : availableStaff.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">No active staff available</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3 bg-gray-50">
                {availableStaff.map((staffMember) => (
                  <label
                    key={staffMember.id}
                    className="flex items-start gap-3 p-2 rounded hover:bg-white transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={memberIds.includes(staffMember.id)}
                      onChange={() => toggleMember(staffMember.id)}
                      className="mt-0.5 w-4 h-4 rounded accent-[#E67E22]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900">
                        {staffMember.firstName} {staffMember.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{staffMember.email}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {staffMember.role}
                        {staffMember.department && ` • ${staffMember.department}`}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.name || !formData.crewType}
              className="px-4 py-2 text-sm font-medium text-white bg-[#E67E22] rounded-lg hover:bg-[#D46D1A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Crew'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
