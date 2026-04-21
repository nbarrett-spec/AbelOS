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
          <div className="panel panel-live p-3 text-sm text-data-negative">{error}</div>
        )}

        {/* Builder Name */}
        <div>
          <label className="label">
            Builder <span className="text-red-500">*</span>
          </label>
          <select
            name="builderName"
            value={formData.builderName}
            onChange={handleChange}
            required
            className="input"
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
          <label className="label">
            Community
          </label>
          <input
            type="text"
            name="community"
            value={formData.community}
            onChange={handleChange}
            placeholder="e.g., Canyon Ridge"
            className="input"
          />
        </div>

        {/* Lot/Block */}
        <div>
          <label className="label">
            Lot/Block
          </label>
          <input
            type="text"
            name="lotBlock"
            value={formData.lotBlock}
            onChange={handleChange}
            placeholder="e.g., Lot 14 Block 3"
            className="input"
          />
        </div>

        {/* Job Address */}
        <div>
          <label className="label">
            Job Address
          </label>
          <input
            type="text"
            name="jobAddress"
            value={formData.jobAddress}
            onChange={handleChange}
            placeholder="e.g., 1234 Main Street"
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Scope Type */}
          <div>
            <label className="label">
              Scope <span className="text-red-500">*</span>
            </label>
            <select
              name="scopeType"
              value={formData.scopeType}
              onChange={handleChange}
              className="input"
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
            <label className="label">
              Drop Plan
            </label>
            <select
              name="dropPlan"
              value={formData.dropPlan}
              onChange={handleChange}
              className="input"
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
            <label className="label">
              Assigned PM
            </label>
            <select
              name="assignedPMId"
              value={formData.assignedPMId}
              onChange={handleChange}
              className="input"
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
            <label className="label">
              Scheduled Date
            </label>
            <input
              type="date"
              name="scheduledDate"
              value={formData.scheduledDate}
              onChange={handleChange}
              className="input"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label">
            Notes
          </label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Any additional notes or special instructions"
            rows={3}
            className="input"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
