'use client'

import Image from 'next/image'
import { useEffect, useState, useRef } from 'react'
import { Map } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

interface FloorPlan {
  id: string
  projectId: string
  label: string
  fileName: string
  fileUrl: string
  fileSize: number
  fileType: string
  pageCount: number | null
  version: number
  notes: string | null
  uploadedById: string | null
  active: boolean
  createdAt: string
  updatedAt: string
  projectName: string
  projectAddress: string | null
  projectPlanName: string | null
  projectStatus: string
  builderName: string
  builderId: string
  uploadedByName: string | null
}

export default function FloorPlansPage() {
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadProjectId, setUploadProjectId] = useState('')
  const [uploadLabel, setUploadLabel] = useState('Floor Plan')
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Project search for upload
  const [projectSearch, setProjectSearch] = useState('')
  const [projectResults, setProjectResults] = useState<any[]>([])
  const [selectedProject, setSelectedProject] = useState<any>(null)
  const projectSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Edit modal state
  const [editPlan, setEditPlan] = useState<FloorPlan | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // View modal
  const [viewPlan, setViewPlan] = useState<FloorPlan | null>(null)

  const PAGE_SIZE = 25

  useEffect(() => {
    loadFloorPlans()
  }, [page, search])

  async function loadFloorPlans() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (search) params.set('search', search)
      const resp = await fetch(`/api/ops/floor-plans?${params}`)
      const data = await resp.json()
      setFloorPlans(data.floorPlans || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error('Failed to load floor plans:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput)
  }

  // Project search for upload modal
  useEffect(() => {
    if (!projectSearch || projectSearch.length < 2) {
      setProjectResults([])
      return
    }
    if (projectSearchTimeoutRef.current) clearTimeout(projectSearchTimeoutRef.current)
    projectSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/ops/floor-plans?search=${encodeURIComponent(projectSearch)}&limit=1`)
        // Actually we need a project search endpoint. Let's search projects via a simple approach
        const resp2 = await fetch(`/api/projects?search=${encodeURIComponent(projectSearch)}&limit=10`)
        if (resp2.ok) {
          const data = await resp2.json()
          setProjectResults(data.projects || [])
        }
      } catch (err) {
        console.error('Project search failed:', err)
      }
    }, 300)
  }, [projectSearch])

  async function handleUpload() {
    if (!uploadFile || !uploadProjectId) return
    setUploading(true)
    setUploadError('')
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('projectId', uploadProjectId)
      formData.append('label', uploadLabel)
      if (uploadNotes) formData.append('notes', uploadNotes)

      const resp = await fetch('/api/ops/floor-plans/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await resp.json()
      if (!resp.ok) {
        setUploadError(data.error || 'Upload failed')
        return
      }
      setUploadOpen(false)
      resetUploadForm()
      loadFloorPlans()
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function resetUploadForm() {
    setUploadProjectId('')
    setUploadLabel('Floor Plan')
    setUploadNotes('')
    setUploadFile(null)
    setUploadError('')
    setProjectSearch('')
    setProjectResults([])
    setSelectedProject(null)
  }

  async function handleEditSave() {
    if (!editPlan) return
    setEditSaving(true)
    try {
      const resp = await fetch(`/api/ops/floor-plans/${editPlan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel, notes: editNotes || null }),
      })
      if (resp.ok) {
        setEditPlan(null)
        loadFloorPlans()
      }
    } catch (err) {
      console.error('Edit failed:', err)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this floor plan? It will be soft-deleted.')) return
    try {
      await fetch(`/api/ops/floor-plans/${id}`, { method: 'DELETE' })
      loadFloorPlans()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function getFileIcon(fileType: string) {
    if (fileType.includes('pdf')) return '📄'
    if (fileType.includes('image')) return '🖼️'
    return '📎'
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Floor Plans"
        description="Upload, manage, and link floor plans to projects, takeoffs, and quotes"
        actions={
          <button
            onClick={() => { setUploadOpen(true); resetUploadForm() }}
            className="px-4 py-2.5 bg-[#0f2a3e] text-white text-sm rounded-lg hover:bg-[#0a1a28] font-medium"
          >
            + Upload Floor Plan
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Total Floor Plans</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{total}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Page Results</p>
          <p className="text-2xl font-bold text-[#0f2a3e] mt-1">{floorPlans.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Current Page</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{page} of {totalPages || 1}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase">Total Records</p>
          <p className="text-2xl font-bold text-[#C6A24E] mt-1">{total}</p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by label, filename, project, or builder..."
          className="flex-1 px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20 focus:border-[#0f2a3e]"
        />
        <button type="submit" className="px-6 py-2.5 bg-[#0f2a3e] text-white text-sm rounded-lg hover:bg-[#0a1a28]">
          Search
        </button>
      </form>

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          </div>
        ) : floorPlans.length === 0 ? (
          <EmptyState
            icon={<Map className="w-8 h-8 text-fg-subtle" />}
            title="No floor plans yet"
            description="Upload your first floor plan to get started."
          />
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Floor Plan</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Project</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Builder</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Version</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Uploaded</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {floorPlans.map((fp) => (
                  <tr key={fp.id} className="hover:bg-row-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getFileIcon(fp.fileType)}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{fp.label}</p>
                          <p className="text-xs text-gray-400">{fp.fileName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-900">{fp.projectName}</p>
                      {fp.projectAddress && (
                        <p className="text-xs text-gray-400">{fp.projectAddress}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700">{fp.builderName}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">v{fp.version}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs text-gray-500">{formatFileSize(fp.fileSize)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-500">{new Date(fp.createdAt).toLocaleDateString()}</p>
                      {fp.uploadedByName && (
                        <p className="text-xs text-gray-400">{fp.uploadedByName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewPlan(fp)}
                          className="text-xs text-[#0f2a3e] hover:text-[#C6A24E] px-2 py-1 rounded hover:bg-gray-100"
                        >
                          View
                        </button>
                        <button
                          onClick={() => {
                            setEditPlan(fp)
                            setEditLabel(fp.label)
                            setEditNotes(fp.notes || '')
                          }}
                          className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(fp.id)}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                <p className="text-xs text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 text-xs border rounded hover:bg-white disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 text-xs border rounded hover:bg-white disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ========== UPLOAD MODAL ========== */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b bg-[#0f2a3e]">
              <h2 className="text-lg font-semibold text-white">Upload Floor Plan</h2>
            </div>

            <div className="p-6 space-y-4">
              {uploadError && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{uploadError}</div>
              )}

              {/* Project selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project *</label>
                {selectedProject ? (
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{selectedProject.name}</p>
                      <p className="text-xs text-gray-500">{selectedProject.builderName || selectedProject.jobAddress || 'No address'}</p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedProject(null)
                        setUploadProjectId('')
                        setProjectSearch('')
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="Search projects by name or address..."
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                    />
                    {projectResults.length > 0 && (
                      <div className="mt-1 border rounded-lg max-h-40 overflow-y-auto">
                        {projectResults.map((p: any) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setSelectedProject(p)
                              setUploadProjectId(p.id)
                              setProjectResults([])
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b last:border-b-0"
                          >
                            <span className="font-medium">{p.name}</span>
                            {p.jobAddress && <span className="text-gray-400 ml-2">{p.jobAddress}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Manual ID entry fallback */}
                    <input
                      type="text"
                      value={uploadProjectId}
                      onChange={(e) => setUploadProjectId(e.target.value)}
                      placeholder="Or paste project ID directly..."
                      className="w-full mt-2 px-3 py-2 border rounded-lg text-xs text-gray-500 focus:ring-2 focus:ring-[#0f2a3e]/20"
                    />
                  </div>
                )}
              </div>

              {/* Label */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={uploadLabel}
                  onChange={(e) => setUploadLabel(e.target.value)}
                  placeholder="e.g. Main Floor, Second Floor, Basement..."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                />
              </div>

              {/* File picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File *</label>
                {uploadFile ? (
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getFileIcon(uploadFile.type)}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{uploadFile.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(uploadFile.size)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setUploadFile(null)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
                    <div className="text-center">
                      <p className="text-2xl mb-1">📄</p>
                      <p className="text-sm text-gray-500">Click to select a file</p>
                      <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPEG, TIFF, WebP (max 50MB)</p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) setUploadFile(f)
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  placeholder="Optional notes about this floor plan..."
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                />
              </div>
            </div>

            <div className="bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => { setUploadOpen(false); resetUploadForm() }}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !uploadFile || !uploadProjectId}
                className="px-4 py-2 text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload Floor Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== EDIT MODAL ========== */}
      {editPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">Edit Floor Plan</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                />
              </div>
            </div>
            <div className="bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setEditPlan(null)} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleEditSave} disabled={editSaving} className="px-4 py-2 text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] disabled:opacity-50">
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== VIEW MODAL ========== */}
      {viewPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-4xl mx-4 overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{viewPlan.label}</h2>
                <p className="text-xs text-gray-400">{viewPlan.fileName} &middot; {formatFileSize(viewPlan.fileSize)} &middot; v{viewPlan.version}</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/ops/floor-plans/serve/${viewPlan.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28]"
                >
                  Open Full Size
                </a>
                <button onClick={() => setViewPlan(null)} className="px-3 py-1.5 text-xs text-gray-600 border rounded-lg hover:bg-gray-50">
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-gray-100 p-4">
              {viewPlan.fileType.includes('pdf') ? (
                <iframe
                  src={`/api/ops/floor-plans/serve/${viewPlan.id}`}
                  className="w-full h-full min-h-[500px] rounded-lg border"
                  title={viewPlan.label}
                />
              ) : viewPlan.fileType.includes('image') ? (
                <div className="flex items-center justify-center">
                  <Image
                    src={`/api/ops/floor-plans/serve/${viewPlan.id}`}
                    alt={viewPlan.label}
                    width={800}
                    height={700}
                    className="max-w-full max-h-[70vh] rounded-lg shadow-lg"
                  />
                </div>
              ) : (
                <div className="text-center py-16 text-gray-400">
                  <p>Preview not available for this file type</p>
                  <a
                    href={`/api/ops/floor-plans/serve/${viewPlan.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0f2a3e] text-sm mt-2 inline-block"
                  >
                    Download file
                  </a>
                </div>
              )}
            </div>

            {/* Details panel */}
            <div className="px-6 py-3 border-t bg-gray-50 shrink-0">
              <div className="flex items-center gap-6 text-xs text-gray-500">
                <span>Project: <strong className="text-gray-700">{viewPlan.projectName}</strong></span>
                <span>Builder: <strong className="text-gray-700">{viewPlan.builderName}</strong></span>
                <span>Uploaded: {new Date(viewPlan.createdAt).toLocaleDateString()}</span>
                {viewPlan.uploadedByName && <span>By: {viewPlan.uploadedByName}</span>}
                {viewPlan.notes && <span>Notes: {viewPlan.notes}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
