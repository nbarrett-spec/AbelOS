// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/activity
//
// "What changed since I last looked" feed for a PM. Merges events from four
// sources into one sorted stream, scoped to jobs assigned to the current
// staffId (via x-staff-id header). READ-ONLY.
//
//   Sources (each in its own try/catch — degrade silently if a table is
//   missing from an older snapshot):
//     • AuditLog          — entity transitions on Job / ChangeOrder /
//                            Task / InventoryAllocation / Delivery
//     • CommunicationLog  — inbound Gmail threads correlated to PM's jobs
//     • HyphenDocument    — new red_lines / change_orders / schedules
//     • InboxItem         — agent-generated alerts assigned to the PM
//
//   Query params:
//     since=ISO     default: NOW - 24h
//     limit=N       default: 100  (absolute cap after merge)
//     types=...     CSV filter — includes only matching event kinds
//
//   Response shape (see ActivityResponse below).
//
//   Auth: checkStaffAuth. 401 if no x-staff-id.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { logAudit } from '@/lib/audit'

// ── Event kinds ───────────────────────────────────────────────────────────────
// Keep these stable — the client renders an icon per kind.
export type ActivityKind =
  | 'CO_RECEIVED'            // Hyphen change_order_detail OR AuditLog entity=change_order
  | 'CO_UPDATED'             // AuditLog action=update on change_order
  | 'MATERIAL_RED'           // Allocation flipped to BACKORDERED
  | 'MATERIAL_GREEN'         // Allocation flipped to PICKED/CONSUMED (ready)
  | 'MATERIAL_AMBER'         // Allocation change not ready and not shortage
  | 'EMAIL_IN'               // Inbound CommunicationLog (builder email)
  | 'TASK_ASSIGNED'          // AuditLog action=create on Task
  | 'TASK_COMPLETED'         // AuditLog action=update where status->DONE/COMPLETE
  | 'DELIVERY_STARTED'       // AuditLog entity=Delivery action=dispatch/start
  | 'DELIVERY_DONE'          // AuditLog entity=Delivery action=complete/deliver
  | 'INSTALL_STARTED'        // AuditLog entity=Job action includes install_started
  | 'INSTALL_COMPLETED'      // AuditLog entity=Job action includes install_completed
  | 'PO_RECEIVED'            // AuditLog entity=PurchaseOrder action=receive
  | 'RED_LINE'               // Hyphen red_line doc
  | 'PLAN_DOCUMENT'          // Hyphen plan_document
  | 'CLOSING_DATE_CHANGED'   // Hyphen closing_date
  | 'SCHEDULE_CHANGE'        // Hyphen job_schedule_detail
  | 'INBOX_ALERT'            // InboxItem scoped to PM
  | 'JOB_STATUS_CHANGE'      // AuditLog entity=Job action=status_change

export type ActivitySeverity = 'info' | 'warn' | 'alert'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  at: string                  // ISO timestamp
  jobId: string | null
  jobNumber: string | null
  builderName: string | null
  community: string | null
  title: string
  summary: string | null
  href: string | null
  severity: ActivitySeverity
}

export interface ActivityResponse {
  staffId: string
  sinceIso: string
  total: number
  events: ActivityEvent[]
  sources: {
    audit: number
    email: number
    hyphen: number
    inbox: number
    truncated: Record<string, number>
  }
}

// ── Source weighting caps ─────────────────────────────────────────────────────
// Prevents a single noisy stream (e.g. 500 inbound emails in 24h) from
// drowning out the others. Each source is capped independently BEFORE the
// final sort-and-slice by `limit`.
const SOURCE_CAPS = {
  audit: 200,
  email: 100,
  hyphen: 100,
  inbox: 100,
} as const

const DEFAULT_LIMIT = 100
const HARD_MAX_LIMIT = 500
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function parseSince(raw: string | null): Date {
  if (raw) {
    const d = new Date(raw)
    if (Number.isFinite(d.getTime())) return d
  }
  return new Date(Date.now() - DEFAULT_WINDOW_MS)
}

function parseTypes(raw: string | null): Set<ActivityKind> | null {
  if (!raw) return null
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  if (parts.length === 0) return null
  return new Set(parts as ActivityKind[])
}

// Stable id generator — AuditLog.id is already unique, but emails/hyphen/inbox
// can reuse their own primary key. Prefix with source for safety.
function evId(prefix: string, inner: string): string {
  return `${prefix}:${inner}`
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  if (!staffId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const url = new URL(request.url)
  const since = parseSince(url.searchParams.get('since'))
  const sinceIso = since.toISOString()
  const limit = clamp(
    Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT,
    1,
    HARD_MAX_LIMIT,
  )
  const typesFilter = parseTypes(url.searchParams.get('types'))

  try {
    // ── Scope: all jobs assigned to this PM ──────────────────────────────────
    const jobs = await prisma.job.findMany({
      where: { assignedPMId: staffId },
      select: {
        id: true,
        jobNumber: true,
        builderName: true,
        community: true,
      },
    })

    const jobIndex = new Map<
      string,
      { jobNumber: string; builderName: string; community: string | null }
    >()
    const jobIds: string[] = []
    for (const j of jobs) {
      jobIds.push(j.id)
      jobIndex.set(j.id, {
        jobNumber: j.jobNumber,
        builderName: j.builderName,
        community: j.community,
      })
    }

    const jobMeta = (id: string | null) => {
      if (!id) return { jobNumber: null, builderName: null, community: null }
      const m = jobIndex.get(id)
      return m
        ? {
            jobNumber: m.jobNumber,
            builderName: m.builderName,
            community: m.community,
          }
        : { jobNumber: null, builderName: null, community: null }
    }

    // Early-exit: PM owns no jobs → return an empty (but well-formed) response.
    if (jobIds.length === 0) {
      const empty: ActivityResponse = {
        staffId,
        sinceIso,
        total: 0,
        events: [],
        sources: {
          audit: 0,
          email: 0,
          hyphen: 0,
          inbox: 0,
          truncated: {},
        },
      }
      return safeJson(empty)
    }

    const truncated: Record<string, number> = {}
    const events: ActivityEvent[] = []

    // ── 1. AuditLog ──────────────────────────────────────────────────────────
    // Scan entries since `since` where entity is one of the PM-relevant
    // entities AND entityId is in the PM's job scope. For entity='Job' we
    // match entityId directly; for ChangeOrder/Task/Delivery/InventoryAllocation
    // we pull rows tied to the PM's jobIds via the source tables first, then
    // filter AuditLog by those entityIds. This keeps a single cheap scan.
    let auditCount = 0
    try {
      // Gather child entity ids scoped to PM's jobs so AuditLog scan is bounded.
      const [cos, tasks, allocs, deliveries] = await Promise.all([
        prisma.changeOrder.findMany({
          where: { jobId: { in: jobIds } },
          select: { id: true, jobId: true },
        }),
        prisma.task.findMany({
          where: { jobId: { in: jobIds } },
          select: { id: true, jobId: true },
        }),
        prisma.inventoryAllocation.findMany({
          where: { jobId: { in: jobIds } },
          select: { id: true, jobId: true },
        }),
        // Delivery: might not link directly to jobId in schema — safe to skip
        // failures silently.
        prisma.delivery
          .findMany({
            where: { jobId: { in: jobIds } },
            select: { id: true, jobId: true },
          })
          .catch(() => [] as Array<{ id: string; jobId: string | null }>),
      ])

      const entityJobMap = new Map<string, string>()
      for (const c of cos) if (c.jobId) entityJobMap.set(`ChangeOrder:${c.id}`, c.jobId)
      for (const t of tasks) if (t.jobId) entityJobMap.set(`Task:${t.id}`, t.jobId)
      for (const a of allocs) if (a.jobId) entityJobMap.set(`InventoryAllocation:${a.id}`, a.jobId)
      for (const d of deliveries) if (d.jobId) entityJobMap.set(`Delivery:${d.id}`, d.jobId)

      const childIds = [
        ...cos.map((c) => c.id),
        ...tasks.map((t) => t.id),
        ...allocs.map((a) => a.id),
        ...deliveries.map((d) => d.id),
      ]

      // Combine: AuditLog rows for Job entity (scoped to PM's jobIds) OR
      // for child entities (scoped to childIds). entity is a free-form string
      // historically; normalize both PascalCase and lower_snake when filtering.
      const allEntityIds = [...jobIds, ...childIds]

      const auditRows = await prisma.auditLog.findMany({
        where: {
          createdAt: { gte: since },
          entityId: { in: allEntityIds },
        },
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          details: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_CAPS.audit + 1, // +1 to detect truncation
      })

      if (auditRows.length > SOURCE_CAPS.audit) {
        truncated.audit = auditRows.length - SOURCE_CAPS.audit
      }

      for (const row of auditRows.slice(0, SOURCE_CAPS.audit)) {
        // Figure out which jobId this row belongs to.
        const ent = (row.entity || '').toLowerCase()
        let jobId: string | null = null

        if (ent === 'job' && row.entityId && jobIndex.has(row.entityId)) {
          jobId = row.entityId
        } else {
          // child entity — look up via map (case variants)
          const candidates = [
            `ChangeOrder:${row.entityId}`,
            `Task:${row.entityId}`,
            `InventoryAllocation:${row.entityId}`,
            `Delivery:${row.entityId}`,
          ]
          for (const c of candidates) {
            const mapped = entityJobMap.get(c)
            if (mapped) {
              jobId = mapped
              break
            }
          }
        }

        if (!jobId) continue // defensive — shouldn't happen after the scope filter

        const action = (row.action || '').toLowerCase()
        const details = (row.details || {}) as Record<string, any>

        // Classify into an ActivityKind
        let kind: ActivityKind | null = null
        let severity: ActivitySeverity = 'info'
        let title = ''
        let summary: string | null = null
        let href: string | null = `/ops/jobs/${jobId}`

        if (ent === 'changeorder' || ent === 'change_order') {
          kind = action.includes('create') || action.includes('receive')
            ? 'CO_RECEIVED'
            : 'CO_UPDATED'
          severity = 'warn'
          title = `Change Order ${details.changeNumber ? `#${details.changeNumber}` : ''}`.trim() || 'Change Order'
          summary = details.reason || details.description || null
          href = `/ops/jobs/${jobId}?tab=change-orders`
        } else if (ent === 'inventoryallocation' || ent === 'inventory_allocation' || ent === 'material_status') {
          const newStatus = String(details.newStatus || details.status || '').toUpperCase()
          if (newStatus === 'BACKORDERED') {
            kind = 'MATERIAL_RED'
            severity = 'alert'
            title = 'Material shortage'
            summary = 'Allocation moved to BACKORDERED.'
          } else if (newStatus === 'PICKED' || newStatus === 'CONSUMED') {
            kind = 'MATERIAL_GREEN'
            severity = 'info'
            title = `Material ${newStatus.toLowerCase()}`
            summary = details.productName || null
          } else {
            kind = 'MATERIAL_AMBER'
            severity = 'info'
            title = `Material ${newStatus.toLowerCase() || 'update'}`
            summary = details.productName || null
          }
          href = `/ops/jobs/${jobId}?tab=materials`
        } else if (ent === 'task') {
          if (action.includes('create')) {
            kind = 'TASK_ASSIGNED'
            severity = 'info'
            title = details.title ? `Task: ${details.title}` : 'Task assigned'
            summary = details.description || null
          } else {
            const newStatus = String(details.newStatus || details.status || '').toUpperCase()
            if (newStatus === 'DONE' || newStatus === 'COMPLETE') {
              kind = 'TASK_COMPLETED'
              severity = 'info'
              title = details.title ? `Task done: ${details.title}` : 'Task completed'
            } else {
              // not actionable for feed
              kind = null
            }
          }
          href = `/ops/jobs/${jobId}?tab=tasks`
        } else if (ent === 'delivery') {
          if (action.includes('complete') || action.includes('deliver')) {
            kind = 'DELIVERY_DONE'
            severity = 'info'
            title = 'Delivery complete'
          } else if (action.includes('dispatch') || action.includes('start') || action.includes('load')) {
            kind = 'DELIVERY_STARTED'
            severity = 'info'
            title = 'Delivery started'
          }
          summary = details.driverName || details.notes || null
          href = `/ops/jobs/${jobId}?tab=deliveries`
        } else if (ent === 'job') {
          if (action.includes('install_started') || action.includes('installing')) {
            kind = 'INSTALL_STARTED'
            severity = 'info'
            title = 'Install started'
          } else if (action.includes('install_completed') || action.includes('installed')) {
            kind = 'INSTALL_COMPLETED'
            severity = 'info'
            title = 'Install complete'
          } else if (action.includes('status')) {
            kind = 'JOB_STATUS_CHANGE'
            severity = 'info'
            const to = details.newStatus || details.to || details.status
            title = to ? `Status → ${String(to).replace(/_/g, ' ')}` : 'Status changed'
          }
        } else if (ent === 'purchaseorder' || ent === 'purchase_order') {
          if (action.includes('receive') || action.includes('received')) {
            kind = 'PO_RECEIVED'
            severity = 'info'
            title = details.poNumber ? `PO received: ${details.poNumber}` : 'PO received'
            summary = details.vendorName || null
            href = `/ops/jobs/${jobId}?tab=materials`
          }
        }

        if (!kind) continue
        if (typesFilter && !typesFilter.has(kind)) continue

        const meta = jobMeta(jobId)
        events.push({
          id: evId('audit', row.id),
          kind,
          at: row.createdAt.toISOString(),
          jobId,
          jobNumber: meta.jobNumber,
          builderName: meta.builderName,
          community: meta.community,
          title,
          summary,
          href,
          severity,
        })
        auditCount++
      }
    } catch (e) {
      console.warn('[PM Activity] AuditLog source skipped:', e)
    }

    // ── 2. CommunicationLog (inbound emails) ─────────────────────────────────
    let emailCount = 0
    try {
      const emails = await prisma.communicationLog.findMany({
        where: {
          jobId: { in: jobIds },
          direction: 'INBOUND',
          createdAt: { gte: since },
        },
        select: {
          id: true,
          jobId: true,
          subject: true,
          fromAddress: true,
          aiSummary: true,
          channel: true,
          createdAt: true,
          sentAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_CAPS.email + 1,
      })

      if (emails.length > SOURCE_CAPS.email) {
        truncated.email = emails.length - SOURCE_CAPS.email
      }

      for (const e of emails.slice(0, SOURCE_CAPS.email)) {
        if (!e.jobId) continue
        if (typesFilter && !typesFilter.has('EMAIL_IN')) continue
        const meta = jobMeta(e.jobId)
        events.push({
          id: evId('email', e.id),
          kind: 'EMAIL_IN',
          at: (e.sentAt ?? e.createdAt).toISOString(),
          jobId: e.jobId,
          jobNumber: meta.jobNumber,
          builderName: meta.builderName,
          community: meta.community,
          title: e.subject || `Email from ${e.fromAddress || 'builder'}`,
          summary: e.aiSummary || e.fromAddress || null,
          href: `/ops/jobs/${e.jobId}?tab=communications`,
          severity: 'info',
        })
        emailCount++
      }
    } catch (e) {
      console.warn('[PM Activity] CommunicationLog source skipped:', e)
    }

    // ── 3. HyphenDocument ─────────────────────────────────────────────────────
    let hyphenCount = 0
    try {
      const hyphenRows = await prisma.hyphenDocument.findMany({
        where: {
          jobId: { in: jobIds },
          createdAt: { gte: since },
        },
        select: {
          id: true,
          jobId: true,
          eventType: true,
          fileName: true,
          coNumber: true,
          coReason: true,
          coNetValueChange: true,
          closingDate: true,
          createdAt: true,
          docCategory: true,
        },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_CAPS.hyphen + 1,
      })

      if (hyphenRows.length > SOURCE_CAPS.hyphen) {
        truncated.hyphen = hyphenRows.length - SOURCE_CAPS.hyphen
      }

      for (const row of hyphenRows.slice(0, SOURCE_CAPS.hyphen)) {
        if (!row.jobId) continue
        let kind: ActivityKind | null = null
        let severity: ActivitySeverity = 'info'
        let title = ''
        let summary: string | null = null
        const et = (row.eventType || '').toLowerCase()
        if (et === 'change_order_detail' || et.includes('change_order')) {
          kind = 'CO_RECEIVED'
          severity = 'warn'
          title = row.coNumber ? `CO #${row.coNumber}` : 'Change Order received'
          summary = row.coReason
            ? `${row.coReason}${row.coNetValueChange ? ` · $${row.coNetValueChange.toString()}` : ''}`
            : row.coNetValueChange
              ? `Net change: $${row.coNetValueChange.toString()}`
              : null
        } else if (et === 'red_line' || et.includes('red_line')) {
          kind = 'RED_LINE'
          severity = 'warn'
          title = 'Red line received'
          summary = row.fileName || null
        } else if (et === 'plan_document' || et.includes('plan')) {
          kind = 'PLAN_DOCUMENT'
          severity = 'info'
          title = 'Plan document received'
          summary = row.fileName || null
        } else if (et === 'closing_date' || et.includes('closing')) {
          kind = 'CLOSING_DATE_CHANGED'
          severity = 'info'
          title = 'Closing date updated'
          summary = row.closingDate
            ? new Date(row.closingDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : null
        } else if (et === 'job_schedule_detail' || et.includes('schedule')) {
          kind = 'SCHEDULE_CHANGE'
          severity = 'info'
          title = 'Schedule updated'
          summary = row.docCategory || null
        }
        if (!kind) continue
        if (typesFilter && !typesFilter.has(kind)) continue

        const meta = jobMeta(row.jobId)
        events.push({
          id: evId('hyphen', row.id),
          kind,
          at: row.createdAt.toISOString(),
          jobId: row.jobId,
          jobNumber: meta.jobNumber,
          builderName: meta.builderName,
          community: meta.community,
          title,
          summary,
          href: `/ops/jobs/${row.jobId}?tab=documents`,
          severity,
        })
        hyphenCount++
      }
    } catch (e) {
      console.warn('[PM Activity] HyphenDocument source skipped:', e)
    }

    // ── 4. InboxItem (agent alerts) ──────────────────────────────────────────
    let inboxCount = 0
    try {
      const inboxRows = await prisma.inboxItem.findMany({
        where: {
          createdAt: { gte: since },
          OR: [
            { assignedTo: staffId },
            // Also include items tied to the PM's jobs via entityType/entityId
            {
              entityType: { in: ['Job', 'job'] },
              entityId: { in: jobIds },
            },
          ],
        },
        select: {
          id: true,
          type: true,
          source: true,
          title: true,
          description: true,
          priority: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_CAPS.inbox + 1,
      })

      if (inboxRows.length > SOURCE_CAPS.inbox) {
        truncated.inbox = inboxRows.length - SOURCE_CAPS.inbox
      }

      for (const row of inboxRows.slice(0, SOURCE_CAPS.inbox)) {
        if (typesFilter && !typesFilter.has('INBOX_ALERT')) continue
        const priority = (row.priority || 'MEDIUM').toUpperCase()
        const severity: ActivitySeverity =
          priority === 'CRITICAL' ? 'alert' : priority === 'HIGH' ? 'warn' : 'info'

        // Link to the job if we can
        let jobId: string | null = null
        const et = (row.entityType || '').toLowerCase()
        if ((et === 'job') && row.entityId && jobIndex.has(row.entityId)) {
          jobId = row.entityId
        }
        const meta = jobMeta(jobId)

        events.push({
          id: evId('inbox', row.id),
          kind: 'INBOX_ALERT',
          at: row.createdAt.toISOString(),
          jobId,
          jobNumber: meta.jobNumber,
          builderName: meta.builderName,
          community: meta.community,
          title: row.title,
          summary: row.description || `${row.source} · ${row.type}`,
          href: jobId ? `/ops/jobs/${jobId}` : '/ops/inbox',
          severity,
        })
        inboxCount++
      }
    } catch (e) {
      console.warn('[PM Activity] InboxItem source skipped:', e)
    }

    // ── Merge + sort DESC by time ────────────────────────────────────────────
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const sliced = events.slice(0, limit)

    const body: ActivityResponse = {
      staffId,
      sinceIso,
      total: sliced.length,
      events: sliced,
      sources: {
        audit: auditCount,
        email: emailCount,
        hyphen: hyphenCount,
        inbox: inboxCount,
        truncated,
      },
    }

    // Audit the view — fire-and-forget, same pattern as /pm/roster + /pm/book.
    logAudit({
      staffId,
      action: 'VIEW',
      entity: 'PMActivityFeed',
      entityId: staffId,
      details: {
        sinceIso,
        limit,
        total: sliced.length,
        byKind: Object.fromEntries(
          sliced.reduce((acc, ev) => {
            acc.set(ev.kind, (acc.get(ev.kind) ?? 0) + 1)
            return acc
          }, new Map<string, number>()),
        ),
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'INFO',
    }).catch(() => {
      /* non-blocking */
    })

    return safeJson(body)
  } catch (error: any) {
    console.error('[PM Activity] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load PM activity feed.', detail: error?.message },
      { status: 500 },
    )
  }
}
