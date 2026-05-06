'use client'

/**
 * <DocumentAttachments> — reusable drop-zone + file list for any entity that
 * has a dedicated FK column on DocumentVault.
 *
 * Per FIX-1 in AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). Backed by the
 * existing /api/ops/documents/vault routes:
 *   GET    ?<entityField>=<id>      list documents linked to that entity
 *   POST   multipart/form-data       upload one or more files (DB storage)
 *   GET    /[id]?mode=download       stream/redirect to file
 *   DELETE /[id]                     hard-delete a document + activity rows
 *
 * Drop this component into any /ops/<entity>/[id] detail page:
 *
 *   <DocumentAttachments
 *     entityType="invoice"
 *     entityId={invoice.id}
 *     defaultCategory="INVOICE"
 *     allowedCategories={['INVOICE','CORRESPONDENCE','REPORT','GENERAL']}
 *   />
 *
 * Notes
 *   - Auth flows via the staff session cookie + middleware. No client-supplied
 *     identity headers (settings page taught us that lesson — FIX-6).
 *   - Per-file upload happens client-side in series so a single bad file
 *     surfaces a per-row error instead of failing the whole batch.
 *   - 25MB / file is the server's hard cap; we surface the same number to
 *     the user before sending so they don't waste bandwidth on a doomed
 *     upload.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Upload,
  FileText,
  Trash2,
  Download,
  Paperclip,
  AlertTriangle,
  Loader2,
  Eye,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  X,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────
// Type model — mirror the DocumentVault row shape we actually need
// ─────────────────────────────────────────────────────────────────────
type EntityType =
  | 'order'
  | 'job'
  | 'quote'
  | 'invoice'
  | 'builder'
  | 'vendor'
  | 'purchaseOrder'
  | 'deal'
  | 'journalEntry'
  | 'contract'
  | 'community'

// Each mapping is either a dedicated FK column on DocumentVault, or — for
// entities without a column — `null`, which falls back to the generic
// (entityType, entityId) string-pair columns the vault also supports.
const ENTITY_FIELD: Record<EntityType, string | null> = {
  order: 'orderId',
  job: 'jobId',
  quote: 'quoteId',
  invoice: 'invoiceId',
  builder: 'builderId',
  vendor: 'vendorId',
  purchaseOrder: 'purchaseOrderId',
  deal: 'dealId',
  journalEntry: 'journalEntryId',
  // No FK column for Contract — use the generic entityType/entityId pair.
  contract: null,
  // No FK column for Community — use the generic entityType/entityId pair.
  community: null,
}

// All categories the API accepts. Pages typically pass a narrower
// allowedCategories[] to keep the dropdown focused.
export const ALL_CATEGORIES = [
  'QUOTE',
  'ORDER',
  'INVOICE',
  'PURCHASE_ORDER',
  'CONTRACT',
  'BLUEPRINT',
  'FLOOR_PLAN',
  'SPEC_SHEET',
  'PHOTO',
  'DELIVERY_PROOF',
  'WARRANTY',
  'SERVICE_REQUEST',
  'CORRESPONDENCE',
  'REPORT',
  'GENERAL',
] as const

interface VaultDocument {
  id: string
  fileName: string
  fileType: string
  mimeType: string
  fileSize: number
  category: string
  description: string | null
  uploadedByName: string | null
  createdAt: string
}

interface UploadProgress {
  /** Stable client-side key — File doesn't survive React reconciliation */
  key: string
  fileName: string
  fileSize: number
  status: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
  category: string
}

export interface DocumentAttachmentsProps {
  entityType: EntityType
  entityId: string
  /** Category preselected when files are dropped/picked */
  defaultCategory?: string
  /** Narrow the per-file category dropdown to a sensible subset */
  allowedCategories?: readonly string[]
  /** Soft cap on # of files in a single drop. Default 10. */
  maxFiles?: number
  /** Soft cap on file size in MB. Server enforces 25; we surface earlier. */
  maxSizeMB?: number
  /** Called after a successful upload — useful for parent re-renders */
  onChange?: () => void
  /** Optional title override; defaults to "Documents" */
  title?: string
  className?: string
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Relative timestamp like "2h ago" — keeps the row dense.
function formatRelative(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return formatDate(iso)
}

// What the row icon should be.
function fileKind(
  mimeType: string,
  fileType: string,
): 'image' | 'pdf' | 'word' | 'excel' | 'other' {
  const m = (mimeType || '').toLowerCase()
  const ext = (fileType || '').toLowerCase().replace(/^\./, '')
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return 'image'
  }
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    m.includes('word') ||
    m.includes('officedocument.wordprocessingml') ||
    ext === 'doc' ||
    ext === 'docx'
  ) {
    return 'word'
  }
  if (
    m.includes('sheet') ||
    m.includes('excel') ||
    m.includes('officedocument.spreadsheetml') ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv'
  ) {
    return 'excel'
  }
  return 'other'
}

function fileIcon(kind: ReturnType<typeof fileKind>) {
  switch (kind) {
    case 'image':
      return ImageIcon
    case 'excel':
      return FileSpreadsheet
    case 'pdf':
    case 'word':
      return FileText
    default:
      return FileIcon
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case 'INVOICE':
    case 'PURCHASE_ORDER':
    case 'ORDER':
      return 'bg-data-positive-bg text-data-positive'
    case 'CONTRACT':
    case 'WARRANTY':
      return 'bg-data-warning-bg text-data-warning'
    case 'BLUEPRINT':
    case 'FLOOR_PLAN':
    case 'SPEC_SHEET':
      return 'bg-brand-bg text-brand'
    case 'PHOTO':
    case 'DELIVERY_PROOF':
      return 'bg-surface-elevated text-fg'
    default:
      return 'bg-surface-muted text-fg-muted'
  }
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────
export default function DocumentAttachments({
  entityType,
  entityId,
  defaultCategory = 'GENERAL',
  allowedCategories,
  maxFiles = 10,
  maxSizeMB = 25,
  onChange,
  title = 'Documents',
  className,
}: DocumentAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [docs, setDocs] = useState<VaultDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadProgress[]>([])
  const [dragOver, setDragOver] = useState(false)
  // Preview modal — set to a doc to open the inline lightbox / iframe.
  const [previewDoc, setPreviewDoc] = useState<VaultDocument | null>(null)
  // Per-doc category override (drives the row dropdown for in-place edits).
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)

  const entityField = ENTITY_FIELD[entityType]
  const categories = allowedCategories ?? ALL_CATEGORIES
  const maxBytes = maxSizeMB * 1024 * 1024

  // ── Load existing documents ────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Two query shapes:
      //   1. dedicated FK column (e.g. invoiceId=…)
      //   2. generic entity pair (entityType=contract&entityId=…) for entities
      //      that don't have a dedicated column on DocumentVault
      const queryString = entityField
        ? `${entityField}=${encodeURIComponent(entityId)}`
        : `entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
      const res = await fetch(
        `/api/ops/documents/vault?${queryString}&limit=100`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDocs(data.documents || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [entityField, entityType, entityId])

  useEffect(() => {
    if (entityId) reload()
  }, [reload, entityId])

  // ── Upload pipeline ────────────────────────────────────────────────
  const startUploads = useCallback(
    async (files: File[]) => {
      // Trim to maxFiles
      const trimmed = files.slice(0, maxFiles)
      if (files.length > maxFiles) {
        setError(`Only the first ${maxFiles} files were queued (drop fewer next time).`)
      } else {
        setError(null)
      }

      // Size + MIME pre-check; reject early so user sees per-file errors
      const queued: UploadProgress[] = trimmed.map((f, i) => ({
        key: `${Date.now()}-${i}-${f.name}`,
        fileName: f.name,
        fileSize: f.size,
        status: 'pending',
        category: defaultCategory,
      }))
      setUploads((prev) => [...prev, ...queued])

      // Process serially so we get clean per-file feedback
      for (let i = 0; i < trimmed.length; i++) {
        const f = trimmed[i]
        const key = queued[i].key

        if (f.size > maxBytes) {
          setUploads((prev) =>
            prev.map((u) =>
              u.key === key
                ? {
                    ...u,
                    status: 'error',
                    error: `File exceeds ${maxSizeMB}MB limit (${formatBytes(f.size)})`,
                  }
                : u,
            ),
          )
          continue
        }

        setUploads((prev) =>
          prev.map((u) => (u.key === key ? { ...u, status: 'uploading' } : u)),
        )

        try {
          const fd = new FormData()
          fd.append('files', f)
          fd.append('category', queued[i].category)
          if (entityField) {
            fd.append(entityField, entityId)
          } else {
            // Generic entityType/entityId pair (e.g. contract)
            fd.append('entityType', entityType)
            fd.append('entityId', entityId)
          }

          const res = await fetch('/api/ops/documents/vault', { method: 'POST', body: fd })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || `HTTP ${res.status}`)
          }
          const data = await res.json()
          if (data.errors?.length) {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === key ? { ...u, status: 'error', error: data.errors[0] } : u,
              ),
            )
          } else {
            setUploads((prev) =>
              prev.map((u) => (u.key === key ? { ...u, status: 'success' } : u)),
            )
          }
        } catch (e: any) {
          setUploads((prev) =>
            prev.map((u) =>
              u.key === key
                ? { ...u, status: 'error', error: e?.message || 'Upload failed' }
                : u,
            ),
          )
        }
      }

      await reload()
      onChange?.()

      // Auto-clear successful uploads after 3s; keep errors visible
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.status !== 'success'))
      }, 3000)
    },
    [defaultCategory, entityField, entityType, entityId, maxBytes, maxFiles, maxSizeMB, onChange, reload],
  )

  // Per-pending-upload category override (set BEFORE the upload starts —
  // since we kick uploads off immediately on drop, this only really matters
  // for items still in 'pending' state).
  const updatePendingCategory = (key: string, cat: string) => {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, category: cat } : u)))
  }

  // ── Drag/drop handlers ─────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }
  const onDragLeave = () => setDragOver(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) startUploads(files)
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length) startUploads(files)
    // reset so picking the same file again still fires onChange
    e.target.value = ''
  }

  // ── Delete one ─────────────────────────────────────────────────────
  const handleDelete = async (doc: VaultDocument) => {
    if (!confirm(`Delete ${doc.fileName}? This is permanent.`)) return
    try {
      const res = await fetch(`/api/ops/documents/vault/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      await reload()
      onChange?.()
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    }
  }

  // ── Update category (in-place edit) ────────────────────────────────
  const handleUpdateCategory = async (doc: VaultDocument, category: string) => {
    if (category === doc.category) {
      setEditingCategoryId(null)
      return
    }
    try {
      const res = await fetch('/api/ops/documents/vault', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id, category }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      await reload()
      onChange?.()
    } catch (e: any) {
      setError(e?.message || 'Update failed')
    } finally {
      setEditingCategoryId(null)
    }
  }

  // ── Close preview modal on Escape ──────────────────────────────────
  useEffect(() => {
    if (!previewDoc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewDoc(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewDoc])

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="w-4 h-4 text-fg-muted" />
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {!loading && (
          <span className="text-xs text-fg-subtle">
            {docs.length} attached
          </span>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        className={[
          'rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors',
          dragOver
            ? 'border-brand bg-brand-bg'
            : 'border-border hover:border-border-strong hover:bg-surface-muted',
        ].join(' ')}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onPick}
          className="hidden"
        />
        <Upload className="w-5 h-5 text-fg-muted mx-auto mb-1.5" />
        <div className="text-xs text-fg">
          <span className="font-medium">Drop files</span> or click to browse
        </div>
        <div className="text-[11px] text-fg-subtle mt-0.5">
          Up to {maxFiles} files · {maxSizeMB}MB each
        </div>
      </div>

      {/* In-flight uploads */}
      {uploads.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {uploads.map((u) => (
            <div
              key={u.key}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-muted text-xs"
            >
              {u.status === 'uploading' && (
                <Loader2 className="w-3.5 h-3.5 text-fg-muted animate-spin shrink-0" />
              )}
              {u.status === 'pending' && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-fg-subtle border-dashed shrink-0" />
              )}
              {u.status === 'success' && (
                <span className="w-3.5 h-3.5 rounded-full bg-data-positive shrink-0" />
              )}
              {u.status === 'error' && (
                <AlertTriangle className="w-3.5 h-3.5 text-data-negative shrink-0" />
              )}
              <span className="flex-1 truncate text-fg">{u.fileName}</span>
              <span className="text-fg-subtle tabular-nums">{formatBytes(u.fileSize)}</span>
              {u.status === 'pending' && (
                <select
                  value={u.category}
                  onChange={(e) => updatePendingCategory(u.key, e.target.value)}
                  className="input input-sm text-[11px] py-0.5"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              )}
              {u.status === 'error' && (
                <span className="text-data-negative text-[11px]">{u.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Existing docs */}
      <div className="mt-3">
        {loading ? (
          <div className="text-xs text-fg-muted px-3 py-4">Loading…</div>
        ) : error ? (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-data-negative-bg text-xs text-data-negative">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : docs.length === 0 ? (
          <div className="text-xs text-fg-subtle px-3 py-4 text-center italic">
            No documents attached yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {docs.map((d) => {
              const kind = fileKind(d.mimeType, d.fileType)
              const Icon = fileIcon(kind)
              const previewable = kind === 'image' || kind === 'pdf'
              const isImage = kind === 'image'
              const downloadHref = `/api/ops/documents/vault/${d.id}?mode=download`
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-2 py-2 px-2 group hover:bg-surface-muted/40 rounded transition-colors"
                >
                  {/* Thumbnail (images) or icon */}
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(d)}
                      className="shrink-0 w-10 h-10 rounded border border-border overflow-hidden bg-surface-muted hover:ring-2 hover:ring-brand transition-all"
                      title="Preview"
                    >
                      <img
                        src={downloadHref}
                        alt={d.fileName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <Icon className="w-4 h-4 text-fg-muted shrink-0" />
                  )}

                  {/* Filename — clicking previews if previewable, otherwise downloads */}
                  {previewable ? (
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(d)}
                      className="flex-1 min-w-0 text-sm text-fg hover:text-brand truncate text-left"
                      title={`Preview ${d.fileName}`}
                    >
                      {d.fileName}
                    </button>
                  ) : (
                    <a
                      href={downloadHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 text-sm text-fg hover:text-brand truncate"
                      title={d.fileName}
                    >
                      {d.fileName}
                    </a>
                  )}

                  {/* Category — click to edit */}
                  {editingCategoryId === d.id ? (
                    <select
                      autoFocus
                      defaultValue={d.category}
                      onBlur={(e) => handleUpdateCategory(d, e.target.value)}
                      onChange={(e) => handleUpdateCategory(d, e.target.value)}
                      className="input input-sm text-[11px] py-0.5"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingCategoryId(d.id)}
                      className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded hover:ring-1 hover:ring-border-strong ${categoryColor(d.category)}`}
                      title="Click to change category"
                    >
                      {d.category.replace(/_/g, ' ')}
                    </button>
                  )}

                  {/* Metadata: size · uploadedBy · relative time */}
                  <span className="text-[11px] text-fg-subtle tabular-nums hidden md:inline">
                    {formatBytes(d.fileSize)}
                  </span>
                  {d.uploadedByName && (
                    <span
                      className="text-[11px] text-fg-subtle hidden lg:inline truncate max-w-[120px]"
                      title={`Uploaded by ${d.uploadedByName}`}
                    >
                      {d.uploadedByName}
                    </span>
                  )}
                  <span
                    className="text-[11px] text-fg-subtle hidden sm:inline"
                    title={formatDate(d.createdAt)}
                  >
                    {formatRelative(d.createdAt)}
                  </span>

                  {/* Quick view (preview) */}
                  {previewable && (
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(d)}
                      className="text-fg-subtle hover:text-fg p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Quick view"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <a
                    href={downloadHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-fg-subtle hover:text-fg p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDelete(d)}
                    className="text-fg-subtle hover:text-data-negative p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Preview modal — image lightbox or PDF iframe. Backdrop click + Esc close. */}
      {previewDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview: ${previewDoc.fileName}`}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="bg-surface-elevated rounded-lg border border-border max-w-5xl w-full max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg truncate" title={previewDoc.fileName}>
                  {previewDoc.fileName}
                </p>
                <p className="text-[11px] text-fg-subtle mt-0.5">
                  {formatBytes(previewDoc.fileSize)}
                  {previewDoc.uploadedByName ? ` · ${previewDoc.uploadedByName}` : ''}
                  {' · '}
                  {formatRelative(previewDoc.createdAt)}
                </p>
              </div>
              <a
                href={`/api/ops/documents/vault/${previewDoc.id}?mode=download`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-fg-muted hover:text-brand px-3 py-1.5 mr-2"
                title="Download"
              >
                <Download className="w-4 h-4 inline" /> Download
              </a>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="text-fg-subtle hover:text-fg p-1.5"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-surface-muted">
              {fileKind(previewDoc.mimeType, previewDoc.fileType) === 'image' ? (
                <img
                  src={`/api/ops/documents/vault/${previewDoc.id}?mode=download`}
                  alt={previewDoc.fileName}
                  className="block mx-auto max-w-full max-h-[80vh] object-contain"
                />
              ) : (
                <iframe
                  src={`/api/ops/documents/vault/${previewDoc.id}?mode=download`}
                  title={previewDoc.fileName}
                  className="w-full h-[80vh] border-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
