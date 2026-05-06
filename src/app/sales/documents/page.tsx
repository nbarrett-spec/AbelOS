'use client'

/**
 * /sales/documents — Sales Document Vault
 *
 * Audit item A-UX-12. Wires the previously-stubbed sales documents page to
 * the live DocumentVault API. Mirrors the visual style of /ops/payments
 * (PageHeader, KPI strip, filter row, dense table, pagination footer).
 *
 *   GET /api/ops/documents/vault   — search/filter/page (50/page)
 *   POST /api/ops/documents/vault  — upload (multipart) or {action: 'archive'}
 *   GET /api/ops/documents/vault/[id]?mode=download — file stream
 *
 * Auth: cookie-based staff session via the /sales layout. ADMIN, MANAGER,
 * SALES_REP, and PROJECT_MANAGER all reach this page (layout updated to
 * include PMs alongside the existing sales roles).
 *
 * Filters (all optional, AND-combined server-side except uploaded-by which
 * is filtered client-side from the loaded page):
 *   - free-text search (filename / description / tag)
 *   - category (14 vault categories)
 *   - entity type (BUILDER | ORDER | QUOTE | CONTRACT | GENERAL)
 *   - date range (createdAt; client-side because the GET endpoint doesn't
 *     accept dateFrom/dateTo yet)
 *   - uploaded-by (derived from currently-loaded uploaders so we don't need
 *     a privileged staff list endpoint)
 *
 * The "+ Upload Document" button opens a modal that wraps the existing
 * <DocumentAttachments> component in standalone (GENERAL) mode. If the user
 * picks a builder from the dropdown first, we re-render with
 * entityType=builder so the upload links to that builder.
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  FileText,
  Search,
  Plus,
  RefreshCw,
  Download,
  Archive,
  X,
  Files,
  HardDrive,
  Users,
  Upload,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import DocumentAttachments from '@/components/ops/DocumentAttachments'

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'QUOTE', label: 'Quote' },
  { value: 'ORDER', label: 'Order' },
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'BLUEPRINT', label: 'Blueprint' },
  { value: 'FLOOR_PLAN', label: 'Floor Plan' },
  { value: 'SPEC_SHEET', label: 'Spec Sheet' },
  { value: 'PHOTO', label: 'Photo' },
  { value: 'DELIVERY_PROOF', label: 'Delivery Proof' },
  { value: 'WARRANTY', label: 'Warranty' },
  { value: 'SERVICE_REQUEST', label: 'Service Request' },
  { value: 'CORRESPONDENCE', label: 'Correspondence' },
  { value: 'REPORT', label: 'Report' },
  { value: 'GENERAL', label: 'General' },
] as const

// Entity-type filter buckets. The vault stores granular FK columns
// (builderId, orderId, quoteId, etc.); we map the user-facing buckets
// onto whichever column is populated. CONTRACT is derived from
// category=CONTRACT since there's no contract FK.
const ENTITY_TYPES = [
  { value: 'BUILDER', label: 'Builder' },
  { value: 'ORDER', label: 'Order' },
  { value: 'QUOTE', label: 'Quote' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'GENERAL', label: 'General (no link)' },
] as const

const PAGE_SIZE = 50

// ──────────────────────────────────────────────────────────────────────
// Types — mirror the GET response shape we actually consume
// ──────────────────────────────────────────────────────────────────────

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

interface BuilderRow {
  id: string
  companyName: string
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fileIcon(fileType: string, mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (fileType === 'pdf' || mimeType === 'application/pdf') return '📕'
  if (['doc', 'docx'].includes(fileType)) return '📘'
  if (['xls', 'xlsx'].includes(fileType)) return '📗'
  if (['ppt', 'pptx'].includes(fileType)) return '📙'
  if (fileType === 'csv') return '📊'
  if (mimeType.startsWith('text/')) return '📄'
  return '📎'
}

function categoryBadge(cat: string): string {
  switch (cat) {
    case 'CONTRACT':
    case 'WARRANTY':
      return 'bg-amber-100 text-amber-700'
    case 'INVOICE':
    case 'PURCHASE_ORDER':
    case 'ORDER':
      return 'bg-emerald-100 text-emerald-700'
    case 'BLUEPRINT':
    case 'FLOOR_PLAN':
    case 'SPEC_SHEET':
      return 'bg-blue-100 text-blue-700'
    case 'PHOTO':
    case 'DELIVERY_PROOF':
      return 'bg-violet-100 text-violet-700'
    case 'QUOTE':
      return 'bg-yellow-100 text-yellow-700'
    case 'REPORT':
      return 'bg-orange-100 text-orange-700'
    case 'CORRESPONDENCE':
      return 'bg-sky-100 text-sky-700'
    case 'SERVICE_REQUEST':
      return 'bg-rose-100 text-rose-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export default function SalesDocumentsPage() {
  // Filters
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [entityType, setEntityType] = useState('')
  const [uploadedBy, setUploadedBy] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  // Data
  const [docs, setDocs] = useState<VaultDocument[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [summary, setSummary] = useState<VaultSummary | null>(null)
  const [builders, setBuilders] = useState<BuilderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadBuilderId, setUploadBuilderId] = useState('')

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [search, category, entityType, uploadedBy, dateFrom, dateTo])

  // ────── Fetch document page ──────
  const fetchDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (category) params.set('category', category)
      // Map the entity-type bucket to vault filter columns. CONTRACT is
      // derived from category since the vault has no contract FK.
      if (entityType === 'BUILDER') {
        // we'll filter client-side: any row with builderId set
      } else if (entityType === 'CONTRACT') {
        // override the category param
        params.set('category', 'CONTRACT')
      }
      params.set('page', page.toString())
      params.set('limit', PAGE_SIZE.toString())

      const res = await fetch(`/api/ops/documents/vault?${params.toString()}`, {
        credentials: 'include',
      })
      if (!res.ok) {
        throw new Error(`Failed to load documents (${res.status})`)
      }
      const data = await res.json()
      setDocs(data.documents || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 0)
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents')
      setDocs([])
      setTotal(0)
      setTotalPages(0)
    } finally {
      setLoading(false)
    }
  }, [search, category, entityType, page])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/documents/vault?report=summary', {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary || null)
      }
    } catch {
      // KPI strip is non-critical
    }
  }, [])

  // ────── Fetch builders for upload-modal dropdown ──────
  const fetchBuilders = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/builders?limit=200&sortBy=companyName&sortDir=asc', {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        const list = (data.builders || data.data || []).map((b: any) => ({
          id: b.id,
          companyName: b.companyName,
        }))
        setBuilders(list)
      }
    } catch {
      // dropdown will simply be empty — non-critical
    }
  }, [])

  useEffect(() => {
    fetchDocs()
  }, [fetchDocs])
  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])
  useEffect(() => {
    fetchBuilders()
  }, [fetchBuilders])

  // ────── Client-side filters (uploaded-by, date range, BUILDER bucket) ──────
  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      // Entity bucket filter — server already handled CONTRACT
      if (entityType === 'BUILDER' && !d.builderId) return false
      if (entityType === 'ORDER' && !d.orderId) return false
      if (entityType === 'QUOTE' && !d.quoteId) return false
      if (entityType === 'GENERAL') {
        // No FK, no entityType
        const linked =
          d.builderId ||
          d.orderId ||
          d.jobId ||
          d.quoteId ||
          d.invoiceId ||
          d.dealId ||
          d.vendorId ||
          d.purchaseOrderId ||
          d.doorIdentityId ||
          d.entityId
        if (linked) return false
      }
      // Uploaded-by filter
      if (uploadedBy && d.uploadedBy !== uploadedBy) return false
      // Date range (client-side; server doesn't accept these yet)
      if (dateFrom) {
        const from = new Date(dateFrom).getTime()
        if (new Date(d.createdAt).getTime() < from) return false
      }
      if (dateTo) {
        // Inclusive: date string + 1 day
        const to = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1
        if (new Date(d.createdAt).getTime() > to) return false
      }
      return true
    })
  }, [docs, entityType, uploadedBy, dateFrom, dateTo])

  // Distinct uploaders from the loaded page (avoids staff list endpoint)
  const uploaderOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const d of docs) {
      if (!seen.has(d.uploadedBy)) {
        seen.set(d.uploadedBy, d.uploadedByName || d.uploadedBy)
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [docs])

  const builderMap = useMemo(() => {
    return new Map(builders.map((b) => [b.id, b.companyName]))
  }, [builders])

  // ────── Actions ──────
  const handleArchive = async (docId: string) => {
    if (!confirm('Archive this document? You can restore it later from the Ops vault.')) return
    try {
      const res = await fetch('/api/ops/documents/vault', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', documentId: docId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      fetchDocs()
      fetchSummary()
    } catch (e: any) {
      setError(e?.message || 'Archive failed')
    }
  }

  const clearFilters = () => {
    setSearch('')
    setCategory('')
    setEntityType('')
    setUploadedBy('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = !!(search || category || entityType || uploadedBy || dateFrom || dateTo)

  // ────── Entity link rendering ──────
  const renderEntityLink = (d: VaultDocument) => {
    if (d.builderId) {
      const name = builderMap.get(d.builderId) || `Builder ${d.builderId.slice(0, 6)}`
      return (
        <Link
          href={`/ops/builders/${d.builderId}`}
          className="text-c1 hover:underline truncate max-w-[200px] inline-block"
          title={name}
        >
          {name}
        </Link>
      )
    }
    if (d.dealId) {
      return (
        <Link
          href={`/sales/deals/${d.dealId}`}
          className="text-c1 hover:underline"
        >
          Deal
        </Link>
      )
    }
    if (d.orderId) {
      return (
        <Link
          href={`/ops/orders/${d.orderId}`}
          className="text-c1 hover:underline"
        >
          Order
        </Link>
      )
    }
    if (d.quoteId) {
      return (
        <Link
          href={`/ops/quotes/${d.quoteId}`}
          className="text-c1 hover:underline"
        >
          Quote
        </Link>
      )
    }
    if (d.invoiceId) {
      return (
        <Link
          href={`/ops/invoices/${d.invoiceId}`}
          className="text-c1 hover:underline"
        >
          Invoice
        </Link>
      )
    }
    if (d.jobId) {
      return (
        <Link
          href={`/ops/jobs/${d.jobId}`}
          className="text-c1 hover:underline"
        >
          Job
        </Link>
      )
    }
    if (d.vendorId) {
      return (
        <Link
          href={`/ops/vendors/${d.vendorId}`}
          className="text-c1 hover:underline"
        >
          Vendor
        </Link>
      )
    }
    if (d.purchaseOrderId) {
      return (
        <Link
          href={`/ops/purchasing/${d.purchaseOrderId}`}
          className="text-c1 hover:underline"
        >
          PO
        </Link>
      )
    }
    return <span className="text-fg-subtle italic text-xs">Unlinked</span>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title="Documents"
        description="Search the document vault — contracts, spec sheets, blueprints, correspondence, and anything else attached to your builders or deals."
        crumbs={[
          { label: 'Sales', href: '/sales' },
          { label: 'Documents' },
        ]}
        actions={
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-signal text-fg-on-accent text-sm font-medium hover:bg-signal-hover transition-colors"
          >
            <Plus className="w-4 h-4" /> Upload Document
          </button>
        }
      />

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI
            icon={<Files className="w-4 h-4 text-fg-muted" />}
            label="Active Documents"
            value={summary.activeDocuments.toLocaleString()}
            sub={`${summary.archivedDocuments} archived`}
          />
          <KPI
            icon={<HardDrive className="w-4 h-4 text-fg-muted" />}
            label="Total Storage"
            value={formatBytes(summary.totalSizeBytes)}
            sub="across all categories"
          />
          <KPI
            icon={<Users className="w-4 h-4 text-fg-muted" />}
            label="Builders w/ Docs"
            value={summary.buildersWithDocs.toLocaleString()}
            sub={`${summary.ordersWithDocs} orders`}
          />
          <KPI
            icon={<Upload className="w-4 h-4 text-fg-muted" />}
            label="Unique Uploaders"
            value={summary.uniqueUploaders.toLocaleString()}
            sub="staff with vault activity"
          />
        </div>
      )}

      {/* Filter row */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by filename, description, or tag…"
              className="w-full pl-9 pr-3 py-2 border border-border bg-surface text-fg rounded-md text-sm focus:ring-2 focus:ring-signal focus:border-signal"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 border border-border bg-surface text-fg rounded-md text-sm min-w-[140px]"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="px-3 py-2 border border-border bg-surface text-fg rounded-md text-sm min-w-[140px]"
          >
            <option value="">All entities</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
          <select
            value={uploadedBy}
            onChange={(e) => setUploadedBy(e.target.value)}
            className="px-3 py-2 border border-border bg-surface text-fg rounded-md text-sm min-w-[160px]"
            title="Uploaded by (drawn from current page)"
          >
            <option value="">All uploaders</option>
            {uploaderOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-border bg-surface text-fg rounded-md text-sm min-w-[140px]"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-border bg-surface text-fg rounded-md text-sm min-w-[140px]"
            title="To date"
          />
          <button
            type="button"
            onClick={() => {
              fetchDocs()
              fetchSummary()
            }}
            className="p-2 rounded-md border border-border text-fg-muted hover:bg-surface-muted"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-fg-subtle hover:text-fg"
            >
              Clear
            </button>
          )}
        </div>

        <div className="text-xs text-fg-muted">
          {filteredDocs.length} of {total} document{total === 1 ? '' : 's'} on page{' '}
          <span className="text-fg font-semibold tabular-nums">{page}</span>
          {totalPages > 0 && ` / ${totalPages}`}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-white rounded-lg border border-data-negative/30 p-3 text-sm text-data-negative flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-fg-muted hover:text-fg ml-3">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-lg border p-8 text-center text-fg-muted text-sm">
          Loading documents…
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <FileText className="w-10 h-10 text-fg-subtle mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-fg mb-1">
            {hasFilters ? 'No documents match the current filters.' : 'No documents yet.'}
          </h3>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-c1 hover:underline mt-1"
            >
              Clear filters
            </button>
          ) : (
            <p className="text-xs text-fg-muted">
              Click <span className="font-medium">Upload Document</span> to add the first one.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                <Th>Document</Th>
                <Th>Category</Th>
                <Th>Linked To</Th>
                <Th>Uploaded By</Th>
                <Th>Uploaded At</Th>
                <Th align="right">Size</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredDocs.map((d) => (
                <tr key={d.id} className="hover:bg-surface-muted/40">
                  <Td>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base shrink-0" aria-hidden>
                        {fileIcon(d.fileType, d.mimeType)}
                      </span>
                      <a
                        href={`/api/ops/documents/vault/${d.id}?mode=download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fg hover:text-c1 truncate max-w-[260px]"
                        title={d.fileName}
                      >
                        {d.fileName}
                      </a>
                    </div>
                    {d.description && (
                      <div className="text-[11px] text-fg-subtle truncate max-w-[260px] pl-6">
                        {d.description}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${categoryBadge(d.category)}`}
                    >
                      {d.category.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td>{renderEntityLink(d)}</Td>
                  <Td>
                    <span className="text-fg-muted text-[12px]">
                      {d.uploadedByName || d.uploadedBy.slice(0, 8)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-fg-muted text-[12px]">{formatDate(d.createdAt)}</span>
                  </Td>
                  <Td align="right">
                    <span className="text-fg-muted tabular-nums text-[12px]">
                      {formatBytes(d.fileSize)}
                    </span>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={`/api/ops/documents/vault/${d.id}?mode=download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-fg-muted hover:text-c1 rounded hover:bg-surface-muted"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleArchive(d.id)}
                        className="p-1.5 text-fg-muted hover:text-data-negative rounded hover:bg-surface-muted"
                        title="Archive"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-border bg-surface-muted">
              <div className="text-xs text-fg-muted">
                Showing {(page - 1) * PAGE_SIZE + 1}-
                {Math.min(page * PAGE_SIZE, total)} of {total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 border border-border rounded text-xs disabled:opacity-40 hover:bg-white"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 border border-border rounded text-xs disabled:opacity-40 hover:bg-white"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload modal — wraps DocumentAttachments in standalone mode */}
      {uploadOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setUploadOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-elevation-3 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-fg">Upload Document</h2>
                <p className="text-xs text-fg-muted mt-0.5">
                  Optionally link to a builder. Otherwise the document is stored as a general
                  sales asset.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="text-fg-subtle hover:text-fg"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-fg-muted uppercase mb-1">
                  Link to builder (optional)
                </label>
                <select
                  value={uploadBuilderId}
                  onChange={(e) => setUploadBuilderId(e.target.value)}
                  className="w-full px-3 py-2 border border-border bg-surface text-fg rounded-md text-sm"
                >
                  <option value="">None — store as general document</option>
                  {builders.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.companyName}
                    </option>
                  ))}
                </select>
              </div>

              {/*
                Re-mount the component when uploadBuilderId changes so it
                picks up the new entityType/entityId pair. The vault API
                requires a real entity FK on POST; passing an empty/
                placeholder id with entityType=builder would fail, so we
                fall back to a synthetic GENERAL bucket. Operators can
                relink later from /ops/documents/vault if needed.
              */}
              {uploadBuilderId ? (
                <DocumentAttachments
                  key={`builder-${uploadBuilderId}`}
                  entityType="builder"
                  entityId={uploadBuilderId}
                  defaultCategory="GENERAL"
                  title="Files to upload"
                  onChange={() => {
                    fetchDocs()
                    fetchSummary()
                  }}
                />
              ) : (
                <GeneralUploader
                  onUploaded={() => {
                    fetchDocs()
                    fetchSummary()
                  }}
                />
              )}
            </div>
            <div className="p-5 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="px-4 py-2 border border-border rounded-md text-sm text-fg-muted hover:bg-surface-muted"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function KPI({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-fg-muted uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="text-xs text-fg-subtle mt-1">{sub}</div>}
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-4 py-2 text-[11px] font-semibold text-fg-muted uppercase tracking-wider ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <td className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''}`}>{children}</td>
}

/**
 * GeneralUploader — minimal multipart upload for the "no builder selected"
 * path. The shared <DocumentAttachments> component requires a concrete
 * entity FK, so we duplicate just enough of its drop-zone for the GENERAL
 * case here. Posts to the same /api/ops/documents/vault endpoint with
 * category=GENERAL and no entity links.
 */
function GeneralUploader({ onUploaded }: { onUploaded: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const submit = async () => {
    if (files.length === 0) return
    setUploading(true)
    setErrors([])
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      fd.append('category', 'GENERAL')
      const res = await fetch('/api/ops/documents/vault', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors([data.error || `HTTP ${res.status}`])
        return
      }
      if (data.errors?.length) {
        setErrors(data.errors)
      }
      setFiles([])
      onUploaded()
    } catch (e: any) {
      setErrors([e?.message || 'Upload failed'])
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
        <Upload className="w-5 h-5 text-fg-muted mx-auto mb-1.5" />
        <input
          type="file"
          multiple
          onChange={(e) => {
            const picked = Array.from(e.target.files || [])
            if (picked.length > 0) setFiles((prev) => [...prev, ...picked])
            e.target.value = ''
          }}
          className="text-xs"
        />
        <div className="text-[11px] text-fg-subtle mt-1">Up to 25MB per file</div>
      </div>
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 px-2 py-1 rounded bg-surface-muted text-xs"
            >
              <span className="flex-1 truncate text-fg">{f.name}</span>
              <span className="text-fg-subtle">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-data-negative hover:text-data-negative/70"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={submit}
            disabled={uploading}
            className="mt-2 w-full px-3 py-2 rounded-md bg-signal text-fg-on-accent text-sm font-medium disabled:opacity-50 hover:bg-signal-hover transition-colors"
          >
            {uploading ? 'Uploading…' : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-2 text-xs text-data-negative">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  )
}
