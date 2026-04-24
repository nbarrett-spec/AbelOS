'use client'

// ── HyphenPanel ─────────────────────────────────────────────────────────
// Read-only Job-detail consumer of the Hyphen (SupplyPro) sync endpoint.
// Lets PMs see closing date, red-lines, change orders, and plan sets
// without leaving Aegis.
//
// Data source: GET /api/integrations/hyphen/sync?jobId=... (owned by agent B1).
// Until B1 ships the route, this component renders a friendly empty state
// on 404 / 5xx and a retry button.
//
// Feature-flagged via NEXT_PUBLIC_FEATURE_HYPHEN_PANEL.
//   undefined | 'off' → render null.
//   anything else     → render on.
//
// Wave-3 Agent C7: moved from `src/app/jobs/[id]/HyphenPanel.tsx` (B2's
// wrong location) to `src/app/ops/jobs/[jobId]/HyphenPanel.tsx` — same
// contents, same props, no behavior change. Wired into the Job detail
// page alongside the existing HyphenDocumentsTab.
// ────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import {
  Calendar,
  FileText,
  FileSpreadsheet,
  Layers,
  ExternalLink,
  Download,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'

// ── API contract (agreed with agent B1) ─────────────────────────────────
interface RedLine {
  url: string
  pageCount: number
  uploadedAt: string
}

interface ChangeOrder {
  coNumber: string
  summary: string
  pdfUrl: string
}

interface PlanSet {
  group: 1 | 2
  url: string
  uploadedAt: string
}

interface HyphenSyncResponse {
  ok: boolean
  closingDate?: string
  redLines?: RedLine[]
  changeOrders?: ChangeOrder[]
  planSets?: PlanSet[]
  syncedAt?: string
  reason?: string
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatRelative(iso: string | undefined | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ── Feature flag ────────────────────────────────────────────────────────
// Evaluated at bundle time — Next.js inlines NEXT_PUBLIC_* on the client.
function isFeatureEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_FEATURE_HYPHEN_PANEL
  if (flag === 'off') return false
  // Default: ON (undefined / '' / anything else → true)
  return true
}

// ── Component ───────────────────────────────────────────────────────────

export interface HyphenPanelProps {
  jobId: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: HyphenSyncResponse }
  | { status: 'empty'; reason?: string }
  | { status: 'error'; message: string }

export default function HyphenPanel({ jobId }: HyphenPanelProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const fetchSync = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch(
        `/api/integrations/hyphen/sync?jobId=${encodeURIComponent(jobId)}`,
        { cache: 'no-store' },
      )
      // 404 = endpoint not implemented yet (B1 hasn't landed) or no data for job.
      if (res.status === 404) {
        setState({ status: 'empty' })
        return
      }
      if (!res.ok) {
        // 5xx or other failure — surface as error with retry.
        setState({
          status: 'error',
          message: `Sync request failed (${res.status}).`,
        })
        return
      }
      const json = (await res.json()) as HyphenSyncResponse
      if (!json || json.ok === false) {
        setState({ status: 'empty', reason: json?.reason })
        return
      }
      setState({ status: 'ready', data: json })
    } catch (err: any) {
      setState({
        status: 'error',
        message: err?.message || 'Network error while reaching Hyphen sync.',
      })
    }
  }, [jobId])

  useEffect(() => {
    if (!isFeatureEnabled()) return
    if (!jobId) return
    fetchSync()
  }, [jobId, fetchSync])

  // Flag-gate. Before the hook returns render-null so we don't even render
  // the <section> shell. Hooks above still run to keep the Rules of Hooks
  // happy, but they exit early when the flag is off.
  if (!isFeatureEnabled()) return null

  return (
    <section
      aria-labelledby="hyphen-panel-heading"
      className="bg-white rounded-lg border border-gray-200 p-5 space-y-4"
    >
      <Header
        state={state}
        onRefresh={fetchSync}
        refreshing={state.status === 'loading'}
      />

      {state.status === 'loading' && <LoadingBody />}

      {state.status === 'error' && (
        <ErrorBody message={state.message} onRetry={fetchSync} />
      )}

      {state.status === 'empty' && <EmptyBody reason={state.reason} onRetry={fetchSync} />}

      {state.status === 'ready' && <ReadyBody data={state.data} />}
    </section>
  )
}

// ── Header ──────────────────────────────────────────────────────────────

function Header({
  state,
  onRefresh,
  refreshing,
}: {
  state: LoadState
  onRefresh: () => void
  refreshing: boolean
}) {
  const syncedAt =
    state.status === 'ready' ? state.data.syncedAt : undefined
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2
          id="hyphen-panel-heading"
          className="text-base font-semibold text-gray-900"
        >
          Hyphen — SupplyPro Sync
        </h2>
        <p className="text-xs text-gray-500 mt-0.5 font-mono tabular-nums">
          {state.status === 'loading'
            ? 'Syncing…'
            : syncedAt
              ? `Last synced ${formatRelative(syncedAt)}`
              : 'Not yet synced'}
        </p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh Hyphen sync"
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
          aria-hidden
        />
        Refresh
      </button>
    </div>
  )
}

// ── Loading ─────────────────────────────────────────────────────────────

function LoadingBody() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Hyphen sync data"
      className="grid grid-cols-1 md:grid-cols-2 gap-3"
    >
      <Skeleton height="h-24" rounded="md" />
      <Skeleton height="h-24" rounded="md" />
      <Skeleton height="h-24" rounded="md" />
      <Skeleton height="h-24" rounded="md" />
    </div>
  )
}

// ── Error ───────────────────────────────────────────────────────────────

function ErrorBody({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-800">
            Hyphen sync unavailable
          </p>
          <p className="text-xs text-red-700 mt-1">{message}</p>
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Empty ───────────────────────────────────────────────────────────────

function EmptyBody({
  reason,
  onRetry,
}: {
  reason?: string
  onRetry: () => void
}) {
  return (
    <EmptyState
      icon="sparkles"
      size="compact"
      title="Hyphen panel coming soon"
      description={
        reason
          ? `Backend sync pending — ${reason}`
          : 'Backend sync pending. Once the Hyphen scraper pushes closing dates, red-lines, COs, and plan sets for this job, they will appear here.'
      }
      action={{ label: 'Check again', onClick: onRetry }}
    />
  )
}

// ── Ready ───────────────────────────────────────────────────────────────

function ReadyBody({ data }: { data: HyphenSyncResponse }) {
  const hasAnything =
    !!data.closingDate ||
    (data.redLines?.length ?? 0) > 0 ||
    (data.changeOrders?.length ?? 0) > 0 ||
    (data.planSets?.length ?? 0) > 0

  if (!hasAnything) {
    return (
      <EmptyState
        icon="inbox"
        size="compact"
        title="No Hyphen content yet"
        description="Sync succeeded but SupplyPro returned no closing date, red-lines, change orders, or plan sets for this job."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <ClosingDateCard closingDate={data.closingDate} />
      <RedLinesCard redLines={data.redLines ?? []} />
      <ChangeOrdersCard changeOrders={data.changeOrders ?? []} />
      <PlanSetsCard planSets={data.planSets ?? []} />
    </div>
  )
}

// ── Card shell ──────────────────────────────────────────────────────────

function PanelCard({
  title,
  icon,
  count,
  children,
}: {
  title: string
  icon: React.ReactNode
  count?: number
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-md border border-gray-200 bg-white p-4 flex flex-col gap-3"
      style={{
        borderLeft: '2px solid var(--signal, #4F46E5)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-gray-500" aria-hidden>
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {typeof count === 'number' && (
          <span className="text-[10px] font-mono tabular-nums text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

// ── Closing date ────────────────────────────────────────────────────────

function ClosingDateCard({ closingDate }: { closingDate?: string }) {
  return (
    <PanelCard title="Closing Date" icon={<Calendar className="w-4 h-4" />}>
      {closingDate ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Scheduled closing
          </p>
          <p
            className="text-xl font-bold font-mono tabular-nums mt-1"
            style={{ color: 'var(--brand, #0f2a3e)' }}
          >
            {formatDate(closingDate)}
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">
          No closing date on file.
        </p>
      )}
    </PanelCard>
  )
}

// ── Red lines ───────────────────────────────────────────────────────────

function RedLinesCard({ redLines }: { redLines: RedLine[] }) {
  return (
    <PanelCard
      title="Red-Line PDFs"
      icon={<FileText className="w-4 h-4" />}
      count={redLines.length}
    >
      {redLines.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No red-lines uploaded.</p>
      ) : (
        <ul className="space-y-2" role="list">
          {redLines.map((rl, i) => (
            <li
              key={`${rl.url}-${i}`}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">
                  Red-line #{i + 1}
                </p>
                <p className="text-[11px] text-gray-500 font-mono tabular-nums">
                  {rl.pageCount} {rl.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                  {formatRelative(rl.uploadedAt)}
                </p>
              </div>
              <a
                href={rl.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open red-line PDF ${i + 1} in a new tab`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
              >
                <ExternalLink className="w-3 h-3" aria-hidden />
                Open
              </a>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  )
}

// ── Change orders ───────────────────────────────────────────────────────

function ChangeOrdersCard({
  changeOrders,
}: {
  changeOrders: ChangeOrder[]
}) {
  return (
    <PanelCard
      title="Change Orders"
      icon={<FileSpreadsheet className="w-4 h-4" />}
      count={changeOrders.length}
    >
      {changeOrders.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No change orders.</p>
      ) : (
        <ul className="space-y-2" role="list">
          {changeOrders.map((co) => (
            <li
              key={co.coNumber}
              className="flex items-start justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 font-mono tabular-nums">
                  {co.coNumber}
                </p>
                <p className="text-[11px] text-gray-700 mt-0.5 line-clamp-2">
                  {co.summary}
                </p>
              </div>
              <a
                href={co.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View change order ${co.coNumber} PDF in a new tab`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3" aria-hidden />
                View PDF
              </a>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  )
}

// ── Plan sets ───────────────────────────────────────────────────────────

function PlanSetsCard({ planSets }: { planSets: PlanSet[] }) {
  const byGroup = [1, 2].map((g) => ({
    group: g as 1 | 2,
    items: planSets.filter((p) => p.group === g),
  }))

  return (
    <PanelCard
      title="Plan Sets"
      icon={<Layers className="w-4 h-4" />}
      count={planSets.length}
    >
      {planSets.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No plan sets uploaded.</p>
      ) : (
        <div className="space-y-3">
          {byGroup.map(({ group, items }) => (
            <div key={group}>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Group {group}
              </p>
              {items.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">
                  None in Group {group}.
                </p>
              ) : (
                <ul className="space-y-1.5" role="list">
                  {items.map((p, i) => (
                    <li
                      key={`${p.url}-${i}`}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                        Uploaded {formatRelative(p.uploadedAt)}
                      </span>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Download Group ${group} plan set`}
                        download
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
                      >
                        <Download className="w-3 h-3" aria-hidden />
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  )
}
