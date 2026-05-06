/**
 * /admin/pitch-generator/[id] — single PitchRun detail.
 *
 * Server-rendered. Reads PitchRun + Prospect + last 20 audit entries via
 * $queryRawUnsafe.
 *
 * Approve / reject / mark-sent are submitted via inline server actions
 * that proxy to /api/admin/pitch-runs/[id] (Agent B owns the API). Server
 * actions keep this file a single server component (no client islands
 * needed).
 *
 * Status polling: when status is QUEUED or GENERATING we add a
 * meta-refresh of 8s so the page re-renders without JS until the run flips
 * to PREVIEW / FAILED. Matches the inbox polling pattern.
 *
 * Auth: SALES_REP / BD_MANAGER / MANAGER can view + mark-sent.
 *       ADMIN-only sees Approve / Reject controls.
 *
 * Feature flag: NEXT_PUBLIC_FEATURE_PITCH_GENERATOR_ENABLED.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers, cookies } from 'next/headers'
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Send,
  Clock,
  ExternalLink,
} from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getStaffSession } from '@/lib/staff-auth'
import { parseRoles } from '@/lib/permissions'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PitchRunDetail {
  id: string
  prospectId: string
  companyName: string
  style: string
  layout: string
  elements: string[]
  status: string
  previewUrl: string | null
  htmlContent: string | null
  emailDraft: string | null
  errorMessage: string | null
  costEstimate: number | null
  generatedBy: string | null
  generatedByName: string | null
  approvedBy: string | null
  approvedByName: string | null
  approvedAt: Date | null
  sentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface AuditRow {
  id: string
  action: string
  staffId: string | null
  staffName: string | null
  details: Record<string, unknown> | null
  createdAt: Date
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'APPROVED':
    case 'SENT':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    case 'PREVIEW':
      return 'bg-c1/15 text-c1 border-c1/30'
    case 'QUEUED':
    case 'GENERATING':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'FAILED':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    default:
      return 'bg-white/10 text-fg-muted border-glass-border'
  }
}

function styleBadgeClass(style: string): string {
  switch (style) {
    case 'HERITAGE':
      return 'bg-amber-700/15 text-amber-200 border-amber-700/30'
    case 'EXECUTIVE':
      return 'bg-slate-500/15 text-slate-200 border-slate-500/30'
    case 'BUILDER_FIELD':
      return 'bg-orange-500/15 text-orange-200 border-orange-500/30'
    default:
      return 'bg-white/10 text-fg-muted border-glass-border'
  }
}

async function fetchPitchRun(id: string): Promise<PitchRunDetail | null> {
  try {
    const rows: PitchRunDetail[] = await prisma.$queryRawUnsafe(
      `SELECT
         pr."id",
         pr."prospectId",
         p."companyName",
         pr."style",
         pr."layout",
         pr."elements",
         pr."status",
         pr."previewUrl",
         pr."htmlContent",
         pr."emailDraft",
         pr."errorMessage",
         pr."costEstimate"::float AS "costEstimate",
         pr."generatedBy",
         (s1."firstName" || ' ' || s1."lastName") AS "generatedByName",
         pr."approvedBy",
         (s2."firstName" || ' ' || s2."lastName") AS "approvedByName",
         pr."approvedAt",
         pr."sentAt",
         pr."createdAt",
         pr."updatedAt"
       FROM "PitchRun" pr
       JOIN "Prospect" p ON p."id" = pr."prospectId"
       LEFT JOIN "Staff" s1 ON s1."id" = pr."generatedBy"
       LEFT JOIN "Staff" s2 ON s2."id" = pr."approvedBy"
       WHERE pr."id" = $1
       LIMIT 1`,
      id
    )
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function fetchAuditRows(id: string): Promise<AuditRow[]> {
  try {
    const rows: AuditRow[] = await prisma.$queryRawUnsafe(
      `SELECT
         a."id",
         a."action",
         a."staffId",
         (a."details"->>'staffName') AS "staffName",
         a."details",
         a."createdAt"
       FROM "AuditLog" a
       WHERE a."entity" = 'PitchRun' AND a."entityId" = $1
       ORDER BY a."createdAt" DESC
       LIMIT 20`,
      id
    )
    return rows
  } catch {
    return []
  }
}

// ── Server actions: proxy to Agent B's API route ────────────────────────
// We POST to /api/admin/pitch-runs/[id] via fetch on the server so the
// API stays the single source of truth for action validation. After the
// call we revalidate this page so the new status renders on the redirect.

async function dispatchAction(id: string, action: 'approve' | 'reject' | 'mark_sent') {
  'use server'

  const hdrs = await headers()
  const cookieStore = await cookies()
  const proto =
    hdrs.get('x-forwarded-proto') ||
    (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const host =
    hdrs.get('x-forwarded-host') ||
    hdrs.get('host') ||
    `localhost:${process.env.PORT || 3000}`
  const url = `${proto}://${host}/api/admin/pitch-runs/${id}`

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: cookieStore.toString(),
    },
    body: JSON.stringify({ action }),
    cache: 'no-store',
  })

  revalidatePath(`/admin/pitch-generator/${id}`)
}

async function approveAction(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  await dispatchAction(id, 'approve')
}

async function rejectAction(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  await dispatchAction(id, 'reject')
}

async function markSentAction(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  await dispatchAction(id, 'mark_sent')
}

// ── Render ────────────────────────────────────────────────────────────────

export default async function PitchRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  if (process.env.NEXT_PUBLIC_FEATURE_PITCH_GENERATOR_ENABLED !== 'true') {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">Pitch generator</h1>
        <div className="glass-card p-6 border border-glass-border rounded-lg space-y-3">
          <p className="text-fg">The pitch generator is disabled.</p>
          <p className="text-sm text-fg-muted">
            Set{' '}
            <code className="text-c1">
              NEXT_PUBLIC_FEATURE_PITCH_GENERATOR_ENABLED=true
            </code>{' '}
            to enable. See <code className="text-c1">.env.example</code>.
          </p>
        </div>
      </div>
    )
  }

  const session = await getStaffSession()
  if (!session) {
    redirect(`/staff/login?redirect=/admin/pitch-generator/${id}`)
  }

  const roles = parseRoles(session.roles || session.role)
  const isAdmin = roles.includes('ADMIN')
  const canSee =
    isAdmin ||
    roles.includes('MANAGER') ||
    roles.includes('SALES_REP')

  if (!canSee) {
    return (
      <div className="text-center py-12 text-fg-muted">
        You do not have permission to view this pitch.
      </div>
    )
  }

  const run = await fetchPitchRun(id)
  if (!run) notFound()

  const audit = await fetchAuditRows(id)
  const isInProgress = run.status === 'QUEUED' || run.status === 'GENERATING'

  return (
    <div className="space-y-6">
      {/* Auto-refresh while generating; no JS required. */}
      {isInProgress && <meta httpEquiv="refresh" content="8" />}

      {/* Breadcrumb */}
      <Link
        href="/admin/pitch-generator"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg transition w-fit"
      >
        <ChevronLeft className="w-4 h-4" />
        Pitches
      </Link>

      {/* Header */}
      <div className="glass-card border border-glass-border rounded-lg p-5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-fg">{run.companyName}</h1>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              <span
                className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${styleBadgeClass(run.style)}`}
              >
                {run.style}
              </span>
              <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded border border-glass-border bg-white/5 text-fg-muted">
                {run.layout}
              </span>
              <span
                className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${statusBadgeClass(run.status)}`}
              >
                {run.status}
              </span>
              <Link
                href={`/admin/prospects/${run.prospectId}`}
                className="inline-flex items-center gap-1 text-xs text-c1 hover:underline"
              >
                Prospect <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
          <div className="text-sm text-fg-muted space-y-0.5 lg:text-right">
            <div>
              <span className="text-fg-muted">Cost:</span>{' '}
              <span className="font-mono text-fg">
                {run.costEstimate != null
                  ? `$${run.costEstimate.toFixed(2)}`
                  : '—'}
              </span>
            </div>
            <div>
              <span className="text-fg-muted">Generated by:</span>{' '}
              <span className="text-fg">
                {run.generatedByName || (run.generatedBy ? 'Auto' : 'System')}
              </span>
            </div>
            <div>
              <span className="text-fg-muted">Created:</span>{' '}
              <span className="text-fg">{formatDate(run.createdAt)}</span>
            </div>
            {run.approvedAt && (
              <div>
                <span className="text-fg-muted">Approved:</span>{' '}
                <span className="text-fg">{formatDate(run.approvedAt)}</span>
                {run.approvedByName ? ` by ${run.approvedByName}` : ''}
              </div>
            )}
            {run.sentAt && (
              <div>
                <span className="text-fg-muted">Sent:</span>{' '}
                <span className="text-fg">{formatDate(run.sentAt)}</span>
              </div>
            )}
          </div>
        </div>

        {run.elements?.length > 0 && (
          <div className="text-xs text-fg-muted">
            Elements:{' '}
            <span className="text-fg-muted/80">{run.elements.join(' · ')}</span>
          </div>
        )}
      </div>

      {/* In-progress / failed banners */}
      {isInProgress && (
        <div className="glass-card p-5 border border-amber-500/30 bg-amber-500/5 rounded-lg flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-300 animate-pulse" />
          <div>
            <div className="font-semibold text-fg">Generating...</div>
            <div className="text-sm text-fg-muted">
              Estimated 30–90 seconds. This page auto-refreshes.
            </div>
          </div>
        </div>
      )}

      {run.status === 'FAILED' && run.errorMessage && (
        <div className="glass-card p-5 border border-rose-500/30 bg-rose-500/10 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-rose-200 font-semibold">
            <XCircle className="w-5 h-5" />
            Generation failed
          </div>
          <pre className="text-sm text-rose-200/90 whitespace-pre-wrap font-mono">
            {run.errorMessage}
          </pre>
        </div>
      )}

      {/* Preview */}
      {(run.status === 'PREVIEW' ||
        run.status === 'APPROVED' ||
        run.status === 'SENT') && (
        <section className="glass-card border border-glass-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-glass-border flex items-center justify-between">
            <h2 className="text-lg font-semibold text-fg">Preview</h2>
            {run.previewUrl && (
              <a
                href={run.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-c1 hover:underline"
              >
                Open in new tab <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {run.previewUrl ? (
            <iframe
              src={run.previewUrl}
              className="w-full h-[800px] bg-white"
              title={`${run.companyName} pitch preview`}
            />
          ) : run.htmlContent ? (
            <div>
              <div className="px-5 py-2 bg-amber-500/5 text-xs text-amber-300 border-b border-amber-500/20">
                Vercel deploy unavailable — falling back to inline HTML.
              </div>
              <iframe
                srcDoc={run.htmlContent}
                className="w-full h-[800px] bg-white"
                title={`${run.companyName} pitch preview (inline)`}
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="p-8 text-center text-fg-muted">
              No preview available yet.
            </div>
          )}
        </section>
      )}

      {/* Email draft */}
      {run.emailDraft && (
        <section className="glass-card border border-glass-border rounded-lg p-5 space-y-3">
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-fg">Email draft</h2>
            <span className="text-xs text-fg-muted">
              Click into the field and press{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-glass-border text-fg font-mono text-[10px]">
                Ctrl
              </kbd>{' '}
              +{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-glass-border text-fg font-mono text-[10px]">
                A
              </kbd>{' '}
              to select.
            </span>
          </header>
          <textarea
            readOnly
            value={run.emailDraft}
            rows={Math.min(20, Math.max(8, run.emailDraft.split('\n').length + 2))}
            className="w-full bg-canvas/60 border border-glass-border rounded-md p-4 text-sm text-fg font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-c1/40 resize-y"
          />
        </section>
      )}

      {/* Actions */}
      <section className="glass-card border border-glass-border rounded-lg p-5 space-y-4">
        <h2 className="text-lg font-semibold text-fg">Actions</h2>

        {run.status === 'PREVIEW' && isAdmin && (
          <div className="flex flex-wrap gap-3">
            <form action={approveAction}>
              <input type="hidden" name="id" value={run.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500 text-canvas font-medium hover:bg-emerald-500/90 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve
              </button>
            </form>
            <form action={rejectAction}>
              <input type="hidden" name="id" value={run.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-rose-500 text-canvas font-medium hover:bg-rose-500/90 transition"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            </form>
          </div>
        )}

        {run.status === 'PREVIEW' && !isAdmin && (
          <div className="text-sm text-fg-muted">
            Approve / reject is ADMIN-only. Ask Nate to review.
          </div>
        )}

        {run.status === 'APPROVED' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <button
                disabled
                title="Manual send for now; mailer integration coming Phase 2"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white/5 text-fg-muted border border-glass-border cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                Send via Resend
              </button>
              <form action={markSentAction}>
                <input type="hidden" name="id" value={run.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-c1 text-canvas font-medium hover:bg-c1/90 transition"
                >
                  <Send className="w-4 h-4" />
                  Mark sent
                </button>
              </form>
            </div>
            <div className="text-xs text-fg-muted">
              Manual send for now; mailer integration coming Phase 2.
            </div>
          </div>
        )}

        {run.status === 'SENT' && (
          <div className="text-sm text-emerald-300 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Pitch marked as sent.
          </div>
        )}

        {run.status === 'FAILED' && (
          <div className="text-sm text-fg-muted">
            Generation failed — see error above. Start a new pitch from the list
            page.
          </div>
        )}

        {isInProgress && (
          <div className="text-sm text-fg-muted inline-flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Actions become available once generation finishes.
          </div>
        )}
      </section>

      {/* Audit history */}
      <section className="glass-card border border-glass-border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold text-fg">Audit history</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-fg-muted">No audit entries yet.</p>
        ) : (
          <ul className="divide-y divide-glass-border/40">
            {audit.map((a) => (
              <li
                key={a.id}
                className="py-2 flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs text-fg-muted">
                    {a.action}
                  </span>
                  <span className="text-fg-muted truncate">
                    {a.staffName || a.staffId || 'system'}
                  </span>
                </div>
                <div className="text-xs text-fg-muted whitespace-nowrap">
                  {formatDate(a.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

