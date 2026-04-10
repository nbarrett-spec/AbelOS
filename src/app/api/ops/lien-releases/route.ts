export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/lien-releases — List lien releases with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const type = sp.get('type')
    const builderId = sp.get('builderId')
    const jobId = sp.get('jobId')
    const page = parseInt(sp.get('page') || '1')
    const limit = Math.min(100, parseInt(sp.get('limit') || '50'))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (status) { conditions.push(`lr."status" = $${paramIdx++}`); params.push(status) }
    if (type) { conditions.push(`lr."type" = $${paramIdx++}`); params.push(type) }
    if (builderId) { conditions.push(`lr."builderId" = $${paramIdx++}`); params.push(builderId) }
    if (jobId) { conditions.push(`lr."jobId" = $${paramIdx++}`); params.push(jobId) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const releases: any[] = await prisma.$queryRawUnsafe(
      `SELECT lr.*,
              j."jobNumber", j."builderName", j."jobAddress",
              b."companyName"
       FROM "LienRelease" lr
       LEFT JOIN "Job" j ON j.id = lr."jobId"
       LEFT JOIN "Builder" b ON b.id = lr."builderId"
       ${where}
       ORDER BY lr."createdAt" DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      ...params, limit, offset
    )

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM "LienRelease" lr ${where}`,
      ...params
    )

    // Summary stats
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int as total,
         COUNT(*) FILTER (WHERE status = 'PENDING')::int as pending,
         COUNT(*) FILTER (WHERE status = 'ISSUED')::int as issued,
         COUNT(*) FILTER (WHERE status = 'SIGNED')::int as signed,
         COALESCE(SUM(amount) FILTER (WHERE status = 'SIGNED'), 0) as "signedAmount",
         COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0) as "pendingAmount"
       FROM "LienRelease"`
    )

    return NextResponse.json({
      releases,
      total: countResult[0]?.total || 0,
      page,
      totalPages: Math.ceil((countResult[0]?.total || 0) / limit),
      stats: stats[0] || {},
    })
  } catch (error: any) {
    console.error('[LienReleases GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/lien-releases — Create a lien release
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { jobId, builderId, invoiceId, type, amount, throughDate, notes } = body

    if (!jobId || !amount) {
      return NextResponse.json({ error: 'jobId and amount are required' }, { status: 400 })
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "LienRelease" ("id", "jobId", "builderId", "invoiceId", "type", "amount", "throughDate", "notes", "status")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::date, $7, 'PENDING')
       RETURNING *`,
      jobId, builderId || null, invoiceId || null, type || 'CONDITIONAL', amount,
      throughDate || null, notes || null
    )

    return NextResponse.json({ release: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[LienReleases POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
