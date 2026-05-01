'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Lock } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

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
        <div className="fixed inset-0 bg-signal-subtle border-4 border-dashed border-signal z-50 flex items-center justify-center pointer-events-none rounded-xl">
          <div className="bg-surface p-8 rounded-xl shadow-elevation-3 text-center">
            <div className="text-5xl mb-3">📂</div>
            <div className="text-xl font-semibold text-fg">Drop files to upload</div>
            <div className="text-fg-muted mt-1">PDF, images, documents up to 25MB</div>
          </div>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Document Vault"
        description="Central repository for all business documents"
        actions={
          <button
            onClick={() => setUploadModal(true)}
            className="px-5 py-2.5 text-fg-on-accent rounded-lg font-medium flex items-center gap-2 bg-signal hover:bg-signal-hover transition-colors"
          >
            <span className="text-lg">+</span> Upload Documents
          </button>
        }
      />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-semibold text-fg">{summary.activeDocuments}</div>
            <div className="text-sm text-fg-muted">Active Documents</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-semibold text-signal">{formatFileSize(summary.totalSizeBytes)}</div>
            <div className="text-sm text-fg-muted">Total Storage</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-semibold text-data-positive">{summary.ordersWithDocs}</div>
            <div className="text-sm text-fg-muted">Orders with Docs</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-semibold text-fg">{summary.buildersWithDocs}</div>
            <div className="text-sm text-fg-muted">Builders with Docs</div>
          </div>
        </div>
      )}

      {/* Category pills */}
      {byCategory.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => { setCategory(''); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${!category ? 'bg-fg text-canvas' : 'bg-surface-muted text-fg-muted hover:bg-row-hover'}`}
          >
            All ({total})
          </button>
          {byCategory.map(bc => {
            const info = getCategoryInfo(bc.category)
            return (
              <button
                key={bc.category}
                onClick={() => { setCategory(bc.category === category ? '' : bc.category); setPage(1) }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${category === bc.category ? 'text-white' : 'text-fg-muted hover:bg-row-hover'}`}
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
            className="w-full pl-10 pr-4 py-2.5 border border-border bg-surface text-fg rounded-lg focus:ring-2 focus:ring-signal focus:border-signal"
          />
          <span className="absolute left-3 top-3 text-fg-subtle">🔍</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => { setShowArchived(e.target.checked); setPage(1) }}
            className="rounded"
          />
          Show archived
        </label>
        {selected.size > 0 && (
          <button onClick={handleBulkArchive} className="px-3 py-2 bg-data-negative-bg text-data-negative-fg rounded-lg text-sm font-medium hover:bg-row-hover">
            Archive {selected.size} selected
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-data-negative-bg border border-border text-data-negative-fg rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-data-negative-fg hover:opacity-75">Dismiss</button>
        </div>
      )}

      {/* Document table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-fg-subtle">Loading documents...</div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<Lock className="w-10 h-10 text-fg-subtle" />}
            title="No documents yet"
            description="Upload files or drag and drop anywhere on this page"
            size="full"
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-surface-muted">
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
                <th className="p-3 font-semibold text-fg-muted">Document</th>
                <th className="p-3 font-semibold text-fg-muted">Category</th>
                <th className="p-3 font-semibold text-fg-muted">Linked To</th>
                <th className="p-3 font-semibold text-fg-muted">Size</th>
                <th className="p-3 font-semibold text-fg-muted">Uploaded</th>
                <th className="p-3 font-semibold text-fg-muted text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => {
                const catInfo = getCategoryInfo(doc.category)
                const links = entityLabels[doc.id] || []
                return (
                  <tr key={doc.id} className="border-b border-border hover:bg-row-hover transition">
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
                            className="font-medium text-fg hover:text-signal text-left"
                          >
                            {doc.fileName}
                          </button>
                          {doc.description && (
                            <div className="text-xs text-fg-subtle truncate max-w-[250px]">{doc.description}</div>
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
                          <span key={l} className="px-1.5 py-0.5 bg-surface-muted text-fg-muted rounded text-xs">{l}</span>
                        )) : <span className="text-fg-subtle text-xs">None</span>}
                      </div>
                    </td>
                    <td className="p-3 text-fg-muted">{formatFileSize(doc.fileSize)}</td>
                    <td className="p-3">
                      <div className="text-fg-muted text-xs">{formatDate(doc.createdAt)}</div>
                      {doc.uploadedByName && <div className="text-fg-subtle text-xs">{doc.uploadedByName}</div>}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <a
                          href={`/api/ops/documents/vault/${doc.id}?mode=download`}
                          className="px-2 py-1 bg-data-info-bg text-data-info-fg rounded text-xs font-medium hover:bg-row-hover"
                        >
                          Download
                        </a>
                        {doc.isArchived ? (
                          <button onClick={() => handleRestore(doc.id)} className="px-2 py-1 bg-data-positive-bg text-data-positive-fg rounded text-xs font-medium hover:bg-row-hover">
                            Restore
                          </button>
                        ) : (
                          <button onClick={() => handleArchive(doc.id)} className="px-2 py-1 bg-surface-muted text-fg-muted rounded text-xs font-medium hover:bg-row-hover">
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
          <div className="flex items-center justify-between p-4 border-t border-border bg-surface-muted">
            <div className="text-sm text-fg-muted">
              Showing {(page - 1) * 30 + 1}-{Math.min(page * 30, total)} of {total}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border border-border rounded text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border border-border rounded text-sm disabled:opacity-40"
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
          <div className="bg-surface rounded-2xl shadow-elevation-3 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-border">
              <h2 className="text-xl font-semibold text-fg">Upload Documents</h2>
              <p className="text-fg-muted text-sm mt-1">PDF, images, spreadsheets, documents up to 25MB each. Pick multiple at once, or click again to keep adding.</p>
            </div>
            <div className="p-6 space-y-4">
              {/* File picker — drag-drop + click + accumulating selection */}
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                  dragOver ? 'border-signal bg-signal-subtle' : 'border-border hover:border-signal'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  const dropped = Array.from(e.dataTransfer.files || [])
                  if (dropped.length > 0) {
                    setSelectedFiles(prev => [...prev, ...dropped])
                  }
                }}
              >
                {selectedFiles.length > 0 ? (
                  <div className="space-y-2 text-left" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-fg">
                        {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} staged
                        <span className="text-fg-muted font-normal ml-2">
                          ({formatFileSize(selectedFiles.reduce((s, f) => s + f.size, 0))})
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs text-c1 hover:text-c2 font-medium"
                        >
                          + Add more
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles([])}
                          className="text-xs text-red-600 hover:text-red-700 font-medium"
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                    <ul className="max-h-48 overflow-y-auto divide-y divide-border border border-border rounded-lg bg-surface-muted">
                      {selectedFiles.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <span className="text-base shrink-0">{getFileIcon(f.name.split('.').pop()?.toLowerCase() || '', f.type)}</span>
                          <span className="flex-1 truncate text-fg">{f.name}</span>
                          <span className="text-xs text-fg-subtle shrink-0">{formatFileSize(f.size)}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-xs text-red-500 hover:text-red-700 shrink-0"
                            aria-label={`Remove ${f.name}`}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-fg-subtle text-center pt-1">
                      Click anywhere above to add more files, or drag & drop.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="text-4xl mb-2">📁</div>
                    <div className="text-fg-muted">Click to select files or drag & drop</div>
                    <div className="text-xs text-fg-subtle mt-1">Hold Cmd/Ctrl to select multiple at once</div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.svg,.txt,.json,.xml"
                  className="hidden"
                  onChange={e => {
                    const picked = Array.from(e.target.files || [])
                    if (picked.length > 0) {
                      // Accumulate so re-opening the picker adds rather than replaces.
                      setSelectedFiles(prev => [...prev, ...picked])
                    }
                    // Reset so re-selecting the same file fires onChange again.
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Category</label>
                <select
                  value={uploadCategory}
                  onChange={e => setUploadCategory(e.target.value)}
                  className="w-full border border-border bg-surface text-fg rounded-lg p-2.5"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={uploadDescription}
                  onChange={e => setUploadDescription(e.target.value)}
                  placeholder="Brief description of these documents"
                  className="w-full border border-border bg-surface text-fg rounded-lg p-2.5"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Tags (comma-separated, optional)</label>
                <input
                  type="text"
                  value={uploadTags}
                  onChange={e => setUploadTags(e.target.value)}
                  placeholder="e.g. toll-brothers, phase-2, exterior"
                  className="w-full border border-border bg-surface text-fg rounded-lg p-2.5"
                />
              </div>

              {/* Entity linking */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-fg mb-1">Link to (type)</label>
                  <select
                    value={uploadEntityType}
                    onChange={e => setUploadEntityType(e.target.value)}
                    className="w-full border border-border bg-surface text-fg rounded-lg p-2.5"
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
                  <label className="block text-sm font-medium text-fg mb-1">Entity ID</label>
                  <input
                    type="text"
                    value={uploadEntityId}
                    onChange={e => setUploadEntityId(e.target.value)}
                    placeholder="ID of linked record"
                    className="w-full border border-border bg-surface text-fg rounded-lg p-2.5"
                    disabled={!uploadEntityType}
                  />
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-border flex justify-end gap-3">
              <button
                onClick={() => { setUploadModal(false); setSelectedFiles([]) }}
                disabled={uploading}
                className="px-4 py-2 border border-border rounded-lg text-fg-muted hover:bg-row-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || selectedFiles.length === 0}
                className="px-5 py-2 text-fg-on-accent rounded-lg font-medium disabled:opacity-50 bg-signal hover:bg-signal-hover transition-colors"
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
          <div className="bg-surface w-full max-w-md h-full overflow-y-auto shadow-elevation-3" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-border sticky top-0 bg-surface z-10">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-semibold text-fg">{detailDoc.fileName}</h2>
                  <div className="text-sm text-fg-muted mt-1">{formatFileSize(detailDoc.fileSize)} &middot; {detailDoc.fileType.toUpperCase()}</div>
                </div>
                <button onClick={() => setDetailDoc(null)} className="text-fg-subtle hover:text-fg text-2xl">&times;</button>
              </div>
            </div>
            <div className="p-6 space-y-5">
              {/* Preview for images */}
              {detailDoc.mimeType.startsWith('image/') && (
                <div className="border border-border rounded-lg overflow-hidden">
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
                  <div className="text-xs font-medium text-fg-muted uppercase">Category</div>
                  <div className="mt-0.5">
                    <span className="px-2 py-1 rounded-full text-xs font-medium text-white" style={{ backgroundColor: getCategoryInfo(detailDoc.category).color }}>
                      {getCategoryInfo(detailDoc.category).icon} {getCategoryInfo(detailDoc.category).label}
                    </span>
                  </div>
                </div>
                {detailDoc.description && (
                  <div>
                    <div className="text-xs font-medium text-fg-muted uppercase">Description</div>
                    <div className="mt-0.5 text-fg">{detailDoc.description}</div>
                  </div>
                )}
                {detailDoc.tags.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-fg-muted uppercase">Tags</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {detailDoc.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 bg-surface-muted text-fg-muted rounded-full text-xs">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-fg-muted uppercase">Uploaded</div>
                  <div className="mt-0.5 text-fg">
                    {formatDate(detailDoc.createdAt)}
                    {detailDoc.uploadedByName && <span className="text-fg-subtle"> by {detailDoc.uploadedByName}</span>}
                  </div>
                </div>

                {/* Entity links */}
                {(entityLabels[detailDoc.id] || []).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-fg-muted uppercase">Linked Records</div>
                    <div className="mt-1 space-y-1">
                      {detailDoc.builderId && <div className="text-sm text-signal">Builder: {detailDoc.builderId}</div>}
                      {detailDoc.orderId && <div className="text-sm text-signal">Order: {detailDoc.orderId}</div>}
                      {detailDoc.jobId && <div className="text-sm text-signal">Job: {detailDoc.jobId}</div>}
                      {detailDoc.quoteId && <div className="text-sm text-signal">Quote: {detailDoc.quoteId}</div>}
                      {detailDoc.invoiceId && <div className="text-sm text-signal">Invoice: {detailDoc.invoiceId}</div>}
                      {detailDoc.dealId && <div className="text-sm text-signal">Deal: {detailDoc.dealId}</div>}
                      {detailDoc.vendorId && <div className="text-sm text-signal">Vendor: {detailDoc.vendorId}</div>}
                    </div>
                  </div>
                )}

                {/* Storage info */}
                <div>
                  <div className="text-xs font-medium text-fg-muted uppercase">Storage</div>
                  <div className="mt-0.5 text-fg-muted text-sm">
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
                  className="flex-1 text-center px-4 py-2 text-fg-on-accent rounded-lg font-medium text-sm bg-signal hover:bg-signal-hover transition-colors"
                >
                  Download
                </a>
                <button
                  onClick={() => { handleArchive(detailDoc.id); setDetailDoc(null) }}
                  className="px-4 py-2 border border-border text-data-negative-fg rounded-lg text-sm hover:bg-data-negative-bg"
                >
                  Archive
                </button>
              </div>

              {/* Activity log */}
              {detailActivity.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-fg-muted uppercase mb-2">Activity</div>
                  <div className="space-y-2">
                    {detailActivity.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-2 text-xs">
                        <span className="text-fg-subtle whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</span>
                        <span className="font-medium text-fg-muted">{a.action}</span>
                        {a.staffName && <span className="text-fg-subtle">by {a.staffName}</span>}
                        {a.details && <span className="text-fg-subtle">&middot; {a.details}</span>}
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
