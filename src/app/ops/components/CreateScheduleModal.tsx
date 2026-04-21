'use client'

import { useState, useEffect } from 'react'
import { Modal } from './Modal'

interface Job {
  id: string
  jobNumber: string
  builderName: string
}

interface Crew {
  id: string
  name: string
  crewType: string
}

interface CreateScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const ENTRY_TYPE_OPTIONS = [
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'INSTALLATION', label: 'Installation' },
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'RETURN', label: 'Return' },
  { value: 'INSPECTION', label: 'Inspection' },
  { value: 'RESTOCKING', label: 'Restocking' },
]

const STATUS_OPTIONS = [
  { value: 'TENTATIVE', label: 'Tentative' },
  { value: 'FIRM', label: 'Firm' },
]

const TIME_OPTIONS = [
  '6:00 AM',
  '7:00 AM',
  '8:00 AM',
  '9:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '1:00 PM',
  '2:00 PM',
  '3:00 PM',
  '4:00 PM',
  '5:00 PM',
]

export function CreateScheduleModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateScheduleModalProps) {
  const [formData, setFormData] = useState({
    jobId: '',
    entryType: 'DELIVERY',
    title: '',
    scheduledDate: '',
    scheduledTime: '8:00 AM',
    crewId: '',
    status: 'FIRM',
    notes: '',
  })

  const [jobs, setJobs] = useState<Job[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [jobsRes, crewsRes] = await Promise.all([
          fetch('/api/ops/jobs'),
          fetch('/api/ops/crews'),
        ])

        if (jobsRes.ok) {
          const jobsData = await jobsRes.json()
          const jobsList = Array.isArray(jobsData.data) ? jobsData.data : jobsData.jobs || []
          setJobs(jobsList)
        }

        if (crewsRes.ok) {
          const crewsData = await crewsRes.json()
          setCrews(Array.isArray(crewsData) ? crewsData : crewsData.data || crewsData.crews || [])
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
      if (!formData.jobId) {
        throw new Error('Please select a job')
      }

      if (!formData.title) {
        throw new Error('Please enter a title')
      }

      if (!formData.scheduledDate) {
        throw new Error('Please select a scheduled date')
      }

      const payload = {
        jobId: formData.jobId,
        entryType: formData.entryType,
        title: formData.title,
        scheduledDate: new Date(formData.scheduledDate).toISOString(),
        scheduledTime: formData.scheduledTime || undefined,
        crewId: formData.crewId || undefined,
        status: formData.status,
        notes: formData.notes || undefined,
      }

      const response = await fetch('/api/ops/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create schedule entry')
      }

      // Reset form
      setFormData({
        jobId: '',
        entryType: 'DELIVERY',
        title: '',
        scheduledDate: '',
        scheduledTime: '8:00 AM',
        crewId: '',
        status: 'FIRM',
        notes: '',
      })

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule entry')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Schedule Entry" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="panel panel-live p-3 text-sm text-data-negative">{error}</div>
        )}

        {/* Job */}
        <div>
          <label className="label">
            Job <span className="text-red-500">*</span>
          </label>
          <select
            name="jobId"
            value={formData.jobId}
            onChange={handleChange}
            required
            className="input"
          >
            <option value="">Select a job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.jobNumber} - {job.builderName}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Entry Type */}
          <div>
            <label className="label">
              Entry Type <span className="text-red-500">*</span>
            </label>
            <select
              name="entryType"
              value={formData.entryType}
              onChange={handleChange}
              className="input"
            >
              {ENTRY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="label">
              Status <span className="text-red-500">*</span>
            </label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="input"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="label">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="e.g., Morning Delivery - Canyon Ridge Lot 14"
            required
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Scheduled Date */}
          <div>
            <label className="label">
              Scheduled Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="scheduledDate"
              value={formData.scheduledDate}
              onChange={handleChange}
              required
              className="input"
            />
          </div>

          {/* Scheduled Time */}
          <div>
            <label className="label">
              Scheduled Time
            </label>
            <select
              name="scheduledTime"
              value={formData.scheduledTime}
              onChange={handleChange}
              className="input"
            >
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Crew */}
        <div>
          <label className="label">
            Crew
          </label>
          <select
            name="crewId"
            value={formData.crewId}
            onChange={handleChange}
            className="input"
          >
            <option value="">Unassigned</option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name} ({crew.crewType})
              </option>
            ))}
          </select>
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
            placeholder="Special instructions, directions, or additional details"
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
            {loading ? 'Creating...' : 'Create Entry'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
