export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────
// GET /api/ops/communities/[id] — Full community picture
//
// Returns the community plus all associated data:
//   - contacts, floor plans, notes
//   - jobs (with status counts)
//   - tasks (open)
//   - communication log (recent)
//   - orders/revenue (from linked jobs)
//   - performance metrics
// ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = params

  try {
    // 1. Community core data + builder info
    const [community] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, b."companyName" AS "builderName", b."builderType", b."email" AS "builderEmail",
              b."contactName" AS "builderContactName", b."phone" AS "builderPhone"
       FROM "Community" c
       JOIN "Builder" b ON b.id = c."builderId"
       WHERE c.id = $1`,
      id
    )

    if (!community) {
      return NextResponse.json({ error: 'Community not found' }, { status: 404 })
    }

    // 2. Parallel queries for all associated data
    const [contacts, floorPlans, notes, jobs, tasks, commLogs, jobStats, orderStats] = await Promise.all([
      // Contacts for this community
      prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "BuilderContact" WHERE "communityId" = $1 AND "active" = true ORDER BY "isPrimary" DESC, "lastName" ASC`,
        id
      ).catch(() => []),

      // Floor plans
      prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "CommunityFloorPlan" WHERE "communityId" = $1 AND "active" = true ORDER BY "name" ASC`,
        id
      ).catch(() => []),

      // Notes (most recent first, pinned on top)
      prisma.$queryRawUnsafe<any[]>(
        `SELECT cn.*, s."firstName" || ' ' || s."lastName" AS "authorName"
         FROM "CommunityNote" cn
         LEFT JOIN "Staff" s ON s.id = cn."authorId"
         WHERE cn."communityId" = $1
         ORDER BY cn."pinned" DESC, cn."createdAt" DESC
         LIMIT 20`,
        id
      ).catch(() => []),

      // Jobs (most recent 25)
      prisma.$queryRawUnsafe<any[]>(
        `SELECT j.id, j."jobNumber", j."lotBlock", j.community, j."jobAddress",
                j.status, j."scopeType", j."scheduledDate", j."completedAt",
                j."builderName", j."builderContact", j."createdAt",
                s."firstName" || ' ' || s."lastName" AS "pmName"
         FROM "Job" j
         LEFT JOIN "Staff" s ON s.id = j."assignedPMId"
         WHERE j."communityId" = $1 OR (j."communityId" IS NULL AND j."community" = $2)
         ORDER BY j."createdAt" DESC
         LIMIT 25`,
        id, community.name
      ).catch(() => []),

      // Open tasks
      prisma.$queryRawUnsafe<any[]>(
        `SELECT t.*, s."firstName" || ' ' || s."lastName" AS "assigneeName"
         FROM "Task" t
         JOIN "Staff" s ON s.id = t."assigneeId"
         WHERE t."communityId" = $1 AND t."status" NOT IN ('DONE', 'CANCELLED')
         ORDER BY t."priority" DESC, t."dueDate" ASC
         LIMIT 20`,
        id
      ).catch(() => []),

      // Communication log (recent 20)
      prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "CommunicationLog"
         WHERE "communityId" = $1
         ORDER BY "sentAt" DESC
         LIMIT 20`,
        id
      ).catch(() => []),

      // Job status breakdown
      prisma.$queryRawUnsafe<any[]>(
        `SELECT j.status, COUNT(*)::int AS count
         FROM "Job" j
         WHERE j."communityId" = $1 OR (j."communityId" IS NULL AND j."community" = $2)
         GROUP BY j.status
         ORDER BY count DESC`,
        id, community.name
      ).catch(() => []),

      // Order/revenue stats from linked jobs
      prisma.$queryRawUnsafe<any[]>(
        `SELECT
           COUNT(DISTINCT o.id)::int AS "totalOrders",
           COALESCE(SUM(o.total), 0)::float AS "totalRevenue",
           COALESCE(AVG(o.total), 0)::float AS "avgOrderValue",
           MAX(o."createdAt") AS "lastOrderDate"
         FROM "Job" j
         JOIN "Order" o ON o.id = j."orderId"
         WHERE j."communityId" = $1 OR (j."communityId" IS NULL AND j."community" = $2)`,
        id, community.name
      ).catch(() => [{ totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, lastOrderDate: null }]),
    ])

    return NextResponse.json({
      community,
      contacts,
      floorPlans,
      notes,
      jobs,
      tasks,
      commLogs,
      stats: {
        jobsByStatus: jobStats,
        ...((orderStats as any[])[0] || {}),
      },
    })
  } catch (error: any) {
    console.error('Community detail error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/ops/communities/[id] — Update community
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = params

  try {
    // Audit log
    audit(request, 'UPDATE', 'Community', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const allowedFields = [
      'name', 'code', 'address', 'city', 'state', 'zip', 'county',
      'totalLots', 'activeLots', 'phase', 'status', 'division', 'notes',
    ]

    const sets: string[] = []
    const values: any[] = []
    let idx = 1

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'status') {
          sets.push(`"${field}" = $${idx}::"CommunityStatus"`)
        } else {
          sets.push(`"${field}" = $${idx}`)
        }
        values.push(body[field])
        idx++
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    sets.push(`"updatedAt" = NOW()`)
    values.push(id)

    const result: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "Community" SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      ...values
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Community not found' }, { status: 404 })
    }

    return NextResponse.json({ community: result[0] })
  } catch (error: any) {
    console.error('Community update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
