/**
 * Role-Scoped Inbox API
 *
 * GET /api/ops/inbox/scoped
 *   Query params:
 *     ?type=<comma-separated types>   — override role-based type filter
 *     ?status=PENDING|COMPLETED|...   — default PENDING
 *     ?priority=<comma-separated>     — CRITICAL,HIGH,MEDIUM,LOW
 *     ?limit=50                       — default 50, max 200
 *     ?cursor=<id>                    — keyset pagination (takes the last id)
 *     ?assigneeOnly=true              — restrict to items assigned to caller
 *
 * Returns items filtered by caller's role/department. Default scope:
 *   items where assignedTo matches staff email or staff id
 *   OR items of types that match the caller's role (see ROLE_TYPE_MAP).
 *
 * Also returns { countsByType } for the sidebar (computed across the same
 * role-scope but ignoring the `type` filter so totals show all visible
 * buckets at once).
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getStaffFromHeaders } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Role → visible inbox-types map
// ──────────────────────────────────────────────────────────────────────────
const ROLE_TYPE_MAP: Record<string, string[]> = {
  ACCOUNTING: [
    'COLLECTION_ACTION',
    'ACTION_REQUIRED',
    'IMPROVEMENT_REVENUE',
    'IMPROVEMENT_COST',
    'IMPROVEMENT_CASHFLOW',
    'IMPROVEMENT_PRICING',
    'FINANCIAL_IMPROVEMENT',
    'CREDIT_ALERT',
  ],
  PROJECT_MANAGER: [
    'SCHEDULE_CHANGE',
    'ACTION_REQUIRED',
    'IMPROVEMENT_SCHEDULING',
    'IMPROVEMENT_QUALITY',
    'IMPROVEMENT_DELIVERY',
    'QC_ALERT',
    'MATERIAL_ARRIVAL',
    'MRP_RECOMMENDATION',
  ],
  PURCHASING: [
    'PO_APPROVAL',
    'IMPROVEMENT_SUPPLIER',
    'IMPROVEMENT_INVENTORY',
    'MRP_RECOMMENDATION',
    'MATERIAL_ARRIVAL',
  ],
  SALES_REP: [
    'IMPROVEMENT_REVENUE',
    'IMPROVEMENT_PRICING',
    'DEAL_FOLLOWUP',
    'OUTREACH_REVIEW',
  ],
  ESTIMATOR: [
    'IMPROVEMENT_PRICING',
    'DEAL_FOLLOWUP',
    'MRP_RECOMMENDATION',
  ],
  WAREHOUSE_LEAD: [
    'MATERIAL_ARRIVAL',
    'QC_ALERT',
    'SCHEDULE_CHANGE',
    'MRP_RECOMMENDATION',
  ],
  QC_INSPECTOR: ['QC_ALERT'],
}

// Admin / Manager see everything, plus SYSTEM types.
const ADMIN_ROLES = new Set(['ADMIN', 'MANAGER'])

function typesForRoles(roles: string[]): string[] | 'ALL' {
  if (roles.some(r => ADMIN_ROLES.has(r))) return 'ALL'
  const set = new Set<string>()
  for (const r of roles) {
    const types = ROLE_TYPE_MAP[r]
    if (types) types.forEach(t => set.add(t))
  }
  return Array.from(set)
}

export async function GET(request: NextRequest) {
  try {
    const staff = getStaffFromHeaders(request.headers)
    const rolesHeader = request.headers.get('x-staff-roles') || staff.role
    const roles = rolesHeader.split(',').map(r => r.trim()).filter(Boolean)
    const sp = request.nextUrl.searchParams

    const status = sp.get('status') || 'PENDING'
    const explicitTypes = sp.get('type')?.split(',').map(s => s.trim()).filter(Boolean)
    const priorityFilter = sp.get('priority')?.split(',').map(s => s.trim()).filter(Boolean)
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200)
    const cursor = sp.get('cursor') || undefined
    const assigneeOnly = sp.get('assigneeOnly') === 'true'

    // Resolve allowed types for this caller
    const allowedTypes = typesForRoles(roles)
    const effectiveTypes = explicitTypes && explicitTypes.length > 0
      ? explicitTypes
      : (allowedTypes === 'ALL' ? null : allowedTypes)

    // Build WHERE clause:
    //   scope = (assignedTo IN (staffId, staffEmail)) OR type IN (effectiveTypes)
    //   + status, priority, cursor
    const conds: string[] = []
    const params: any[] = []
    let p = 1

    // Status
    if (status !== 'all') {
      conds.push(`status = $${p++}`)
      params.push(status)
    }

    // Priority
    if (priorityFilter && priorityFilter.length) {
      const placeholders = priorityFilter.map(() => `$${p++}`).join(',')
      conds.push(`priority IN (${placeholders})`)
      params.push(...priorityFilter)
    }

    // Role / assignment scope
    if (allowedTypes !== 'ALL') {
      // Not admin/manager — scope to types OR assigned-to-me
      const scopeParts: string[] = []

      if (!assigneeOnly && effectiveTypes && effectiveTypes.length) {
        const tp = effectiveTypes.map(() => `$${p++}`).join(',')
        scopeParts.push(`type IN (${tp})`)
        params.push(...effectiveTypes)
      }

      // assigned-to-me (staff id OR email)
      scopeParts.push(`"assignedTo" = $${p++}`)
      params.push(staff.staffId)
      scopeParts.push(`"assignedTo" = $${p++}`)
      params.push(staff.email)

      if (scopeParts.length) {
        conds.push(`(${scopeParts.join(' OR ')})`)
      }
    } else if (explicitTypes && explicitTypes.length) {
      // Admin narrowing by an explicit type filter
      const tp = explicitTypes.map(() => `$${p++}`).join(',')
      conds.push(`type IN (${tp})`)
      params.push(...explicitTypes)
    }

    // Keyset pagination — compare against last createdAt of cursor row
    if (cursor) {
      conds.push(`"createdAt" < (SELECT "createdAt" FROM "InboxItem" WHERE id = $${p++})`)
      params.push(cursor)
    }

    // Hide snoozed items that are still sleeping (only when listing PENDING)
    if (status === 'PENDING') {
      conds.push(`("snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())`)
    }

    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const limitPlaceholder = `$${p++}`
    params.push(limit)

    const items = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "InboxItem" ${whereClause}
       ORDER BY
         CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
         "createdAt" DESC
       LIMIT ${limitPlaceholder}`,
      ...params
    )

    // Build countsByType for the sidebar — drop the explicit `type` filter,
    // keep role/assignment scope and status/priority. Recompute params.
    const countConds: string[] = []
    const countParams: any[] = []
    let cp = 1
    if (status !== 'all') {
      countConds.push(`status = $${cp++}`)
      countParams.push(status)
    }
    if (priorityFilter && priorityFilter.length) {
      const ph = priorityFilter.map(() => `$${cp++}`).join(',')
      countConds.push(`priority IN (${ph})`)
      countParams.push(...priorityFilter)
    }
    if (allowedTypes !== 'ALL') {
      const scopeParts: string[] = []
      if (allowedTypes.length) {
        const tp = allowedTypes.map(() => `$${cp++}`).join(',')
        scopeParts.push(`type IN (${tp})`)
        countParams.push(...allowedTypes)
      }
      scopeParts.push(`"assignedTo" = $${cp++}`)
      countParams.push(staff.staffId)
      scopeParts.push(`"assignedTo" = $${cp++}`)
      countParams.push(staff.email)
      countConds.push(`(${scopeParts.join(' OR ')})`)
    }
    if (status === 'PENDING') {
      countConds.push(`("snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())`)
    }
    const countWhere = countConds.length ? `WHERE ${countConds.join(' AND ')}` : ''
    const typeCounts = await prisma.$queryRawUnsafe<{ type: string; count: bigint }[]>(
      `SELECT type, COUNT(*)::bigint AS count FROM "InboxItem" ${countWhere} GROUP BY type ORDER BY count DESC`,
      ...countParams
    )

    const countsByType: Record<string, number> = {}
    let totalPending = 0
    for (const row of typeCounts) {
      const n = Number(row.count)
      countsByType[row.type] = n
      totalPending += n
    }

    const nextCursor = items.length === limit ? items[items.length - 1].id : null

    return NextResponse.json({
      items,
      count: items.length,
      totalPending,
      countsByType,
      nextCursor,
      scope: {
        role: staff.role,
        roles,
        types: allowedTypes === 'ALL' ? 'ALL' : allowedTypes,
      },
    })
  } catch (error: any) {
    logger.error('inbox_scoped_get_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch inbox' },
      { status: 500 }
    )
  }
}
