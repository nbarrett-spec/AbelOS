/**
 * GET /api/v1/engine/inbox/pending?since=<ISO>&limit=<n>
 *
 * Returns InboxItem rows the NUC brain hasn't processed yet. Polled by the
 * coordinator to retrieve unresolved work.
 *
 * Maps the NUC's OPEN / IN_PROGRESS concept onto Aegis's actual statuses:
 *   - OPEN        → status='PENDING'
 *   - IN_PROGRESS → status='SNOOZED'  (ops has looked at it, not resolved)
 *
 * Responds with full payload: item metadata, actionData, the assigned
 * staff record (if any), and a resolution-actions-so-far array pulled from
 * AuditLog rows scoped to this item.
 *
 * Auth: Bearer ENGINE_BRIDGE_TOKEN via verifyEngineToken().
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const sinceRaw = url.searchParams.get('since')
  const limitRaw = url.searchParams.get('limit')
  const limit = Math.max(
    1,
    Math.min(parseInt(limitRaw || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, MAX_LIMIT)
  )

  // since is optional — if omitted, returns everything unresolved.
  let since: Date | null = null
  if (sinceRaw) {
    const parsed = new Date(sinceRaw)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'bad_request', message: "'since' must be a valid ISO-8601 timestamp" },
        { status: 400 }
      )
    }
    since = parsed
  }

  try {
    const params: any[] = []
    const whereClauses = [`i."status" IN ('PENDING', 'SNOOZED')`]
    if (since) {
      params.push(since)
      whereClauses.push(`i."updatedAt" >= $${params.length}`)
    }
    params.push(limit)
    const whereClause = whereClauses.join(' AND ')

    const items = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         i."id",
         i."type",
         i."source",
         i."title",
         i."description",
         i."priority",
         i."status",
         i."entityType",
         i."entityId",
         i."financialImpact",
         i."assignedTo",
         i."actionData",
         i."result",
         i."dueBy",
         i."snoozedUntil",
         i."resolvedAt",
         i."resolvedBy",
         i."brainAcknowledgedAt",
         i."createdAt",
         i."updatedAt",
         s."id"         AS "assignedStaffId",
         s."firstName"  AS "assignedStaffFirstName",
         s."lastName"   AS "assignedStaffLastName",
         s."email"      AS "assignedStaffEmail",
         s."role"::text AS "assignedStaffRole",
         s."department"::text AS "assignedStaffDepartment"
       FROM "InboxItem" i
       LEFT JOIN "Staff" s ON s."id" = i."assignedTo"
       WHERE ${whereClause}
       ORDER BY
         CASE i."priority"
           WHEN 'CRITICAL' THEN 1
           WHEN 'HIGH' THEN 2
           WHEN 'MEDIUM' THEN 3
           ELSE 4
         END,
         i."createdAt" ASC
       LIMIT $${params.length}`,
      ...params
    )

    // Pull any AuditLog entries scoped to InboxItem so the NUC can see what
    // ops has done so far (even before the item is fully resolved).
    const itemIds = items.map((i) => i.id)
    const actionsByItem: Record<string, any[]> = {}
    if (itemIds.length > 0) {
      try {
        const actions = await prisma.$queryRawUnsafe<any[]>(
          `SELECT
             "entityId", "action", "details", "staffId", "staffName", "createdAt"
           FROM "AuditLog"
           WHERE "entity" = 'InboxItem'
             AND "entityId" = ANY($1::text[])
           ORDER BY "createdAt" ASC`,
          itemIds
        )
        for (const a of actions) {
          const list = actionsByItem[a.entityId] || []
          list.push({
            action: a.action,
            details: a.details,
            staffId: a.staffId || null,
            staffName: a.staffName || null,
            at: a.createdAt,
          })
          actionsByItem[a.entityId] = list
        }
      } catch {
        // AuditLog may not be populated for every item; best-effort.
      }
    }

    const result = items.map((i) => ({
      id: i.id,
      type: i.type,
      source: i.source,
      title: i.title,
      description: i.description,
      priority: i.priority,
      // Map Aegis status → NUC-friendly status
      status: i.status === 'PENDING' ? 'OPEN' : i.status === 'SNOOZED' ? 'IN_PROGRESS' : i.status,
      aegisStatus: i.status,
      entityType: i.entityType,
      entityId: i.entityId,
      financialImpact: i.financialImpact,
      actionData: i.actionData,
      result: i.result,
      dueBy: i.dueBy,
      snoozedUntil: i.snoozedUntil,
      resolvedAt: i.resolvedAt,
      resolvedBy: i.resolvedBy,
      brainAcknowledgedAt: i.brainAcknowledgedAt,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      assignedStaff: i.assignedStaffId
        ? {
            id: i.assignedStaffId,
            firstName: i.assignedStaffFirstName,
            lastName: i.assignedStaffLastName,
            email: i.assignedStaffEmail,
            role: i.assignedStaffRole,
            department: i.assignedStaffDepartment,
          }
        : null,
      resolutionActions: actionsByItem[i.id] || [],
    }))

    return NextResponse.json({
      ok: true,
      since: since?.toISOString() || null,
      limit,
      count: result.length,
      items: result,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: String(e?.message || e) },
      { status: 500 }
    )
  }
}
