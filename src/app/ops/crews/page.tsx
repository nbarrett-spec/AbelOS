'use client'

import { useEffect, useState } from 'react'
import { Hammer } from 'lucide-react'
import { CreateCrewModal } from '../components/CreateCrewModal'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'

interface StaffMember {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  department: string
  title: string | null
  active: boolean
}

interface CrewMember {
  id: string
  staffId: string
  role: string
  staff: StaffMember
}

interface Crew {
  id: string
  name: string
  crewType: 'DELIVERY' | 'INSTALLATION' | 'DELIVERY_AND_INSTALL'
  active: boolean
  vehicleId: string | null
  vehiclePlate: string | null
  members: CrewMember[]
  createdAt: string
  updatedAt: string
}

const CREW_TYPE_LABELS: Record<string, string> = {
  DELIVERY: 'Delivery',
  INSTALLATION: 'Installation',
  DELIVERY_AND_INSTALL: 'Delivery & Installation',
}

const CREW_TYPE_COLORS: Record<string, string> = {
  DELIVERY: 'bg-blue-100 text-blue-700',
  INSTALLATION: 'bg-amber-100 text-amber-700',
  DELIVERY_AND_INSTALL: 'bg-purple-100 text-purple-700',
}

const STATUS_COLORS: Record<string, string> = {
  true: 'bg-green-100 text-green-700',
  false: 'bg-red-100 text-red-700',
}

export default function CrewsPage() {
  const [crews, setCrews] = useState<Crew[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedCrew, setSelectedCrew] = useState<Crew | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  }

  useEffect(() => {
    fetchCrews()
  }, [])

  const fetchCrews = async () => {
    try {
      setLoading(true)
      const url = statusFilter === 'ALL'
        ? '/api/ops/crews'
        : `/api/ops/crews?active=${statusFilter === 'ACTIVE'}`

      const res = await fetch(url)
      const data = await res.json()
      setCrews(Array.isArray(data) ? data : data.crews || [])
    } catch (err) {
      console.error('Failed to load crews:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCrewCreated = () => {
    setIsCreateModalOpen(false)
    fetchCrews()
  }

  const filtered = crews.filter((c) => {
    if (search) {
      const s = search.toLowerCase()
      if (!c.name.toLowerCase().includes(s)) {
        const hasMatchingMember = c.members.some(
          (m) =>
            m.staff.firstName.toLowerCase().includes(s) ||
            m.staff.lastName.toLowerCase().includes(s) ||
            m.staff.email.toLowerCase().includes(s)
        )
        if (!hasMatchingMember) return false
      }
    }
    if (statusFilter !== 'ALL' && (c.active ? 'ACTIVE' : 'INACTIVE') !== statusFilter)
      return false
    if (typeFilter !== 'ALL' && c.crewType !== typeFilter) return false
    return true
  })

  const activeCount = crews.filter((c) => c.active).length
  const inactiveCount = crews.filter((c) => !c.active).length
  const totalMembers = crews.reduce((sum, c) => sum + c.members.length, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-signal" />
      </div>
    )
  }

  const handleCrewUpdate = async (id: string, data: any) => {
    try {
      const res = await fetch('/api/ops/crews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...data }),
      })
      if (res.ok) {
        showToast('Crew updated')
        fetchCrews()
        const updated = await res.json()
        setSelectedCrew(updated)
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to update crew', 'error')
      }
    } catch {
      showToast('Failed to update crew', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-surface'
        }`}>
          {toast}
        </div>
      )}
      <PageHeader
        title="Crew Management"
        description="Manage delivery and installation crews"
        crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Crews' }]}
        actions={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 bg-signal text-white rounded-lg hover:bg-signal-hover transition-colors font-medium"
          >
            + Create Crew
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Total Crews</p>
          <p className="text-2xl font-semibold text-gray-900 mt-2">{crews.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Active</p>
          <p className="text-2xl font-semibold text-green-600 mt-2">{activeCount}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Inactive</p>
          <p className="text-2xl font-semibold text-red-600 mt-2">{inactiveCount}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Total Members</p>
          <p className="text-2xl font-semibold text-[#1E3A5F] mt-2">{totalMembers}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border p-4 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-48">
            <input
              type="text"
              placeholder="Search crews by name or member..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
            />
          </div>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div className="flex gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold py-1.5">
              Status:
            </span>
            {['ALL', 'ACTIVE', 'INACTIVE'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  statusFilter === status
                    ? 'bg-signal text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold py-1.5">
              Type:
            </span>
            {['ALL', 'DELIVERY', 'INSTALLATION', 'DELIVERY_AND_INSTALL'].map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  typeFilter === type
                    ? 'bg-signal text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {type === 'ALL' ? 'All' : CREW_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Crews Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-white rounded-lg border">
            <EmptyState
              icon={<Hammer className="w-8 h-8 text-fg-subtle" />}
              title="No crews found"
              description="Create a delivery or installation crew to get started"
            />
          </div>
        ) : (
          filtered.map((crew) => (
            <div
              key={crew.id}
              className="bg-white rounded-lg border hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => {
                setSelectedCrew(crew)
                setShowDetailModal(true)
              }}
            >
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{crew.name}</h3>
                    <div className="flex gap-2 mt-2">
                      <span
                        className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${
                          CREW_TYPE_COLORS[crew.crewType]
                        }`}
                      >
                        {CREW_TYPE_LABELS[crew.crewType]}
                      </span>
                      <Badge variant={getStatusBadgeVariant(crew.active ? 'active' : 'inactive')}>
                        {crew.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Vehicle info if applicable */}
                {crew.vehiclePlate && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg border">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Vehicle</p>
                    <p className="text-sm font-mono text-gray-900 mt-1">{crew.vehiclePlate}</p>
                  </div>
                )}

                {/* Members */}
                <div>
                  <p className="text-xs text-gray-500 uppercase font-semibold mb-3">
                    Team Members ({crew.members.length})
                  </p>
                  {crew.members.length === 0 ? (
                    <p className="text-sm text-gray-500">No members assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {crew.members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {member.staff.firstName} {member.staff.lastName}
                            </p>
                            <p className="text-xs text-gray-500">
                              {member.staff.title || member.staff.role}
                            </p>
                          </div>
                          <span className="text-xs font-medium text-gray-600 ml-2 flex-shrink-0">
                            {member.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      {isCreateModalOpen && (
        <CreateCrewModal
          onClose={() => setIsCreateModalOpen(false)}
          onCrewCreated={handleCrewCreated}
        />
      )}

      {showDetailModal && selectedCrew && (
        <CrewDetailModal
          crew={selectedCrew}
          onClose={() => setShowDetailModal(false)}
          onUpdate={(data: any) => handleCrewUpdate(selectedCrew.id, data)}
        />
      )}
    </div>
  )
}

function CrewDetailModal({
  crew,
  onClose,
  onUpdate,
}: {
  crew: Crew
  onClose: () => void
  onUpdate: (data: any) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(crew.name)
  const [editType, setEditType] = useState(crew.crewType)
  const [editPlate, setEditPlate] = useState(crew.vehiclePlate || '')

  const handleSave = () => {
    onUpdate({
      name: editName,
      crewType: editType,
      vehiclePlate: editPlate || null,
    })
    setEditing(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{crew.name}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Crew Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-signal" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Type</label>
                <select value={editType} onChange={(e) => setEditType(e.target.value as any)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="DELIVERY">Delivery</option>
                  <option value="INSTALLATION">Installation</option>
                  <option value="DELIVERY_AND_INSTALL">Delivery &amp; Installation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-semibold mb-1">Vehicle Plate</label>
                <input value={editPlate} onChange={(e) => setEditPlate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="e.g., ABC-1234" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave}
                  className="px-4 py-2 text-sm font-medium bg-signal text-white rounded-lg hover:bg-signal-hover">
                  Save Changes
                </button>
                <button onClick={() => setEditing(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Type</p>
                <p className="text-sm mt-1">
                  <span className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${CREW_TYPE_COLORS[crew.crewType]}`}>
                    {CREW_TYPE_LABELS[crew.crewType]}
                  </span>
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Status</p>
                <p className="text-sm mt-1">
                  <Badge variant={getStatusBadgeVariant(crew.active ? 'active' : 'inactive')}>
                    {crew.active ? 'Active' : 'Inactive'}
                  </Badge>
                </p>
              </div>

              {crew.vehiclePlate && (
                <div>
                  <p className="text-xs text-gray-500 uppercase font-semibold">Vehicle Plate</p>
                  <p className="text-sm font-mono text-gray-900 mt-1">{crew.vehiclePlate}</p>
                </div>
              )}
            </>
          )}

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500 uppercase font-semibold">
                Team Members ({crew.members.length})
              </p>
            </div>
            {crew.members.length === 0 ? (
              <p className="text-sm text-gray-500">No members assigned</p>
            ) : (
              <div className="space-y-3">
                {crew.members.map((member) => (
                  <div key={member.id} className="p-3 bg-gray-50 rounded-lg border">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">
                          {member.staff.firstName} {member.staff.lastName}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{member.staff.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white bg-signal px-2.5 py-1 rounded flex-shrink-0">
                          {member.role}
                        </span>
                        <button
                          onClick={() => onUpdate({ removeMemberIds: [member.staffId] })}
                          className="text-red-400 hover:text-red-600 text-xs"
                          title="Remove member"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t text-xs text-gray-600">
                      <p><strong>Title:</strong> {member.staff.title || 'N/A'}</p>
                      <p><strong>Department:</strong> {member.staff.department}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4 text-xs text-gray-500">
            <p>Created: {new Date(crew.createdAt).toLocaleDateString()}</p>
            <p>Updated: {new Date(crew.updatedAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="border-t px-6 py-4 bg-gray-50 flex gap-2 justify-between">
          <div className="flex gap-2">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 text-sm font-medium text-[#1E3A5F] border border-[#1E3A5F] rounded-lg hover:bg-[#1E3A5F]/5 transition-colors"
              >
                Edit
              </button>
            )}
            <button
              onClick={() => onUpdate({ active: !crew.active })}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                crew.active
                  ? 'text-red-600 border border-red-300 hover:bg-red-50'
                  : 'text-green-600 border border-green-300 hover:bg-green-50'
              }`}
            >
              {crew.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
