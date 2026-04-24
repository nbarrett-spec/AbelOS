'use client'

// ── ChangeOrderInbox ────────────────────────────────────────────────────
// Surfaces every Change-Order kind HyphenDocument for a Job on the
// Documents tab. Pairs with (but does not duplicate) HyphenDocumentsTab —
// this is a single-purpose card focused on CO intake workflow.
//
// Data source: GET /api/ops/jobs/[id]/co-list (owned by this wave, D9).
// Feature flag: NEXT_PUBLIC_FEATURE_CO_INBOX. 'off' → render null.
// ────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import {
  FileSpreadsheet,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react'

const ENABLED = process.env.NEXT_PUBLIC_FEATURE_CO_INBOX !== 'off'

interface ChangeOrderDoc {
  id: string
  eventType: string
  docCategory: string | null
  coNumber: string | null
  coReason: string | null
  coNetValueChange: string | number | null
  originalPo: string | null
  poNumber: string | null
  fileName: string | null
  fileUrl: string | null
  scrapedAt: string
  closingDate: string | null
  builderName: string | null
  lotBlock: string | null
}

interface CoListResponse {
  jobId: string
  total: number
  lastSyncedAt: string | null
  changeOrders: ChangeOrderDoc[]
}

function formatAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCurrency(n: string | number | null): string | null {
  if (n == null || n === '') return null
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(v)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(v)
}

// Derive a CO-number-ish label from whatever fields Hyphen happened to
// populate. coNumber wins; then the filename; then a short id.
function coLabel(doc: ChangeOrderDoc): string {
  if (doc.coNumber) return doc.coNumber
  if (doc.fileName) {
    const base = doc.fileName.replace(/\.(pdf|xlsx|xls|docx?)$/i, '')
    return base.length > 40 ? base.slice(0, 40) + '…' : base
  }
  return `CO ${doc.id.slice(0, 6)}`
}

// Short human summary — prefer coReason, fall back to PO/lot context.
function coSummary(doc: ChangeOrderDoc): string {
  if (doc.coReason) return doc.coReason
  const parts = []
  if (doc.originalPo || doc.poNumber) {
    parts.push(`PO ${doc.originalPo || doc.poNumber}`)
  }
  if (doc.lotBlock) parts.push(doc.lotBlock)
  return parts.length > 0 ? parts.join(' · ') : '(no reason on file)'
}

export default function ChangeOrderInbox({ jobId }: { jobId: string }) {
  const [data, setData] = useState<CoListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showViewer, setShowViewer] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/co-list`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const j = (await res.json()) as CoListResponse
      setData(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    if (!ENABLED) return
    fetchList()
  }, [fetchList])

  if (!ENABLED) return null

  const total = data?.total ?? 0
  const mostRecent = data?.changeOrders?.[0] ?? null
  const canInlineView =
    !!mostRecent?.fileUrl &&
    (mostRecent.fileUrl.endsWith('.pdf') ||
      mostRecent.fileName?.toLowerCase().endsWith('.pdf'))

  return (
    <div className="bg-white rounded-lg border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Change Orders</h2>
          {total > 0 && (
            <span className="text-xs font-mono tabular-nums text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
              {total}
            </span>
          )}
          <span className="text-xs text-gray-400">
            Last synced {formatAgo(data?.lastSyncedAt || null)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canInlineView && (
            <button
              onClick={() => setShowViewer((s) => !s)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
              aria-label={showViewer ? 'Hide inline viewer' : 'Show inline viewer'}
            >
              {showViewer ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" /> Hide viewer
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" /> View most recent
                </>
              )}
            </button>
          )}
          <button
            onClick={fetchList}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Refresh change order list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : total === 0 ? (
        <p className="text-sm text-gray-400">No change orders yet.</p>
      ) : (
        <>
          <div className="space-y-2">
            {data!.changeOrders.map((co) => {
              const netValue = formatCurrency(co.coNetValueChange)
              return (
                <div
                  key={co.id}
                  className="flex items-start justify-between gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <FileSpreadsheet className="w-4 h-4 text-[#C6A24E] flex-shrink-0" />
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {coLabel(co)}
                      </span>
                      {netValue && (
                        <span
                          className="text-xs font-medium tabular-nums"
                          style={{
                            color:
                              Number(co.coNetValueChange) > 0
                                ? '#E74C3C'
                                : '#27AE60',
                          }}
                        >
                          {netValue}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 truncate">
                      {coSummary(co)}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Received {formatDate(co.scrapedAt)}
                    </p>
                  </div>
                  {co.fileUrl ? (
                    <a
                      href={co.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-[#0f2a3e] text-white hover:bg-[#163d5a] flex-shrink-0"
                      aria-label={`View ${coLabel(co)} PDF in new tab`}
                    >
                      View PDF
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-[11px] text-gray-400 italic flex-shrink-0">
                      No file
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {showViewer && canInlineView && mostRecent?.fileUrl && (
            <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                {coLabel(mostRecent)} — most recent
              </div>
              <iframe
                src={mostRecent.fileUrl}
                title={`Change order ${coLabel(mostRecent)} preview`}
                className="w-full h-[600px]"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
