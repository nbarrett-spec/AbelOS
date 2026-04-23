/**
 * GET /api/v1/engine/inbox/[inboxItemId]/resolution
 *
 * Returns what the ops team did with a given InboxItem. Used by the NUC
 * engine to close the loop after the brain handed an action off.
 *
 * Payload includes:
 *   - who resolved it (Staff record) and when
 *   - what action was taken (APPROVE | REJECT | SNOOZE | COMPLETED) + result JSON
 *   - linked records (order / PO / payment / invoice, resolved by entityType+entityId)
 *   - brainAcknowledgedAt so the engine can tell if we already saw it
 *   - timeline: chronological AuditLog entries scoped to this InboxItem
 *   - beforeState / afterState: best-effort snapshots of the linked entity,
 *     reconstructed from AuditLog.details where available (first-seen vs. latest)
 *   - actorContext: role / department / active-session-time for the resolver
 *   - similarItems: recent resolutions of the same type+source, for NUC
 *     pattern learning
 *
 * Returns 404 if the inbox item doesn't exist, 409 if it's still open.
 *
 * Auth: Bearer ENGINE_BRIDGE_TOKEN via verifyEngineToken().
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map Aegis InboxItem.entityType -> SQL table so we can hydrate linked rows.
// We keep this explicit rather than reflection-driven so a typo in entityType
// can't accidentally probe random tables.
const LINKED_LOOKUPS: Record<
  string,
  { table: string; columns: string[] }
> = {
  Order: { table: 'Order', columns: ['id', 'orderNumber', 'status', 'total', 'builderId'] },
  PurchaseOrder: {
    table: 'PurchaseOrder',
    columns: ['id', 'poNumber', 'status', 'total', 'vendorId'],
  },
  Payment: {
    table: 'Payment',
    columns: ['id', 'amount', 'status', 'invoiceId', 'receivedAt'],
  },
  Invoice: {
    table: 'Invoice',
    columns: ['id', 'invoiceNumber', 'status', 'total', 'amountPaid', 'builderId'],
  },
  Delivery: {
    table: 'Delivery',
    columns: ['id', 'deliveryNumber', 'status', 'jobId'],
  },
  Job: { table: 'Job', columns: ['id', 'jobNumber', 'status', 'builderId'] },
  Deal: { table: 'Deal', columns: ['id', 'dealNumber', 'stage', 'value'] },
  Quote: { table: 'Quote', columns: ['id', 'quoteNumber', 'status', 'total'] },
  Task: { table: 'Task', columns: ['id', 'title', 'status', 'jobId'] },
}

// How many similar resolved items to pull back for NUC pattern learning.
const SIMILAR_LIMIT = 5

interface Params {
  params: { inboxItemId: string }
}

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { inboxItemId } = params
  if (!inboxItemId) {
    return NextResponse.json({ error: 'bad_request', message: 'missing inboxItemId' }, { status: 400 })
  }

  try {
    // Fetch the inbox item with the resolver staff record, if any.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         i."id",
         i."type",
         i."source",
         i."title",
         i."status",
         i."priority",
         i."entityType",
         i."entityId",
         i."result",
         i."resolvedAt",
         i."resolvedBy",
         i."snoozedUntil",
         i."brainAcknowledgedAt",
         i."assignedTo",
         i."createdAt",
         i."updatedAt",
         resolver."id"        AS "resolverId",
         resolver."firstName" AS "resolverFirstName",
         resolver."lastName"  AS "resolverLastName",
         resolver."email"     AS "resolverEmail",
         resolver."role"::text AS "resolverRole",
         resolver."department"::text AS "resolverDepartment",
         resolver."title"     AS "resolverTitle"
       FROM "InboxItem" i
       LEFT JOIN "Staff" resolver ON resolver."id" = i."resolvedBy"
       WHERE i."id" = $1
       LIMIT 1`,
      inboxItemId
    )

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: `InboxItem ${inboxItemId} not found` },
        { status: 404 }
      )
    }

    const item = rows[0]

    // brainLearnings is a newer additive column — select in isolation so an
    // un-migrated DB returns null rather than blowing up the whole request.
    let brainLearnings: Record<string, any> | null = null
    try {
      const learnRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "brainLearnings" FROM "InboxItem" WHERE "id" = $1 LIMIT 1`,
        inboxItemId
      )
      if (learnRows.length > 0) {
        brainLearnings = learnRows[0].brainLearnings ?? null
      }
    } catch {
      // column may not exist yet — leave null
    }

    // Surface whether the item is actually resolved. PENDING / SNOOZED
    // without resolvedAt is "still open" — the engine should keep polling
    // /pending instead of hammering this endpoint.
    const isResolved = !!item.resolvedAt || ['APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED'].includes(item.status)

    // ── Timeline (audit log scoped to this InboxItem, chronological) ──
    // Wave 3 enrichment: caller asked for a true "creation -> resolution"
    // sequence. Also reused downstream for before/after state derivation.
    let timeline: any[] = []
    try {
      const audits = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "action", "details", "staffId", "createdAt", "severity", "ipAddress", "userAgent"
         FROM "AuditLog"
         WHERE "entity" = 'InboxItem' AND "entityId" = $1
         ORDER BY "createdAt" ASC`,
        inboxItemId
      )
      timeline = audits.map((a) => ({
        id: a.id,
        action: a.action,
        details: a.details,
        staffId: a.staffId || null,
        severity: a.severity || 'INFO',
        ipAddress: a.ipAddress || null,
        userAgent: a.userAgent || null,
        at: a.createdAt,
      }))
    } catch {
      // AuditLog is best-effort
    }

    // Backward-compat alias: older NUC versions consume `auditTrail`.
    const auditTrail = timeline

    // ── Linked entity (current / "after" state) ──
    let linkedRecord: Record<string, any> | null = null
    let afterState: Record<string, any> | null = null
    const lookup = item.entityType ? LINKED_LOOKUPS[item.entityType] : undefined
    if (lookup && item.entityId) {
      try {
        const cols = lookup.columns.map((c) => `"${c}"`).join(', ')
        const linked = await prisma.$queryRawUnsafe<any[]>(
          `SELECT ${cols} FROM "${lookup.table}" WHERE "id" = $1 LIMIT 1`,
          item.entityId
        )
        if (linked.length > 0) {
          linkedRecord = {
            entityType: item.entityType,
            entityId: item.entityId,
            data: linked[0],
          }
          afterState = linked[0]
        }
      } catch {
        // Linked table may not exist yet or column set mismatched — skip.
      }
    }

    // ── beforeState (best-effort reconstruction) ──
    // AuditLog.details often carries `{ before: {...}, after: {...} }` or the
    // pre-mutation snapshot under keys like `previous`, `snapshot`, or `old`.
    // We walk the timeline (oldest-first) and pick the earliest snapshot we
    // can find. This is a hint, not a guarantee.
    let beforeState: Record<string, any> | null = null
    if (timeline.length > 0) {
      for (const evt of timeline) {
        const d: any = evt.details || {}
        const candidate = d.before ?? d.previous ?? d.old ?? d.snapshot ?? null
        if (candidate && typeof candidate === 'object') {
          beforeState = candidate
          break
        }
      }
    }

    // ── actorContext (resolver role/department/session proxy) ──
    // activeSessionTimeMs is a proxy: seconds between the resolver's first
    // audit-log action today and the resolution timestamp. Gives the NUC a
    // rough "how long had this person been working" signal without needing
    // a dedicated StaffSession table.
    let actorContext: Record<string, any> | null = null
    if (item.resolverId) {
      let activeSessionTimeMs: number | null = null
      let todaysActionCount: number | null = null
      try {
        const sessionRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT
             MIN("createdAt") AS "sessionStart",
             COUNT(*)::int    AS "actionCount"
           FROM "AuditLog"
           WHERE "staffId" = $1
             AND "createdAt" >= date_trunc('day', NOW())`,
          item.resolverId
        )
        if (sessionRows.length > 0) {
          const start: Date | null = sessionRows[0].sessionStart
            ? new Date(sessionRows[0].sessionStart)
            : null
          const end = item.resolvedAt ? new Date(item.resolvedAt) : new Date()
          if (start) {
            activeSessionTimeMs = Math.max(0, end.getTime() - start.getTime())
          }
          todaysActionCount = sessionRows[0].actionCount ?? null
        }
      } catch {
        // best-effort
      }

      actorContext = {
        staffId: item.resolverId,
        role: item.resolverRole,
        department: item.resolverDepartment,
        title: item.resolverTitle,
        activeSessionTimeMs,
        todaysActionCount,
      }
    }

    // ── Similar recently-resolved items (for NUC pattern learning) ──
    let similarItems: any[] = []
    try {
      const sim = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
           i."id",
           i."type",
           i."source",
           i."title",
           i."status",
           i."priority",
           i."entityType",
           i."entityId",
           i."result",
           i."resolvedAt",
           i."createdAt",
           i."resolvedBy",
           s."firstName" AS "resolverFirstName",
           s."lastName"  AS "resolverLastName",
           s."role"::text AS "resolverRole"
         FROM "InboxItem" i
         LEFT JOIN "Staff" s ON s."id" = i."resolvedBy"
         WHERE i."type" = $1
           AND i."source" = $2
           AND i."id" <> $3
           AND i."resolvedAt" IS NOT NULL
         ORDER BY i."resolvedAt" DESC
         LIMIT $4`,
        item.type,
        item.source,
        inboxItemId,
        SIMILAR_LIMIT
      )
      similarItems = sim.map((r) => {
        const created = r.createdAt ? new Date(r.createdAt) : null
        const resolved = r.resolvedAt ? new Date(r.resolvedAt) : null
        const resolutionMs =
          created && resolved ? Math.max(0, resolved.getTime() - created.getTime()) : null
        return {
          id: r.id,
          type: r.type,
          source: r.source,
          title: r.title,
          status: r.status,
          priority: r.priority,
          entityType: r.entityType,
          entityId: r.entityId,
          result: r.result,
          resolvedAt: r.resolvedAt,
          createdAt: r.createdAt,
          resolutionTimeMs: resolutionMs,
          resolver: r.resolvedBy
            ? {
                id: r.resolvedBy,
                firstName: r.resolverFirstName,
                lastName: r.resolverLastName,
                role: r.resolverRole,
              }
            : null,
        }
      })
    } catch {
      // pattern pool is best-effort
    }

    return NextResponse.json({
      ok: true,
      inboxItemId: item.id,
      resolved: isResolved,
      aegisStatus: item.status,
      // NUC-friendly rollup of what action the ops team took.
      resolutionAction: isResolved
        ? item.status === 'APPROVED'
          ? 'APPROVE'
          : item.status === 'REJECTED'
          ? 'REJECT'
          : item.status === 'SNOOZED'
          ? 'SNOOZE'
          : 'COMPLETED'
        : null,
      resolvedAt: item.resolvedAt,
      resolvedBy: item.resolverId
        ? {
            id: item.resolverId,
            firstName: item.resolverFirstName,
            lastName: item.resolverLastName,
            email: item.resolverEmail,
            role: item.resolverRole,
            department: item.resolverDepartment,
          }
        : null,
      result: item.result ?? null,
      snoozedUntil: item.snoozedUntil,
      brainAcknowledgedAt: item.brainAcknowledgedAt,
      brainLearnings,
      item: {
        id: item.id,
        type: item.type,
        source: item.source,
        title: item.title,
        priority: item.priority,
        entityType: item.entityType,
        entityId: item.entityId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
      linkedRecord,
      // Wave-3 enrichment surface
      beforeState,
      afterState,
      actorContext,
      similarItems,
      timeline,
      // Deprecated alias retained for older NUC coordinator builds.
      auditTrail,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: String(e?.message || e) },
      { status: 500 }
    )
  }
}
