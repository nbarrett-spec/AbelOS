'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ──────────────────────────────────────────────────────────────────
// DOCUMENT PANEL — Embeddable component for any detail page
// ──────────────────────────────────────────────────────────────────
// Usage:
//   <DocumentPanel orderId="abc123" />
//   <DocumentPanel builderId="xyz" jobId="j456" />
//   <DocumentPanel entityType="Vendor" entityId="v789" />
// ──────────────────────────────────────────────────────────────────

interface DocumentPanelProps {
  builderId?: string
  orderId?: string
  jobId?: string
  quoteId?: string
  invoiceId?: string
  dealId?: string
  vendorId?: string
  purchaseOrderId?: string
  doorIdentityId?: string
  entityType?: string
  entityId?: string
  defaultCategory?: string
  compact?: boolean  // minimal view for sidebars
  maxHeight?: string
}

interface PanelDoc {
  id: string
  fileName: string
  fileType: string
  mimeType: string
  fileSize: number
  category: string
  createdAt: string
  uploadedByName: string | null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getIcon(fileType: string, mime: string): string {
  if (mime.startsWith('image/')) return '🖼️'
  if (fileType === 'pdf') return '📕'
  if (['doc', 'docx'].includes(fileType)) return '📘'
  if (['xls', 'xlsx'].includes(fileType)) return '📗'
  return '📎'
}

const CATEGORIES = [
  'QUOTE', 'ORDER', 'INVOICE', 'PURCHASE_ORDER', 'CONTRACT',
  'BLUEPRINT', 'FLOOR_PLAN', 'SPEC_SHEET', 'PHOTO',
  'DELIVERY_PROOF', 'WARRANTY', 'SERVICE_REQUEST',
  'CORRESPONDENCE', 'REPORT', 'GENERAL',
]

export default function DocumentPanel(props: DocumentPanelProps) {
  const { compact = false, maxHeight = '400px', defaultCategory = 'GENERAL' } = props
  const [docs, setDocs] = useState<PanelDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadCat, setUploadCat] = useState(defaultCategory)
  const fileRef = useRef<HTMLInputElement>(null)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('limit', '100')
    if (props.builderId) p.set('builderId', props.builderId)
    if (props.orderId) p.set('orderId', props.orderId)
    if (props.jobId) p.set('jobId', props.jobId)
    if (props.quoteId) p.set('quoteId', props.quoteId)
    if (props.invoiceId) p.set('invoiceId', props.invoiceId)
    if (props.dealId) p.set('dealId', props.dealId)
    if (props.vendorId) p.set('vendorId', props.vendorId)
    if (props.entityType && props.entityId) {
      p.set('entityType', props.entityType)
      p.set('entityId', props.entityId)
    }
    return p.toString()
  }, [props])

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/documents/vault?${buildParams()}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setDocs(data.documents || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [buildParams])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const formData = new FormData()
      Array.from(files).forEach(f => formData.append('files', f))
      formData.append('category', uploadCat)

      // Pass all entity link props
      if (props.builderId) formData.append('builderId', props.builderId)
      if (props.orderId) formData.append('orderId', props.orderId)
      if (props.jobId) formData.append('jobId', props.jobId)
      if (props.quoteId) formData.append('quoteId', props.quoteId)
      if (props.invoiceId) formData.append('invoiceId', props.invoiceId)
      if (props.dealId) formData.append('dealId', props.dealId)
      if (props.vendorId) formData.append('vendorId', props.vendorId)
      if (props.purchaseOrderId) formData.append('purchaseOrderId', props.purchaseOrderId)
      if (props.doorIdentityId) formData.append('doorIdentityId', props.doorIdentityId)
      if (props.entityType) formData.append('entityType', props.entityType)
      if (props.entityId) formData.append('entityId', props.entityId)

      await fetch('/api/ops/documents/vault', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      setShowUpload(false)
      fetchDocs()
    } catch { /* ignore */ }
    setUploading(false)
  }

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-lg">📂</span>
          <span className="font-semibold text-gray-800 text-sm">Documents</span>
          {docs.length > 0 && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{docs.length}</span>
          )}
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="text-xs px-2.5 py-1 rounded-lg font-medium text-white"
          style={{ backgroundColor: '#C9822B' }}
        >
          + Upload
        </button>
      </div>

      {/* Quick upload bar */}
      {showUpload && (
        <div className="p-3 border-b bg-orange-50 space-y-2">
          <div className="flex gap-2">
            <select
              value={uploadCat}
              onChange={e => setUploadCat(e.target.value)}
              className="border rounded px-2 py-1 text-xs flex-shrink-0"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex-1 border-2 border-dashed rounded px-3 py-1 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition"
            >
              {uploading ? 'Uploading...' : 'Click to select files'}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.svg,.txt"
            onChange={e => handleUpload(e.target.files)}
          />
        </div>
      )}

      {/* Document list */}
      <div style={{ maxHeight, overflowY: 'auto' }}>
        {loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-gray-400 text-sm">No documents attached</div>
            <div className="text-gray-300 text-xs mt-1">Upload files to link them here</div>
          </div>
        ) : (
          <div className="divide-y">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition group">
                <span className="text-lg flex-shrink-0">{getIcon(doc.fileType, doc.mimeType)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{doc.fileName}</div>
                  <div className="text-xs text-gray-400">
                    {formatSize(doc.fileSize)} &middot; {new Date(doc.createdAt).toLocaleDateString()}
                    {!compact && doc.uploadedByName && ` &middot; ${doc.uploadedByName}`}
                  </div>
                </div>
                <a
                  href={`/api/ops/documents/vault/${doc.id}?mode=download`}
                  className="text-xs text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition font-medium"
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
