'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ──────────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────────
interface VaultDocument {
  id: string
  fileName: string
  fileType: string
  mimeType: string
  fileSize: number
  category: string
  description: string | null
  tags: string[]
  storageType: string
  blobUrl: string | null
  entityType: string | null
  entityId: string | null
  builderId: string | null
  orderId: string | null
  jobId: string | null
  quoteId: string | null
  invoiceId: string | null
  dealId: string | null
  vendorId: string | null
  purchaseOrderId: string | null
  doorIdentityId: string | null
  uploadedBy: string
  uploadedByName: string | null
  isArchived: boolean
  version: number
  createdAt: string
  updatedAt: string
}

interface VaultSummary {
  totalDocuments: number
  activeDocuments: number
  archivedDocuments: number
  totalSizeBytes: number
  buildersWithDocs: number
  ordersWithDocs: number
  jobsWithDocs: number
  uniqueUploaders: number
}

interface CategoryCount {
  category: string
  count: number
  totalSize: number
}

const CATEGORIES = [
  { value: 'QUOTE', label: 'Quotes', icon: '📋', color: '#3498DB' },
  { value: 'ORDER', label: 'Orders', icon: '📦', color: '#C6A24E' },
  { value: 'INVOICE', label: 'Invoices', icon: '💰', color: '#27AE60' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Orders', icon: '🛒', color: '#8E44AD' },
  { value: 'CONTRACT', label: 'Contracts', icon: '📝', color: '#2C2C2C' },
  { value: 'BLUEPRINT', label: 'Blueprints', icon: '🏗️', color: '#1ABC9C' },
  { value: 'FLOOR_PLAN', label: 'Floor Plans', icon: '📐', color: '#16A085' },
  { value: 'SPEC_SHEET', label: 'Spec Sheets', icon: '📊', color: '#2980B9' },
  { value: 'PHOTO', label: 'Photos', icon: '📷', color: '#E74C3C' },
  { value: 'DELIVERY_PROOF', label: 'Delivery Proof', icon: '🚚', color: '#D4B96A' },
  { value: 'WARRANTY', label: 'Warranty', icon: '🛡️', color: '#0f2a3e' },
  { value: 'SERVICE_REQUEST', label: 'Service Requests', icon: '🔧', color: '#C0392B' },
  { value: 'CORRESPONDENCE', label: 'Correspondence', icon: '✉️', color: '#7F8C8D' },
  { value: 'REPORT', label: 'Reports', icon: '📈', color: '#404040' },
  { value: 'GENERAL', label: 'General', icon: '📄', color: '#95A5A6' },
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function getFileIcon(fileType: string, mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (fileType === 'pdf' || mimeType === 'application/pdf') return '📕'
  if (['doc', 'docx'].includes(fileType)) return '📘'
  if (['xls', 'xlsx'].includes(fileType)) return '📗'
  if (['ppt', 'pptx'].includes(fileType)) return '📙'
  if (fileType === 'csv') return '📊'
  if (mimeType.startsWith('text/')) return '📄'
  return '📎'
}

function getCategoryInfo(cat: string) {
  return CATEGORIES.find(c => c.value === cat) || CATEGORIES[CATEGORIES.length - 1]
}

// ──────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────────────────────
export default function DocumentVaultPage() {
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [summary, setSummary] = useState<VaultSummary | null>(null)
  const [byCategory, setByCategory] = useState<CategoryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadModal, setUploadModal] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('GENERAL')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadTags, setUploadTags] = useState('')
  const [uploadEntityType, setUploadEntityType] = useState('')
  const [uploadEntityId, setUploadEntityId] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)

  // Detail view
  const [detailDoc, setDetailDoc] = useState<VaultDocument | null>(null)
  const [detailActivity, setDetailActivity] = useState<any[]>([])

  // Selected for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ────── Fetch summary ──────
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/documents/vault?report=summary', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setByCategory(data.byCategory || [])
      }
    } catch { /* ignore */ }
  }, [])

  // ────── Fetch documents ──────
  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (category) params.set('category', category)
      if (showArchived) params.set('archived', 'true')
      params.set('page', page.toString())
      params.set('limit', '30')

      const res = await fetch(`/api/ops/documents/vault?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load documents')
      const data = await res.json()
      setDocuments(data.documents || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [search, category, showArchived, page])

  useEffect(() => { fetchSummary() }, [fetchSummary])
  useEffect(() => { fetchDocs() }, [fetchDocs])

  // ────── Upload handler ──────
  const handleUpload = async () => {
    if (selectedFiles.length === 0) return
    setUploading(true)
    try {
      const formData = new FormData()
      selectedFiles.forEach(f => formData.append('files', f))
      formData.append('category', uploadCategory)
      if (uploadDescription) formData.append('description', uploadDescription)
      if (uploadTags) formData.append('tags', uploadTags)
      if (uploadEntityType) formData.append('entityType', uploadEntityType)
      if (uploadEntityId) formData.append('entityId', uploadEntityId)

      const res = await fetch('/api/ops/documents/vault', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setUploadModal(false)
      setSelectedFiles([])
      setUploadDescription('')
      setUploadTags('')
      setUploadEntityType('')
      setUploadEntityId('')
      fetchDocs()
      fetchSummary()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // ────── Archive handler ──────
  const handleArchive = async (docId: string) => {
    await fetch('/api/ops/documents/vault', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', documentId: docId }),
    })
    fetchDocs()
    fetchSummary()
  }

  const handleRestore = async (docId: string) => {
    await fetch('/api/ops/documents/vault', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', documentId: docId }),
    })
    fetchDocs()
    fetchSummary()
  }

  // ────── Bulk archive ──────
  const handleBulkArchive = async () => {
    if (selected.size === 0) return
    await fetch('/api/ops/documents/vault', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bulk_archive', documentIds: Array.from(selected) }),
    })
    setSelected(new Set())
    fetchDocs()
    fetchSummary()
  }

  // ────── Detail view ──────
  const openDetail = async (doc: VaultDocument) => {
    setDetailDoc(doc)
    try {
      const res = await fetch(`/api/ops/documents/vault/${doc.id}?mode=activity`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setDetailActivity(data.activities || [])
      }
    } catch { /* ignore */ }
  }

  // ────── Drag & drop ──────
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      setSelectedFiles(files)
      setUploadModal(true)
    }
  }

  // ────── Toggle selection ──────
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const entityLabels: Record<string, string[]> = {}
  documents.forEach(d => {
    const links: string[] = []
    if (d.builderId) links.push('Builder')
    if (d.orderId) links.push('Order')
    if (d.jobId) links.push('Job')
    if (d.quoteId) links.push('Quote')
    if (d.invoiceId) links.push('Invoice')
    if (d.dealId) links.push('Deal')
    if (d.vendorId) links.push('Vendor')
    if (d.purchaseOrderId) links.push('PO')
    if (d.doorIdentityId) links.push('Door')
    entityLabels[d.id] = links
  })

  return (
    <div
      className="p-6 max-w-[1400px] mx-auto"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 bg-blue-500/20 border-4 border-dashed border-blue-500 z-50 flex items-center justify-center pointer-events-none rounded-xl">
          <div className="bg-white p-8 rounded-xl shadow-2xl text-center">
            <div className="text-5xl mb-3">📂</div>
            <div className="text-xl font-bold text-gray-800">Drop files to upload</div>
            <div className="text-gray-500 mt-1">PDF, images, documents up to 25MB</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Vault</h1>
          <p className="text-gray-500 mt-1">Central repository for all business documents</p>
        </div>
        <button
          onClick={() => setUploadModal(true)}
          className="px-5 py-2.5 text-white rounded-lg font-medium flex items-center gap-2"
          style={{ backgroundColor: '#C6A24E' }}
        >
          <span className="text-lg">+</span> Upload Documents
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border rounded-xl p-4">
            <div className="text-2xl font-bold" style={{ color: '#0f2a3e' }}>{summary.activeDocuments}</div>
            <div className="text-sm text-gray-500">Active Documents</div>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <div className="text-2xl font-bold" style={{ color: '#C6A24E' }}>{formatFileSize(summary.totalSizeBytes)}</div>
            <div className="text-sm text-gray-500">Total Storage</div>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <div className="text-2xl font-bold" style={{ color: '#27AE60' }}>{summary.ordersWithDocs}</div>
            <div className="text-sm text-gray-500">Orders with Docs</div>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <div className="text-2xl font-bold" style={{ color: '#8E44AD' }}>{summary.buildersWithDocs}</div>
            <div className="text-sm text-gray-500">Builders with Docs</div>
          </div>
        </div>
      )}

      {/* Category pills */}
      {byCategory.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => { setCategory(''); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${!category ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All ({total})
          </button>
          {byCategory.map(bc => {
            const info = getCategoryInfo(bc.category)
            return (
              <button
                key={bc.category}
                onClick={() => { setCategory(bc.category === category ? '' : bc.category); setPage(1) }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${category === bc.category ? 'text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                style={category === bc.category ? { backgroundColor: info.color } : {}}
              >
                {info.icon} {info.label} ({bc.count})
              </button>
            )
          })}
        </div>
      )}

      {/* Search & filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search documents by name, description, or tag..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-10 pr-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <span className="absolute left-3 top-3 text-gray-400">🔍</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => { setShowArchived(e.target.checked); setPage(1) }}
            className="rounded"
          />
          Show archived
        </label>
        {selected.size > 0 && (
          <button onClick={handleBulkArchive} className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100">
            Archive {selected.size} selected
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-700">Dismiss</button>
        </div>
      )}

      {/* Document table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-5xl mb-3">📂</div>
            <div className="text-gray-500 font-medium">No documents yet</div>
            <div className="text-gray-400 text-sm mt-1">Upload files or drag and drop anywhere on this page</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ backgroundColor: '#F8FAFC' }}>
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === documents.length && documents.length > 0}
                    onChange={() => {
                      if (selected.size === documents.length) setSelected(new Set())
                      else setSelected(new Set(documents.map(d => d.id)))
                    }}
                    className="rounded"
                  />
                </th>
                <th className="p-3 font-semibold text-gray-600">Document</th>
                <th className="p-3 font-semibold text-gray-600">Category</th>
                <th className="p-3 font-semibold text-gray-600">Linked To</th>
                <th className="p-3 font-semibold text-gray-600">Size</th>
                <th className="p-3 font-semibold text-gray-600">Uploaded</th>
                <th className="p-3 font-semibold text-gray-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => {
                const catInfo = getCategoryInfo(doc.category)
                const links = entityLabels[doc.id] || []
                return (
                  <tr key={doc.id} className="border-b hover:bg-gray-50 transition">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getFileIcon(doc.fileType, doc.mimeType)}</span>
                        <div>
                          <button
                            onClick={() => openDetail(doc)}
                            className="font-medium text-gray-900 hover:text-blue-600 text-left"
                          >
                            {doc.fileName}
                          </button>
                          {doc.description && (
                            <div className="text-xs text-gray-400 truncate max-w-[250px]">{doc.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className="px-2 py-1 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: catInfo.color }}
                      >
                        {catInfo.icon} {catInfo.label}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {links.length > 0 ? links.map(l => (
                          <span key={l} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{l}</span>
                        )) : <span className="text-gray-300 text-xs">None</span>}
                      </div>
                    </td>
                    <td className="p-3 text-gray-500">{formatFileSize(doc.fileSize)}</td>
                    <td className="p-3">
                      <div className="text-gray-600 text-xs">{formatDate(doc.createdAt)}</div>
                      {doc.uploadedByName && <div className="text-gray-400 text-xs">{doc.uploadedByName}</div>}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <a
                          href={`/api/ops/documents/vault/${doc.id}?mode=download`}
                          className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-medium hover:bg-blue-100"
                        >
                          Download
                        </a>
                        {doc.isArchived ? (
                          <button onClick={() => handleRestore(doc.id)} className="px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-medium hover:bg-green-100">
                            Restore
                          </button>
                        ) : (
                          <button onClick={() => handleArchive(doc.id)} className="px-2 py-1 bg-gray-50 text-gray-500 rounded text-xs font-medium hover:bg-gray-100">
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t bg-gray-50">
            <div className="text-sm text-gray-500">
              Showing {(page - 1) * 30 + 1}-{Math.min(page * 30, total)} of {total}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ──────── UPLOAD MODAL ──────── */}
      {uploadModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !uploading && setUploadModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Upload Documents</h2>
              <p className="text-gray-500 text-sm mt-1">PDF, images, spreadsheets, documents up to 25MB each</p>
            </div>
            <div className="p-6 space-y-4">
              {/* File picker */}
              <div
                className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                {selectedFiles.length > 0 ? (
                  <div>
                    <div className="text-lg font-medium text-gray-800">{selectedFiles.length} file(s) selected</div>
                    <div className="text-sm text-gray-500 mt-1">
                      {selectedFiles.map(f => f.name).join(', ')}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Total: {formatFileSize(selectedFiles.reduce((s, f) => s + f.size, 0))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-4xl mb-2">📁</div>
                    <div className="text-gray-500">Click to select files or drag & drop</div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.svg,.txt,.json,.xml"
                  className="hidden"
                  onChange={e => setSelectedFiles(Array.from(e.target.files || []))}
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={uploadCategory}
                  onChange={e => setUploadCategory(e.target.value)}
                  className="w-full border rounded-lg p-2.5"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={uploadDescription}
                  onChange={e => setUploadDescription(e.target.value)}
                  placeholder="Brief description of these documents"
                  className="w-full border rounded-lg p-2.5"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated, optional)</label>
                <input
                  type="text"
                  value={uploadTags}
                  onChange={e => setUploadTags(e.target.value)}
                  placeholder="e.g. toll-brothers, phase-2, exterior"
                  className="w-full border rounded-lg p-2.5"
                />
              </div>

              {/* Entity linking */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Link to (type)</label>
                  <select
                    value={uploadEntityType}
                    onChange={e => setUploadEntityType(e.target.value)}
                    className="w-full border rounded-lg p-2.5"
                  >
                    <option value="">None</option>
                    <option value="Builder">Builder</option>
                    <option value="Order">Order</option>
                    <option value="Job">Job</option>
                    <option value="Quote">Quote</option>
                    <option value="Invoice">Invoice</option>
                    <option value="Deal">Deal</option>
                    <option value="Vendor">Vendor</option>
                    <option value="PurchaseOrder">Purchase Order</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Entity ID</label>
                  <input
                    type="text"
                    value={uploadEntityId}
                    onChange={e => setUploadEntityId(e.target.value)}
                    placeholder="ID of linked record"
                    className="w-full border rounded-lg p-2.5"
                    disabled={!uploadEntityType}
                  />
                </div>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => { setUploadModal(false); setSelectedFiles([]) }}
                disabled={uploading}
                className="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || selectedFiles.length === 0}
                className="px-5 py-2 text-white rounded-lg font-medium disabled:opacity-50"
                style={{ backgroundColor: '#0f2a3e' }}
              >
                {uploading ? 'Uploading...' : `Upload ${selectedFiles.length} file(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────── DETAIL DRAWER ──────── */}
      {detailDoc && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDetailDoc(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b sticky top-0 bg-white z-10">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{detailDoc.fileName}</h2>
                  <div className="text-sm text-gray-500 mt-1">{formatFileSize(detailDoc.fileSize)} &middot; {detailDoc.fileType.toUpperCase()}</div>
                </div>
                <button onClick={() => setDetailDoc(null)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
              </div>
            </div>
            <div className="p-6 space-y-5">
              {/* Preview for images */}
              {detailDoc.mimeType.startsWith('image/') && (
                <div className="border rounded-lg overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/ops/documents/vault/${detailDoc.id}?mode=download`}
                    alt={detailDoc.fileName}
                    loading="lazy"
                    decoding="async"
                    className="w-full"
                  />
                </div>
              )}

              {/* Metadata */}
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase">Category</div>
                  <div className="mt-0.5">
                    <span className="px-2 py-1 rounded-full text-xs font-medium text-white" style={{ backgroundColor: getCategoryInfo(detailDoc.category).color }}>
                      {getCategoryInfo(detailDoc.category).icon} {getCategoryInfo(detailDoc.category).label}
                    </span>
                  </div>
                </div>
                {detailDoc.description && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase">Description</div>
                    <div className="mt-0.5 text-gray-700">{detailDoc.description}</div>
                  </div>
                )}
                {detailDoc.tags.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase">Tags</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {detailDoc.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase">Uploaded</div>
                  <div className="mt-0.5 text-gray-700">
                    {formatDate(detailDoc.createdAt)}
                    {detailDoc.uploadedByName && <span className="text-gray-400"> by {detailDoc.uploadedByName}</span>}
                  </div>
                </div>

                {/* Entity links */}
                {(entityLabels[detailDoc.id] || []).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase">Linked Records</div>
                    <div className="mt-1 space-y-1">
                      {detailDoc.builderId && <div className="text-sm text-blue-600">Builder: {detailDoc.builderId}</div>}
                      {detailDoc.orderId && <div className="text-sm text-blue-600">Order: {detailDoc.orderId}</div>}
                      {detailDoc.jobId && <div className="text-sm text-blue-600">Job: {detailDoc.jobId}</div>}
                      {detailDoc.quoteId && <div className="text-sm text-blue-600">Quote: {detailDoc.quoteId}</div>}
                      {detailDoc.invoiceId && <div className="text-sm text-blue-600">Invoice: {detailDoc.invoiceId}</div>}
                      {detailDoc.dealId && <div className="text-sm text-blue-600">Deal: {detailDoc.dealId}</div>}
                      {detailDoc.vendorId && <div className="text-sm text-blue-600">Vendor: {detailDoc.vendorId}</div>}
                    </div>
                  </div>
                )}

                {/* Storage info */}
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase">Storage</div>
                  <div className="mt-0.5 text-gray-500 text-sm">
                    {detailDoc.storageType === 'DATABASE' && 'PostgreSQL (embedded)'}
                    {detailDoc.storageType === 'VERCEL_BLOB' && 'Vercel Blob (cloud)'}
                    {detailDoc.storageType === 'EXTERNAL' && 'External URL'}
                    {detailDoc.version > 1 && ` · Version ${detailDoc.version}`}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <a
                  href={`/api/ops/documents/vault/${detailDoc.id}?mode=download`}
                  className="flex-1 text-center px-4 py-2 text-white rounded-lg font-medium text-sm"
                  style={{ backgroundColor: '#0f2a3e' }}
                >
                  Download
                </a>
                <button
                  onClick={() => { handleArchive(detailDoc.id); setDetailDoc(null) }}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
                >
                  Archive
                </button>
              </div>

              {/* Activity log */}
              {detailActivity.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-2">Activity</div>
                  <div className="space-y-2">
                    {detailActivity.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-2 text-xs">
                        <span className="text-gray-400 whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</span>
                        <span className="font-medium text-gray-600">{a.action}</span>
                        {a.staffName && <span className="text-gray-400">by {a.staffName}</span>}
                        {a.details && <span className="text-gray-400">&middot; {a.details}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
