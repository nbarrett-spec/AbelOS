'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface AccessEntry {
  id: string
  builderId: string
  projectId: string
  homeownerName: string
  homeownerEmail: string
  homeownerPhone: string | null
  accessToken: string
  active: boolean
  expiresAt: string | null
  lastVisitAt: string | null
  createdAt: string
  builderName: string
  projectName: string
  projectAddress: string | null
  selectionCount: number
  upgradeCount: number
}

interface Builder {
  id: string
  companyName: string
}

interface Project {
  id: string
  name: string
  builderId: string
}

export default function HomeownerAccessPage() {
  const [entries, setEntries] = useState<AccessEntry[]>([])
  const [builders, setBuilders] = useState<Builder[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    builderId: '',
    projectId: '',
    name: '',
    email: '',
    phone: '',
    expiresInDays: '90',
  })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [accessRes, builderRes] = await Promise.all([
        fetch('/api/ops/homeowner-access'),
        fetch('/api/ops/builders'),
      ])

      if (accessRes.ok) {
        const data = await accessRes.json()
        setEntries(data.accessEntries || [])
      }
      if (builderRes.ok) {
        const data = await builderRes.json()
        setBuilders(Array.isArray(data) ? data : data.builders || [])
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchProjects = async (builderId: string) => {
    try {
      const res = await fetch(`/api/projects?builderId=${builderId}`)
      if (res.ok) {
        const data = await res.json()
        setProjects(Array.isArray(data) ? data : data.projects || [])
      }
    } catch (err) {
      console.error('[Homeowner Access] Failed to load projects:', err)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/ops/homeowner-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderId: form.builderId,
          projectId: form.projectId,
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          expiresInDays: parseInt(form.expiresInDays) || 90,
        }),
      })

      if (res.ok) {
        const result = await res.json()
        setToast(`Access code created: ${result.accessToken}`)
        setShowCreateModal(false)
        setForm({ builderId: '', projectId: '', name: '', email: '', phone: '', expiresInDays: '90' })
        fetchData()
      } else {
        const err = await res.json()
        setToast(`Error: ${err.error}`)
      }
    } catch (err) {
      setToast('Failed to create access code')
    }
  }

  const toggleActive = async (id: string, currentActive: boolean) => {
    try {
      await fetch('/api/ops/homeowner-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !currentActive }),
      })
      fetchData()
    } catch (err) {
      console.error('[Homeowner Access] Failed to toggle access status:', err)
    }
  }

  const copyCode = (token: string, id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/homeowner/${token}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filtered = entries.filter(e => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      e.homeownerName?.toLowerCase().includes(s) ||
      e.homeownerEmail?.toLowerCase().includes(s) ||
      e.builderName?.toLowerCase().includes(s) ||
      e.projectName?.toLowerCase().includes(s) ||
      e.accessToken?.toLowerCase().includes(s)
    )
  })

  const activeCount = entries.filter(e => e.active).length
  const totalUpgrades = entries.reduce((sum, e) => sum + (e.upgradeCount || 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C6A24E]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white bg-[#0f2a3e]"
          onClick={() => setToast('')}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Homeowner Upgrade Portal</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate access codes for homeowners to view and select upgrades
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-5 py-2.5 bg-[#C6A24E] text-white rounded-lg hover:bg-[#D46D1A] transition-colors font-semibold text-sm"
        >
          + Generate Access Code
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-5">
          <p className="text-xs text-gray-500 uppercase font-semibold">Total Access Codes</p>
          <p className="text-3xl font-semibold text-[#0f2a3e] mt-2">{entries.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <p className="text-xs text-gray-500 uppercase font-semibold">Active Portals</p>
          <p className="text-3xl font-semibold text-green-600 mt-2">{activeCount}</p>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <p className="text-xs text-gray-500 uppercase font-semibold">Total Upgrades Selected</p>
          <p className="text-3xl font-semibold text-signal mt-2">{totalUpgrades}</p>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <p className="text-xs text-gray-500 uppercase font-semibold">Unique Builders</p>
          <p className="text-3xl font-semibold text-purple-600 mt-2">{new Set(entries.map(e => e.builderId)).size}</p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg border p-4">
        <input
          type="text"
          placeholder="Search by homeowner, builder, project, or access code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
        />
      </div>

      {/* Access Code Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-white rounded-lg border p-12 text-center">
            <p className="text-4xl mb-3">🏠</p>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No access codes yet</h3>
            <p className="text-sm text-gray-500 mb-4">Generate an access code to give homeowners access to their upgrade portal</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-[#C6A24E] text-white rounded-lg hover:bg-[#D46D1A] text-sm font-semibold"
            >
              + Generate First Access Code
            </button>
          </div>
        ) : (
          filtered.map(entry => (
            <div key={entry.id} className={`bg-white rounded-lg border p-5 hover:shadow-md transition-shadow ${!entry.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{entry.homeownerName}</h3>
                  <p className="text-xs text-gray-500">{entry.homeownerEmail}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                  entry.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {entry.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Builder & Project */}
              <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500 font-semibold">Builder</p>
                  <p className="text-gray-900 font-medium">{entry.builderName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-semibold">Project</p>
                  <p className="text-gray-900 font-medium">{entry.projectName || 'N/A'}</p>
                </div>
              </div>

              {/* Access Code */}
              <div className="bg-gray-50 rounded-lg p-3 mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 font-semibold">Access Code</p>
                  <p className="text-lg font-mono font-semibold text-[#0f2a3e]">{entry.accessToken}</p>
                </div>
                <button
                  onClick={() => copyCode(entry.accessToken, entry.id)}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors"
                >
                  {copiedId === entry.id ? '✓ Copied!' : 'Copy Link'}
                </button>
              </div>

              {/* Stats & Actions */}
              <div className="flex items-center justify-between">
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>{entry.selectionCount} selections</span>
                  <span className="text-[#C6A24E] font-semibold">{entry.upgradeCount} upgrades</span>
                  {entry.lastVisitAt && <span>Last visit: {new Date(entry.lastVisitAt).toLocaleDateString()}</span>}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/homeowner/${entry.accessToken}`}
                    target="_blank"
                    className="px-3 py-1 text-xs font-medium text-[#0f2a3e] border border-[#0f2a3e] rounded hover:bg-[#0f2a3e]/5 transition-colors"
                  >
                    Preview Portal
                  </Link>
                  <button
                    onClick={() => toggleActive(entry.id, entry.active)}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      entry.active
                        ? 'text-red-600 border border-red-300 hover:bg-red-50'
                        : 'text-green-600 border border-green-300 hover:bg-green-50'
                    }`}
                  >
                    {entry.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Generate Access Code</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Builder *</label>
                <select
                  value={form.builderId}
                  onChange={(e) => {
                    setForm({ ...form, builderId: e.target.value, projectId: '' })
                    if (e.target.value) fetchProjects(e.target.value)
                  }}
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
                >
                  <option value="">Select a builder...</option>
                  {builders.map(b => <option key={b.id} value={b.id}>{b.companyName}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Project *</label>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
                >
                  <option value="">Select a project...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Homeowner Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="John Smith"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    placeholder="john@email.com"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="(214) 555-1234"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Expires In (Days)</label>
                  <select
                    value={form.expiresInDays}
                    onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
                  >
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                    <option value="180">180 days</option>
                    <option value="365">1 year</option>
                  </select>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                <p className="font-semibold mb-1">Upgrade Categories Included:</p>
                <p>Interior Doors, Trim & Millwork, Hardware & Fixtures, plus any custom builder upgrade packages</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#C6A24E] text-white rounded-lg hover:bg-[#D46D1A] font-semibold text-sm transition-colors"
                >
                  Generate Access Code
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 text-gray-700 rounded-lg hover:bg-gray-100 font-medium text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
