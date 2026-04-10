'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, MapPin, Users, Building2, Briefcase } from 'lucide-react'

interface Location {
  id: string; name: string; code: string; type: string; address: string;
  city: string; state: string; zip: string; phone: string;
  managerName: string; active: boolean; isPrimary: boolean; timezone: string;
  staffCount: number; activeJobs: number; createdAt: string;
}

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newLoc, setNewLoc] = useState({ name: '', code: '', type: 'WAREHOUSE', address: '', city: '', state: 'TX', zip: '', phone: '' })

  const fetchLocations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/locations')
      const data = await res.json()
      setLocations(data.locations || [])
    } catch (e) { console.error('Failed to fetch locations:', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchLocations() }, [fetchLocations])

  const createLocation = async () => {
    if (!newLoc.name || !newLoc.code) return
    try {
      const res = await fetch('/api/ops/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLoc),
      })
      if (res.ok) { setShowCreate(false); fetchLocations() }
    } catch (e) { console.error('Failed to create:', e) }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
          <p className="text-sm text-gray-500 mt-1">Manage warehouse and branch locations for multi-site operations</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#1B4F72] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#154360]">
          <Plus className="w-4 h-4" /> Add Location
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading locations...</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-16">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No locations configured. Run the platform upgrade migration to initialize.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {locations.map(loc => (
            <div key={loc.id} className={`bg-white border-2 rounded-xl p-5 ${loc.isPrimary ? 'border-[#E67E22]' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                    {loc.isPrimary && (
                      <span className="text-xs bg-[#E67E22]/10 text-[#E67E22] px-2 py-0.5 rounded-full font-medium">PRIMARY</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">Code: {loc.code} &bull; {loc.type}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${loc.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {loc.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {loc.address && (
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  {loc.address}, {loc.city}, {loc.state} {loc.zip}
                </div>
              )}

              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Users className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{loc.staffCount}</span> staff
                </div>
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Briefcase className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{loc.activeJobs}</span> active jobs
                </div>
                {loc.managerName && (
                  <div className="text-xs text-gray-500 ml-auto">
                    Mgr: {loc.managerName}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Location</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input type="text" placeholder="Abel Lumber — Fort Worth" value={newLoc.name}
                    onChange={e => setNewLoc(p => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                  <input type="text" placeholder="FTW" value={newLoc.code}
                    onChange={e => setNewLoc(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={newLoc.type} onChange={e => setNewLoc(p => ({ ...p, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="WAREHOUSE">Warehouse</option>
                  <option value="SHOWROOM">Showroom</option>
                  <option value="OFFICE">Office</option>
                  <option value="BRANCH">Branch</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input type="text" value={newLoc.address}
                  onChange={e => setNewLoc(p => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input type="text" value={newLoc.city}
                    onChange={e => setNewLoc(p => ({ ...p, city: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input type="text" value={newLoc.state}
                    onChange={e => setNewLoc(p => ({ ...p, state: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                  <input type="text" value={newLoc.zip}
                    onChange={e => setNewLoc(p => ({ ...p, zip: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={createLocation} disabled={!newLoc.name || !newLoc.code}
                className="px-4 py-2 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] disabled:opacity-50">
                Create Location
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
