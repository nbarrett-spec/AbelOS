export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { parseRoles } from '@/lib/permissions'
import { ensureSubstitutionRequestTable } from '@/lib/substitution-requests'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/substitutions
//
// PM-scoped consolidated queue for the /ops/substitutions page. Differs from
// the existing /api/ops/substitutions/requests route in three ways:
//
//   1. Defaults to scope=mine — returns only requests on jobs where
//      Job.assignedPMId matches the caller's x-staff-id.
//   2. Includes CONDITIONAL alongside PENDING (both wait on a PM decision).
//   3. Returns a `counts` block (pending, approved30d, rejected30d,
//      conditional) for the page's filter chips without a second round-trip.
//
// Query params:
//   scope=mine|all       (default: mine; 'all' requires ADMIN role)
//   status=PENDING|APPROVED|REJECTED|CONDITIONAL|APPLIED|ALL
//                        (default: PENDING+CONDITIONAL — the approval queue)
//   builderId=<id>       (optional; repeatable via comma-separated ids)
//
// Read-only. Mutations go through the existing /requests/[id]/approve and
// /requests/[id]/reject routes.
// ──────────────────────────────────────────────────────────────────────────

interface QueueRow {
  id: string
  jobId: string
  jobNumber: string | null
  builderId: string | null
  builderName: string | null
  assignedPMId: string | null
  originalAllocationId: string | null
  originalProductId: string
  originalSku: string | null
  originalName: string | null
  substituteProductId: string
  substituteSku: string | null
  substituteName: string | null
  compatibility: string | null
  conditions: string | null
  priceDelta: number | null
  quantity: number
  requestedById: string
  requesterName: string | null
  requesterEmail: string | null
  reason: string | null
  status: string
  approvedById: string | null
  approvedAt: string | null
  rejectionNote: string | null
  createdAt: string
  appliedAt: string | null
  daysPending: number
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  const rolesHeader =
    request.headers.get('x-staff-roles') ||
    request.headers.get('x-staff-role') ||
    ''
  const roles = parseRoles(rolesHeader)
  const isAdmin = roles.includes('ADMIN')

  const { searchParams } = new URL(request.url)
  const scope = (searchParams.get('scope') || 'mine').toLowerCase()
  const rawStatus = (searchParams.get('status') || 'QUEUE').toUpperCase()
  const builderIdsParam = searchParams.get('builderId')
  const builderIds =
    builderIdsParam && builderIdsParam.trim() !== ''
      ? builderIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : []

  // Non-admins cannot widen scope past their own jobs.
  const effectiveScope = scope === 'all' && isAdmin ? 'all' : 'mine'

  const VALID_STATUSES = new Set([
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CONDITIONAL',
    'APPLIED',
    'ALL',
    'QUEUE', // synthetic: PENDING + CONDITIONAL (the approval queue)
  ])
  const status = VALID_STATUSES.has(rawStatus) ? rawStatus : 'QUEUE'

  try {
    await ensureSubstitutionRequestTable()

    // Build WHERE clause incrementally. Status filter first, then scope,
    // then optional builder filter. Empty counts/list on failure is handled
    // by the surrounding try/catch.
    const whereParts: string[] = []
    const params: any[] = []

    if (status === 'QUEUE') {
      whereParts.push(`sr."status" IN ('PENDING', 'CONDITIONAL')`)
    } else if (status === 'APPROVED') {
      // APPROVED chip shows both APPROVED (decided, not yet swapped) and
      // APPLIED (decided + swap committed) — the user-facing "green" family.
      whereParts.push(`sr."status" IN ('APPROVED', 'APPLIED')`)
    } else if (status !== 'ALL') {
      whereParts.push(`sr."status" = $${params.length + 1}`)
      params.push(status)
    }

    if (effectiveScope === 'mine') {
      whereParts.push(`j."assignedPMId" = $${params.length + 1}`)
      params.push(staffId)
    }

    if (builderIds.length > 0) {
      const placeholders = builderIds
        .map((_, i) => `$${params.length + i + 1}`)
        .join(', ')
      // Job has no builderId column on prod — builder is reached via Order.
      whereParts.push(`o."builderId" IN (${placeholders})`)
      params.push(...builderIds)
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         sr.id,
         sr."jobId",
         sr."originalAllocationId",
         sr."originalProductId",
         sr."substituteProductId",
         sr.quantity,
         sr."requestedById",
         sr.reason,
         sr.status,
         sr."approvedById",
         sr."approvedAt",
         sr."rejectionNote",
         sr."createdAt",
         sr."appliedAt",
         j."jobNumber",
         o."builderId" AS "builderId",
         j."assignedPMId",
         COALESCE(b."companyName", j."builderName") AS "builderName",
         po.sku       AS "originalSku",
         po.name      AS "originalName",
         ps.sku       AS "substituteSku",
         ps.name      AS "substituteName",
         psub."compatibility",
         psub."conditions",
         psub."priceDelta",
         rs."firstName" AS "requesterFirstName",
         rs."lastName"  AS "requesterLastName",
         rs.email       AS "requesterEmail",
         EXTRACT(EPOCH FROM (NOW() - sr."createdAt")) / 86400.0 AS "daysPending"
       FROM "SubstitutionRequest" sr
       LEFT JOIN "Job"     j  ON j.id  = sr."jobId"
       LEFT JOIN "Order"   o  ON o.id  = j."orderId"
       LEFT JOIN "Builder" b  ON b.id  = o."builderId"
       LEFT JOIN "Product" po ON po.id = sr."originalProductId"
       LEFT JOIN "Product" ps ON ps.id = sr."substituteProductId"
       LEFT JOIN "ProductSubstitution" psub
              ON psub."primaryProductId"    = sr."originalProductId"
             AND psub."substituteProductId" = sr."substituteProductId"
             AND psub.active = true
       LEFT JOIN "Staff"   rs ON rs.id = sr."requestedById"
       ${whereClause}
       ORDER BY (sr."status" IN ('PENDING', 'CONDITIONAL')) DESC,
                sr."createdAt" ASC
       LIMIT 500`,
      ...params
    )

    // Counts — always scoped the same way as the list (scope + builder
    // filters apply), but ignore the status filter so the chips can show
    // the full breakdown. approved30d / rejected30d gate on the decision
    // timestamp.
    const countWhereParts: string[] = []
    const countParams: any[] = []
    if (effectiveScope === 'mine') {
      countWhereParts.push(`j."assignedPMId" = $${countParams.length + 1}`)
      countParams.push(staffId)
    }
    if (builderIds.length > 0) {
      const placeholders = builderIds
        .map((_, i) => `$${countParams.length + i + 1}`)
        .join(', ')
      // Job has no builderId column on prod — builder is reached via Order.
      countWhereParts.push(`o."builderId" IN (${placeholders})`)
      countParams.push(...builderIds)
    }
    const countWhere =
      countWhereParts.length > 0
        ? `WHERE ${countWhereParts.join(' AND ')}`
        : ''

    const countRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) FILTER (WHERE sr."status" = 'PENDING')     AS pending,
         COUNT(*) FILTER (WHERE sr."status" = 'CONDITIONAL') AS conditional,
         COUNT(*) FILTER (
           WHERE sr."status" IN ('APPROVED', 'APPLIED')
             AND sr."approvedAt" >= NOW() - INTERVAL '30 days'
         ) AS approved30d,
         COUNT(*) FILTER (
           WHERE sr."status" = 'REJECTED'
             AND sr."approvedAt" >= NOW() - INTERVAL '30 days'
         ) AS rejected30d
       FROM "SubstitutionRequest" sr
       LEFT JOIN "Job"   j ON j.id = sr."jobId"
       LEFT JOIN "Order" o ON o.id = j."orderId"
       ${countWhere}`,
      ...countParams
    )
    const c = countRows[0] ?? {}

    const shaped: QueueRow[] = rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      builderId: r.builderId,
      builderName: r.builderName,
      assignedPMId: r.assignedPMId,
      originalAllocationId: r.originalAllocationId,
      originalProductId: r.originalProductId,
      originalSku: r.originalSku,
      originalName: r.originalName,
      substituteProductId: r.substituteProductId,
      substituteSku: r.substituteSku,
      substituteName: r.substituteName,
      compatibility: r.compatibility,
      conditions: r.conditions,
      priceDelta: r.priceDelta == null ? null : Number(r.priceDelta),
      quantity: Number(r.quantity),
      requestedById: r.requestedById,
      requesterName:
        `${r.requesterFirstName ?? ''} ${r.requesterLastName ?? ''}`.trim() ||
        null,
      requesterEmail: r.requesterEmail,
      reason: r.reason,
      status: r.status,
      approvedById: r.approvedById,
      approvedAt:
        r.approvedAt instanceof Date
          ? r.approvedAt.toISOString()
          : r.approvedAt,
      rejectionNote: r.rejectionNote,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : r.createdAt,
      appliedAt:
        r.appliedAt instanceof Date
          ? r.appliedAt.toISOString()
          : r.appliedAt,
      daysPending:
        r.daysPending == null ? 0 : Math.round(Number(r.daysPending) * 10) / 10,
    }))

    // Re-sort by daysPending DESC among queue rows, preserving the
    // PENDING-first ordering from the SQL. Approved/rejected rows tail.
    shaped.sort((a, b) => {
      const aQueue =
        a.status === 'PENDING' || a.status === 'CONDITIONAL' ? 1 : 0
      const bQueue =
        b.status === 'PENDING' || b.status === 'CONDITIONAL' ? 1 : 0
      if (aQueue !== bQueue) return bQueue - aQueue
      return b.daysPending - a.daysPending
    })

    return NextResponse.json({
      scope: effectiveScope,
      status,
      count: shaped.length,
      requests: shaped,
      counts: {
        pending: Number(c.pending ?? 0),
        conditional: Number(c.conditional ?? 0),
        approved30d: Number(c.approved30d ?? 0),
        rejected30d: Number(c.rejected30d ?? 0),
      },
    })
  } catch (err: any) {
    // If the SubstitutionRequest *table* genuinely doesn't exist yet (e.g.
    // fresh env where ensureSubstitutionRequestTable somehow didn't run) —
    // return an empty queue so the page can render its "not initialized"
    // state gracefully. Narrowed to relation-missing only — the previous
    // /does not exist/i regex was eating column-mismatch errors and silently
    // hiding real bugs (see SCAN-A1-API-RUNTIME).
    const msg = err?.message || ''
    const isMissingTable =
      /relation .*SubstitutionRequest.* does not exist/i.test(msg)

    if (isMissingTable) {
      return NextResponse.json({
        scope: effectiveScope,
        status,
        count: 0,
        requests: [],
        counts: { pending: 0, conditional: 0, approved30d: 0, rejected30d: 0 },
        initialized: false,
      })
    }

    logger.error('[api/ops/substitutions GET] failed', err, {
      scope: effectiveScope,
      status,
    })
    return NextResponse.json(
      {
        error: 'Failed to load substitution queue',
        details: err?.message,
      },
      { status: 500 }
    )
  }
}
