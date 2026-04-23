'use client'

import { useEffect, useState } from 'react'
import {
  FileText, Download, ExternalLink, RefreshCw, FileSpreadsheet,
  Calendar, AlertTriangle, FileImage,
} from 'lucide-react'

interface HyphenDoc {
  id: string
  sourceId: string
  eventType: string
  docCategory: string | null
  poNumber: string | null
  builderName: string | null
  subdivision: string | null
  lotBlock: string | null
  planElvSwing: string | null
  jobAddress: string | null
  fileName: string | null
  fileUrl: string | null
  fileSizeBytes: number | null
  contentType: string | null
  closingDate: string | null
  requestedStart: string | null
  requestedEnd: string | null
  acknowledgedStart: string | null
  acknowledgedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  permitNumber: string | null
  isLate: boolean | null
  coNumber: string | null
  originalPo: string | null
  coReason: string | null
  coNetValueChange: string | number | null
  coBuilderStatus: string | null
  matchConfidence: string | null
  scrapedAt: string
}

interface GroupsResponse {
  jobId: string
  total: number
  counts: Record<string, number>
  groups: Array<{ category: string; docs: HyphenDoc[] }>
}

const CATEGORY_ICONS: Record<string, any> = {
  'Plans': FileImage,
  'Red Lines': FileText,
  'Change Orders': FileSpreadsheet,
  'Schedules': Calendar,
  'Other': FileText,
}

function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(n: string | number | null): string {
  if (n == null) return '—'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(v)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v)
}

export default function HyphenDocumentsTab({ jobId }: { jobId: string }) {
  const [data, setData] = useState<GroupsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDocs = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/documents`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const j = (await res.json()) as GroupsResponse
      setData(j)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (jobId) fetchDocs()
  }, [jobId])

  // Find a PO number from any doc so we can wire the "Open in Hyphen" link.
  const anyPo = data?.groups
    .flatMap((g) => g.docs)
    .find((d) => !!d.poNumber)?.poNumber

  return (
    <div className="bg-white rounded-lg border p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Hyphen Documents</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading
              ? 'Loading…'
              : data
                ? `${data.total} document${data.total === 1 ? '' : 's'} scraped from Hyphen portal`
                : 'No data'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {anyPo && (
            <a
              href={`https://www.hyphensolutions.com/MH2Supply/Orders/OrderDetail.asp?order_id=${encodeURIComponent(anyPo)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#0f2a3e] text-white hover:bg-[#163d5a] font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in Hyphen
            </a>
          )}
          <button
            onClick={fetchDocs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {!loading && data && data.total === 0 && (
        <div className="text-center py-10 text-sm text-gray-400">
          No Hyphen documents yet for this job.
          {anyPo
            ? null
            : ' Once the NUC scraper pushes a plan, red-line, CO, or schedule event they will appear here.'}
        </div>
      )}

      {data && data.total > 0 && (
        <div className="space-y-5">
          {data.groups
            .filter((g) => g.docs.length > 0)
            .map((group) => {
              const Icon = CATEGORY_ICONS[group.category] || FileText
              return (
                <div key={group.category}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-4 h-4 text-gray-500" />
                    <h3 className="text-sm font-semibold text-gray-900">
                      {group.category}
                    </h3>
                    <span className="text-[10px] font-mono tabular-nums text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {group.docs.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {group.docs.map((d) =>
                      group.category === 'Schedules' ? (
                        <ScheduleRow key={d.id} doc={d} />
                      ) : group.category === 'Change Orders' ? (
                        <ChangeOrderRow key={d.id} doc={d} />
                      ) : (
                        <FileRow key={d.id} doc={d} />
                      ),
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

function FileRow({ doc }: { doc: HyphenDoc }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {doc.fileName || `${doc.eventType} · ${doc.id.slice(0, 8)}`}
          </p>
          <p className="text-[11px] text-gray-500 font-mono tabular-nums mt-0.5">
            {formatAgo(doc.scrapedAt)} · {formatBytes(doc.fileSizeBytes)}
            {doc.planElvSwing ? ` · ${doc.planElvSwing}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {doc.matchConfidence && doc.matchConfidence !== 'HIGH' && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
            <AlertTriangle className="w-3 h-3" />
            {doc.matchConfidence}
          </span>
        )}
        {doc.fileUrl && (
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
        )}
      </div>
    </div>
  )
}

function ScheduleRow({ doc }: { doc: HyphenDoc }) {
  return (
    <div className="p-3 border rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900">
            {doc.eventType === 'closing_date' ? 'Closing' : 'Schedule'}
          </span>
          {doc.isLate && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold">
              LATE
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono tabular-nums text-gray-500">
          {formatAgo(doc.scrapedAt)}
        </span>
      </div>

      {doc.closingDate && (
        <div className="mb-2 p-2 bg-[#0f2a3e]/5 border border-[#0f2a3e]/20 rounded">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Closing Date
          </p>
          <p className="text-base font-bold text-[#0f2a3e] font-mono tabular-nums">
            {formatDate(doc.closingDate)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <TimelinePair
          label="Requested"
          start={doc.requestedStart}
          end={doc.requestedEnd}
        />
        <TimelinePair
          label="Acknowledged"
          start={doc.acknowledgedStart}
          end={doc.acknowledgedEnd}
        />
        <TimelinePair
          label="Actual"
          start={doc.actualStart}
          end={doc.actualEnd}
        />
      </div>

      {doc.permitNumber && (
        <p className="text-[11px] text-gray-500 font-mono tabular-nums mt-2">
          Permit: {doc.permitNumber}
        </p>
      )}
    </div>
  )
}

function TimelinePair({
  label,
  start,
  end,
}: {
  label: string
  start: string | null
  end: string | null
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-gray-800 font-mono tabular-nums">
        {start ? formatDate(start) : '—'}
        {end ? ` → ${formatDate(end)}` : ''}
      </p>
    </div>
  )
}

function ChangeOrderRow({ doc }: { doc: HyphenDoc }) {
  const net =
    typeof doc.coNetValueChange === 'string'
      ? parseFloat(doc.coNetValueChange)
      : doc.coNetValueChange ?? null

  return (
    <div className="p-3 border rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900 font-mono tabular-nums">
            {doc.coNumber || 'CO (no number)'}
          </span>
          {doc.coBuilderStatus && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                doc.coBuilderStatus.toLowerCase().includes('approved')
                  ? 'bg-green-100 text-green-800'
                  : doc.coBuilderStatus.toLowerCase().includes('rejected')
                    ? 'bg-red-100 text-red-800'
                    : 'bg-blue-100 text-blue-800'
              }`}
            >
              {doc.coBuilderStatus}
            </span>
          )}
        </div>
        {net != null && (
          <span
            className={`text-sm font-bold font-mono tabular-nums ${
              net > 0 ? 'text-red-600' : net < 0 ? 'text-green-600' : 'text-gray-700'
            }`}
          >
            {net > 0 ? '+' : ''}
            {formatCurrency(net)}
          </span>
        )}
      </div>
      {doc.coReason && <p className="text-sm text-gray-700">{doc.coReason}</p>}
      <div className="flex items-center justify-between mt-2">
        <p className="text-[11px] text-gray-500 font-mono tabular-nums">
          {formatAgo(doc.scrapedAt)}
          {doc.originalPo ? ` · PO ${doc.originalPo}` : ''}
        </p>
        {doc.fileUrl && (
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium"
          >
            <Download className="w-3 h-3" />
            CO PDF
          </a>
        )}
      </div>
    </div>
  )
}
