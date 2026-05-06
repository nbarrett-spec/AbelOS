// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/manufacturing/build-queue
//
// Returns the active job queue for the manufacturing Build-Sheet workspace.
// Default scope: jobs in status MATERIALS_LOCKED or IN_PRODUCTION,
// sorted by scheduledDate ASC (NULLs last).
//
// Query params (all optional):
//   ?status=MATERIALS_LOCKED,IN_PRODUCTION   comma-separated JobStatus values
//                                            default = "MATERIALS_LOCKED,IN_PRODUCTION"
//   ?productType=Exterior|Interior            filter by Product.category match
//                                            on the job's order items
//   ?builder=<name>                          ILIKE filter on Job.builderName
//   ?pmId=<staffId>                          exact match on Job.assignedPMId
//   ?limit=50                                row cap (default 100, max 250)
//
// Response shape:
//   { jobs: [{ id, jobNumber, builder, community, address, scheduledDate,
//              status, scopeType, jobType, pmName, assignedPMId,
//              pickProgress: { total, verified, percentComplete } }],
//     count, asOf }
//
// Auth: standard staff auth via checkStaffAuth.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

const DEFAULT_STATUSES = ['MATERIALS_LOCKED', 'IN_PRODUCTION']
const ALLOWED_STATUSES = new Set([
  'CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION',
  'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING',
  'PUNCH_LIST', 'COMPLETE', 'INVOICED', 'CLOSED',
])

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams

    // Status filter — comma-separated, validated against the JobStatus enum
    const statusParam = (sp.get('status') || DEFAULT_STATUSES.join(','))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ALLOWED_STATUSES.has(s))
    const statuses = statusParam.length > 0 ? statusParam : DEFAULT_STATUSES

    const productType = (sp.get('productType') || '').trim() // "Exterior" | "Interior" | ""
    const builder = (sp.get('builder') || '').trim()
    const pmId = (sp.get('pmId') || '').trim()
    const limitRaw = parseInt(sp.get('limit') || '100', 10)
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 100, 250))

    // Build WHERE clause dynamically with parameterized placeholders
    const where: string[] = []
    const params: any[] = []
    let p = 1

    // status IN (...)
    const statusPlaceholders = statuses.map((_, i) => `$${p + i}`).join(', ')
    where.push(`j."status"::text IN (${statusPlaceholders})`)
    params.push(...statuses)
    p += statuses.length

    if (builder) {
      where.push(`j."builderName" ILIKE $${p}`)
      params.push(`%${builder}%`)
      p++
    }

    if (pmId) {
      where.push(`j."assignedPMId" = $${p}`)
      params.push(pmId)
      p++
    }

    // productType — filter to jobs whose order has at least one OrderItem
    // joined to a Product whose category matches Exterior/Interior.
    // We use EXISTS for a cheap semi-join.
    if (productType === 'Exterior' || productType === 'Interior') {
      where.push(`EXISTS (
        SELECT 1
          FROM "OrderItem" oi
          JOIN "Product" pr ON oi."productId" = pr.id
         WHERE oi."orderId" = j."orderId"
           AND pr.category ILIKE $${p}
      )`)
      params.push(`%${productType}%`)
      p++
    }

    // Stock-only filter — jobs whose order contains zero manufactured-in-house
    // items (no OrderItem.productId is the parent of any BomEntry) should not
    // appear on the manufacturing queue. Those orders still flow through
    // load / delivery / staging, but they don't get a build sheet.
    where.push(`EXISTS (
      SELECT 1
        FROM "OrderItem" oi
        JOIN "BomEntry" be ON be."parentId" = oi."productId"
       WHERE oi."orderId" = j."orderId"
    )`)

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const sql = `
      SELECT
        j.id,
        j."jobNumber",
        j."builderName",
        j.community,
        j."jobAddress",
        j."lotBlock",
        j."scheduledDate",
        j.status::text AS status,
        j."scopeType"::text AS "scopeType",
        j."jobType"::text AS "jobType",
        j."assignedPMId",
        j."orderId",
        s."firstName" || ' ' || s."lastName" AS "pmName"
      FROM "Job" j
      LEFT JOIN "Staff" s ON j."assignedPMId" = s.id
      ${whereSql}
      ORDER BY j."scheduledDate" ASC NULLS LAST, j."jobNumber" ASC
      LIMIT $${p}
    `
    params.push(limit)

    const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params)

    // Pick progress per job: count by status from MaterialPick
    const jobIds = rows.map((r) => r.id)
    const progressByJob = new Map<string, { total: number; verified: number; percentComplete: number }>()

    if (jobIds.length > 0) {
      try {
        const picks: any[] = await prisma.$queryRawUnsafe(
          `SELECT "jobId", status::text AS status, COUNT(*)::int AS c
             FROM "MaterialPick"
            WHERE "jobId" = ANY($1::text[])
            GROUP BY "jobId", status`,
          jobIds
        )
        const totalsByJob = new Map<string, { total: number; verified: number }>()
        for (const row of picks) {
          const cur = totalsByJob.get(row.jobId) || { total: 0, verified: 0 }
          cur.total += Number(row.c)
          if (row.status === 'VERIFIED') cur.verified += Number(row.c)
          totalsByJob.set(row.jobId, cur)
        }
        for (const [jid, v] of totalsByJob.entries()) {
          progressByJob.set(jid, {
            total: v.total,
            verified: v.verified,
            percentComplete: v.total > 0 ? Math.round((v.verified / v.total) * 100) : 0,
          })
        }
      } catch (e) {
        console.warn('[Build Queue] pick progress lookup skipped:', (e as Error)?.message)
      }
    }

    const jobs = rows.map((r) => ({
      id: r.id,
      jobNumber: r.jobNumber,
      builder: r.builderName,
      community: r.community,
      address: r.jobAddress,
      lotBlock: r.lotBlock,
      scheduledDate: r.scheduledDate,
      status: r.status,
      scopeType: r.scopeType,
      jobType: r.jobType,
      assignedPMId: r.assignedPMId,
      pmName: r.pmName,
      pickProgress: progressByJob.get(r.id) || { total: 0, verified: 0, percentComplete: 0 },
    }))

    return safeJson({
      jobs,
      count: jobs.length,
      asOf: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[Build Queue API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch build queue', detail: error?.message },
      { status: 500 }
    )
  }
}
