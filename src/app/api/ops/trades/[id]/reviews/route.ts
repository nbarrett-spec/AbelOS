export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/trades/[id]/reviews — Get reviews for a trade
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const reviews: any[] = await prisma.$queryRawUnsafe(
      `SELECT r.*,
              s."firstName" || ' ' || s."lastName" as "reviewerName",
              j."jobNumber"
       FROM "TradeReview" r
       LEFT JOIN "Staff" s ON s.id = r."reviewerId"
       LEFT JOIN "Job" j ON j.id = r."jobId"
       WHERE r."tradeId" = $1
       ORDER BY r."createdAt" DESC`,
      params.id
    )
    return NextResponse.json({ reviews })
  } catch (error: any) {
    console.error('[TradeReviews GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/trades/[id]/reviews — Add a review
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { rating, quality, reliability, communication, comment, jobId } = await request.json()
    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating 1-5 is required' }, { status: 400 })
    }

    const staffId = request.headers.get('x-staff-id')

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "TradeReview" ("id", "tradeId", "reviewerId", "jobId", "rating", "quality", "reliability", "communication", "comment")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      params.id, staffId || null, jobId || null,
      rating, quality || null, reliability || null, communication || null, comment || null
    )

    // Update trade aggregate rating
    await prisma.$executeRawUnsafe(
      `UPDATE "Trade" SET
        "rating" = (SELECT AVG("rating")::numeric(3,2) FROM "TradeReview" WHERE "tradeId" = $1),
        "reviewCount" = (SELECT COUNT(*)::int FROM "TradeReview" WHERE "tradeId" = $1),
        "updatedAt" = NOW()
       WHERE id = $1`,
      params.id
    )

    return NextResponse.json({ review: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[TradeReviews POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
