export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// SmartPO queue — lists PENDING SmartPORecommendation rows with related
// Job info so the Purchasing UI can decide what to send next. Sorted by the
// soonest Job.scheduledDate across relatedJobIds, then urgency, then due
// date.
//
// GET  — list (filters: ?vendorId=&severity=&builderName=&limit=)
// POST — { action: 'send_to_vendor' | 'approve' | 'reject', ids: string[] }
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const vendorFilter = searchParams.get('vendorId') || undefined
  const severityFilter = searchParams.get('severity') || undefined
  const builderFilter = searchParams.get('builderName') || undefined
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500)

  try {
    // Build the inner filter dynamically
    const params: any[] = []
    const whereClauses: string[] = [`r."status" = 'PENDING'`]
    if (vendorFilter) {
      params.push(vendorFilter)
      whereClauses.push(`r."vendorId" = $${params.length}`)
    }
    if (severityFilter) {
      params.push(severityFilter)
      whereClauses.push(`r."urgency" = $${params.length}`)
    }
    const baseWhere = whereClauses.join(' AND ')

    const outerClauses: string[] = []
    if (builderFilter) {
      params.push(`%${builderFilter}%`)
      outerClauses.push(`
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            COALESCE(wj."sourceJobs"::jsonb, '[]'::jsonb)
          ) AS sj WHERE sj->>'builderName' ILIKE $${params.length}
        )
      `)
    }
    const outerWhere = outerClauses.length ? `WHERE ${outerClauses.join(' AND ')}` : ''

    const sql = `
      WITH pending AS (
        SELECT
          r."id", r."vendorId", r."productId", r."productCategory",
          r."recommendationType", r."urgency", r."triggerReason",
          r."recommendedQty", r."estimatedCost",
          r."targetDeliveryDate", r."orderByDate",
          r."relatedJobIds", r."createdAt", r."aiReasoning",
          v."name" AS "vendorName", v."code" AS "vendorCode",
          p."sku", p."name" AS "productName"
        FROM "SmartPORecommendation" r
        LEFT JOIN "Vendor" v ON v."id" = r."vendorId"
        LEFT JOIN "Product" p ON p."id" = r."productId"
        WHERE ${baseWhere}
      ),
      with_jobs AS (
        SELECT
          pe.*,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', j."id",
              'jobNumber', j."jobNumber",
              'builderName', j."builderName",
              'community', j."community",
              'scheduledDate', j."scheduledDate"
            ))
            FROM jsonb_array_elements_text(COALESCE(pe."relatedJobIds"::jsonb, '[]'::jsonb)) AS jid
            JOIN "Job" j ON j."id" = jid
          ), '[]'::json) AS "sourceJobs",
          (
            SELECT MIN(j."scheduledDate")
            FROM jsonb_array_elements_text(COALESCE(pe."relatedJobIds"::jsonb, '[]'::jsonb)) AS jid
            JOIN "Job" j ON j."id" = jid
          ) AS "soonestJobDate"
        FROM pending pe
      )
      SELECT * FROM with_jobs wj
      ${outerWhere}
      ORDER BY
        "soonestJobDate" ASC NULLS LAST,
        CASE "urgency"
          WHEN 'CRITICAL' THEN 0
          WHEN 'HIGH' THEN 1
          WHEN 'NORMAL' THEN 2
          WHEN 'LOW' THEN 3
          ELSE 4
        END,
        "orderByDate" ASC NULLS LAST
      LIMIT ${limit}
    `

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params)

    // Summary for the header
    const summary = await prisma.$queryRawUnsafe<
      Array<{ urgency: string; count: number; totalCost: number }>
    >(
      `
      SELECT "urgency",
             COUNT(*)::int AS count,
             COALESCE(SUM("estimatedCost"), 0)::float AS "totalCost"
      FROM "SmartPORecommendation"
      WHERE "status" = 'PENDING'
      GROUP BY "urgency"
      `
    )
    const byUrgency: Record<string, { count: number; totalCost: number }> = {
      CRITICAL: { count: 0, totalCost: 0 },
      HIGH: { count: 0, totalCost: 0 },
      NORMAL: { count: 0, totalCost: 0 },
      LOW: { count: 0, totalCost: 0 },
    }
    for (const r of summary) {
      byUrgency[r.urgency] = { count: r.count, totalCost: Number(r.totalCost) }
    }

    return safeJson({
      recommendations: rows.map((r) => ({
        ...r,
        recommendedQty: Number(r.recommendedQty),
        estimatedCost: Number(r.estimatedCost || 0),
        sourceJobs: r.sourceJobs || [],
      })),
      summary: {
        total: rows.length,
        byUrgency,
        totalCost: Object.values(byUrgency).reduce((s, u) => s + u.totalCost, 0),
      },
    })
  } catch (error: any) {
    return safeJson(
      { error: 'Failed to load SmartPO queue', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const action: string = body.action
    const ids: string[] = Array.isArray(body.ids) ? body.ids : []
    if (!['send_to_vendor', 'approve', 'reject'].includes(action)) {
      return safeJson({ error: 'Invalid action' }, { status: 400 })
    }
    if (ids.length === 0) {
      return safeJson({ error: 'No ids provided' }, { status: 400 })
    }
    audit(request, 'UPDATE', 'SmartPORecommendation', undefined, {
      action,
      count: ids.length,
    }).catch(() => {})

    // For the initial wire-up: `send_to_vendor` marks the recommendation as
    // SENT_TO_VENDOR. The downstream PO-send path (email / webhook to vendor)
    // lives elsewhere — this queue just flips the state and the sibling
    // path picks it up.
    const newStatus =
      action === 'send_to_vendor'
        ? 'SENT_TO_VENDOR'
        : action === 'approve'
          ? 'APPROVED'
          : 'REJECTED'

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const updated = await prisma.$executeRawUnsafe(
      `
      UPDATE "SmartPORecommendation"
      SET "status" = $${ids.length + 1}, "updatedAt" = NOW()
      WHERE "id" IN (${placeholders})
      `,
      ...ids,
      newStatus
    )

    return safeJson({ success: true, affected: updated })
  } catch (error: any) {
    return safeJson(
      { error: 'Action failed', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}
