'use client'

import { useState, useEffect } from 'react'
import { Modal } from './Modal'

interface Builder {
  id: string
  companyName: string
}

interface Staff {
  id: string
  firstName: string
  lastName: string
}

interface CreateJobModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const SCOPE_OPTIONS = [
  { value: 'DOORS_ONLY', label: 'Doors Only' },
  { value: 'TRIM_ONLY', label: 'Trim Only' },
  { value: 'DOORS_AND_TRIM', label: 'Doors and Trim' },
  { value: 'HARDWARE_ONLY', label: 'Hardware Only' },
  { value: 'FULL_PACKAGE', label: 'Full Package' },
  { value: 'CUSTOM', label: 'Custom' },
]

const DROP_PLAN_OPTIONS = [
  { value: 'Single Drop', label: 'Single Drop' },
  { value: 'Staged', label: 'Staged' },
  { value: 'Multi-Drop', label: 'Multi-Drop' },
]

export function CreateJobModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateJobModalProps) {
  const [formData, setFormData] = useState({
    builderName: '',
    community: '',
    lotBlock: '',
    jobAddress: '',
    scopeType: 'DOORS_AND_TRIM',
    dropPlan: 'Single Drop',
    assignedPMId: '',
    scheduledDate: '',
    notes: '',
  })

  const [builders, setBuilders] = useState<Builder[]>([])
  const [pms, setPMs] = useState<Staff[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [buildersRes, pmsRes] = await Promise.all([
          fetch('/api/ops/builders'),
          fetch('/api/staff?role=PROJECT_MANAGER'),
        ])

        if (buildersRes.ok) {
          const buildersData = await buildersRes.json()
          setBuilders(Array.isArray(buildersData) ? buildersData : buildersData.data || [])
        }

        if (pmsRes.ok) {
          const pmsData = await pmsRes.json()
          setPMs(Array.isArray(pmsData) ? pmsData : pmsData.data || [])
        }
      } catch (err) {
        console.error('Failed to fetch data:', err)
      }
    }

    if (isOpen) {
      fetchData()
    }
  }, [isOpen])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const payload = {
        builderName: formData.builderName,
        community: formData.community || undefined,
        lotBlock: formData.lotBlock || undefined,
        jobAddress: formData.jobAddress || undefined,
        scopeType: formData.scopeType,
        dropPlan: formData.dropPlan || undefined,
        assignedPMId: formData.assignedPMId || undefined,
        scheduledDate: formData.scheduledDate ? new Date(formData.scheduledDate).toISOString() : undefined,
        notes: formData.notes || undefined,
      }

      const response = await fetch('/api/ops/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create job')
      }

      // Reset form
      setFormData({
        builderName: '',
        community: '',
        lotBlock: '',
        jobAddress: '',
        scopeType: 'DOORS_AND_TRIM',
        dropPlan: 'Single Drop',
        assignedPMId: '',
        scheduledDate: '',
        notes: '',
      })

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Job" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Builder Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Builder <span className="text-red-500">*</span>
          </label>
          <select
            name="builderName"
            value={formData.builderName}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
          >
            <option value="">Select a builder</option>
            {builders.map((builder) => (
              <option key={builder.id} value={builder.companyName}>
                {builder.companyName}
              </option>
            ))}
          </select>
        </div>

        {/* Community */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Community
          </label>
          <input
            type="text"
            name="community"
            value={formData.community}
            onChange={handleChange}
            placeholder="e.g., Canyon Ridge"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
          />
        </div>

        {/* Lot/Block */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Lot/Block
          </label>
          <input
            type="text"
            name="lotBlock"
            value={formData.lotBlock}
            onChange={handleChange}
            placeholder="e.g., Lot 14 Block 3"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
          />
        </div>

        {/* Job Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Job Address
          </label>
          <input
            type="text"
            name="jobAddress"
            value={formData.jobAddress}
            onChange={handleChange}
            placeholder="e.g., 1234 Main Street"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Scope Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scope <span className="text-red-500">*</span>
            </label>
            <select
              name="scopeType"
              value={formData.scopeType}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Drop Plan */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Drop Plan
            </label>
            <select
              name="dropPlan"
              value={formData.dropPlan}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            >
              {DROP_PLAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Assigned PM */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assigned PM
            </label>
            <select
              name="assignedPMId"
              value={formData.assignedPMId}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            >
              <option value="">Unassigned</option>
              {pms.map((pm) => (
                <option key={pm.id} value={pm.id}>
                  {pm.firstName} {pm.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Scheduled Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scheduled Date
            </label>
            <input
              type="date"
              name="scheduledDate"
              value={formData.scheduledDate}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Any additional notes or special instructions"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
