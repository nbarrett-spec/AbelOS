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
         resolver."role"::text AS "resolverRole"
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

    // Surface whether the item is actually resolved. PENDING / SNOOZED
    // without resolvedAt is "still open" — the engine should keep polling
    // /pending instead of hammering this endpoint.
    const isResolved = !!item.resolvedAt || ['APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED'].includes(item.status)

    // Pull audit trail (chronological) for a fuller picture of what changed.
    let auditTrail: any[] = []
    try {
      const audits = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "action", "details", "staffId", "staffName", "createdAt", "severity"
         FROM "AuditLog"
         WHERE "entity" = 'InboxItem' AND "entityId" = $1
         ORDER BY "createdAt" ASC`,
        inboxItemId
      )
      auditTrail = audits.map((a) => ({
        action: a.action,
        details: a.details,
        staffId: a.staffId || null,
        staffName: a.staffName || null,
        severity: a.severity || 'INFO',
        at: a.createdAt,
      }))
    } catch {
      // AuditLog is best-effort
    }

    // Hydrate the linked entity (order / PO / payment / invoice / ...)
    let linkedRecord: Record<string, any> | null = null
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
        }
      } catch {
        // Linked table may not exist yet or column set mismatched — skip.
      }
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
          }
        : null,
      result: item.result ?? null,
      snoozedUntil: item.snoozedUntil,
      brainAcknowledgedAt: item.brainAcknowledgedAt,
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
      auditTrail,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: String(e?.message || e) },
      { status: 500 }
    )
  }
}
