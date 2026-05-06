// /api/admin/review-queue
//
// GET  — list of review-queue items with optional filters and a brief
//        summary of the linked entity so the UI can render rows without an
//        N+1 of follow-up fetches.
//
// Query params:
//   type   — PROSPECT_ENRICHMENT | PITCH_RUN | EMAIL_SEND | BOUNCE_RECHECK | (omitted)
//   status — PENDING | APPROVED | REJECTED | EXPIRED  (default PENDING)
//   limit  — default 50, max 200
//   offset — pagination
//
// Auth: ADMIN + SALES_REP can view; only ADMIN can act (see [id]/route.ts).
//
// New ReviewQueue model isn't in the generated Prisma client yet, so this
// route uses raw SQL for SELECT.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

interface ReviewQueueRow {
  id: string
  entityType: string
  entityId: string
  reason: string
  summary: string | null
  suggestedAction: any
  status: string
  reviewedBy: string | null
  reviewedAt: Date | null
  notes: string | null
  createdAt: Date
  expiresAt: Date | null
  // joined entity summary fields (nullable: not every row has every join)
  prospectCompanyName?: string | null
  prospectIcpTier?: string | null
  prospectConfidence?: string | null
  pitchStyle?: string | null
  pitchLayout?: string | null
  pitchStatus?: string | null
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error

  try {
    const url = new URL(request.url)
    const type = url.searchParams.get('type') || ''
    const status = url.searchParams.get('status') || 'PENDING'
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1),
      200
    )
    const offset = Math.max(
      parseInt(url.searchParams.get('offset') || '0', 10) || 0,
      0
    )

    const conditions: string[] = []
    const params: any[] = []
    let p = 1

    if (status && status !== 'ALL') {
      conditions.push(`q.status = $${p}`)
      params.push(status)
      p++
    }
    if (type && type !== 'ALL') {
      conditions.push(`q."entityType" = $${p}`)
      params.push(type)
      p++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const totalRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total FROM "ReviewQueue" q ${where}`,
      ...params
    )
    const total = totalRows[0]?.total || 0

    // Outer-join prospect summary and pitch-run summary so UI can render
    // recognizable labels without a follow-up fetch per row. We join
    // PROSPECT_ENRICHMENT/BOUNCE_RECHECK against Prospect on entityId, and
    // PITCH_RUN against PitchRun (then Prospect via PitchRun.prospectId).
    const rows = await prisma.$queryRawUnsafe<ReviewQueueRow[]>(
      `SELECT
         q.id, q."entityType", q."entityId", q.reason, q.summary, q."suggestedAction",
         q.status, q."reviewedBy", q."reviewedAt", q.notes, q."createdAt", q."expiresAt",
         CASE
           WHEN q."entityType" IN ('PROSPECT_ENRICHMENT','BOUNCE_RECHECK')
             THEN p1."companyName"
           WHEN q."entityType" = 'PITCH_RUN'
             THEN p2."companyName"
           ELSE NULL
         END AS "prospectCompanyName",
         CASE
           WHEN q."entityType" IN ('PROSPECT_ENRICHMENT','BOUNCE_RECHECK')
             THEN p1."icpTier"
           WHEN q."entityType" = 'PITCH_RUN'
             THEN p2."icpTier"
           ELSE NULL
         END AS "prospectIcpTier",
         CASE
           WHEN q."entityType" IN ('PROSPECT_ENRICHMENT','BOUNCE_RECHECK')
             THEN p1."enrichmentConfidence"
           WHEN q."entityType" = 'PITCH_RUN'
             THEN p2."enrichmentConfidence"
           ELSE NULL
         END AS "prospectConfidence",
         pr.style  AS "pitchStyle",
         pr.layout AS "pitchLayout",
         pr.status AS "pitchStatus"
       FROM "ReviewQueue" q
       LEFT JOIN "Prospect" p1
              ON q."entityType" IN ('PROSPECT_ENRICHMENT','BOUNCE_RECHECK')
             AND p1.id = q."entityId"
       LEFT JOIN "PitchRun" pr
              ON q."entityType" = 'PITCH_RUN'
             AND pr.id = q."entityId"
       LEFT JOIN "Prospect" p2
              ON q."entityType" = 'PITCH_RUN'
             AND p2.id = pr."prospectId"
       ${where}
       ORDER BY
         CASE WHEN q.status = 'PENDING' THEN 0 ELSE 1 END,
         q."createdAt" DESC
       LIMIT ${limit} OFFSET ${offset}`,
      ...params
    )

    // Counts by entityType (always over PENDING) for the tab bar.
    let counts: Record<string, number> = {}
    try {
      const countRows = await prisma.$queryRawUnsafe<
        Array<{ entityType: string; count: number }>
      >(
        `SELECT "entityType", COUNT(*)::int AS count
           FROM "ReviewQueue"
          WHERE status = 'PENDING'
          GROUP BY "entityType"`
      )
      counts = Object.fromEntries(
        countRows.map((r) => [r.entityType, Number(r.count)])
      )
    } catch {
      counts = {}
    }

    return NextResponse.json({
      items: rows,
      total,
      counts,
      limit,
      offset,
    })
  } catch (error: any) {
    console.error('[Admin ReviewQueue GET]', error?.message || error)
    return NextResponse.json(
      { error: 'Failed to load review queue' },
      { status: 500 }
    )
  }
}
