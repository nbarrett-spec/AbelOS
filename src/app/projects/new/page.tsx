'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

export default function NewProjectPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    planName: '',
    jobAddress: '',
    city: '',
    state: '',
    lotNumber: '',
    subdivision: '',
    sqFootage: '',
  })

  const updateForm = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError('')
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.name) {
      setError('Project name is required')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          planName: form.planName || undefined,
          jobAddress: form.jobAddress || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          lotNumber: form.lotNumber || undefined,
          subdivision: form.subdivision || undefined,
          sqFootage: form.sqFootage ? parseInt(form.sqFootage) : undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create project')

      router.push(`/projects/${data.project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-navy mb-1">
          New Project
        </h1>
        <p className="text-gray-500 mb-8">
          Set up your project details, then upload a blueprint for AI takeoff.
        </p>

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="card p-6 space-y-5">
          <div>
            <label className="label">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              className="input"
              placeholder="e.g., Smith Residence - Lot 42"
              value={form.name}
              onChange={(e) => updateForm('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Plan Name</label>
              <input
                className="input"
                placeholder="e.g., The Aspen"
                value={form.planName}
                onChange={(e) => updateForm('planName', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Sq. Footage</label>
              <input
                className="input"
                type="number"
                placeholder="2,200"
                value={form.sqFootage}
                onChange={(e) => updateForm('sqFootage', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Job Address</label>
            <input
              className="input"
              placeholder="123 Main St"
              value={form.jobAddress}
              onChange={(e) => updateForm('jobAddress', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">City</label>
              <input
                className="input"
                placeholder="City"
                value={form.city}
                onChange={(e) => updateForm('city', e.target.value)}
              />
            </div>
            <div>
              <label className="label">State</label>
              <input
                className="input"
                placeholder="AZ"
                value={form.state}
                onChange={(e) => updateForm('state', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Lot #</label>
              <input
                className="input"
                placeholder="42"
                value={form.lotNumber}
                onChange={(e) => updateForm('lotNumber', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Subdivision</label>
            <input
              className="input"
              placeholder="e.g., Desert Ridge Estates"
              value={form.subdivision}
              onChange={(e) => updateForm('subdivision', e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="btn-outline flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-accent flex-1 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
