export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Single query: get all builders with aggregated stats (no N+1)
    const builders = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT
        b.id,
        b."companyName",
        b."contactName",
        b.email,
        b.phone,
        b."paymentTerm",
        b.status,
        b."createdAt",
        COALESCE((SELECT COUNT(*)::int FROM "Project" WHERE "builderId" = b.id), 0) as "totalProjects",
        COALESCE((SELECT COUNT(*)::int FROM "Order" WHERE "builderId" = b.id), 0) as "totalOrders",
        COALESCE(qs."quoteCount", 0)::int as "totalQuotes",
        COALESCE(qs."quoteRevenue", 0)::numeric as "totalRevenue"
       FROM "Builder" b
       LEFT JOIN LATERAL (
         SELECT COUNT(q.id) as "quoteCount", COALESCE(SUM(q.total), 0) as "quoteRevenue"
         FROM "Quote" q
         JOIN "Project" p ON q."projectId" = p.id
         WHERE p."builderId" = b.id
       ) qs ON true
       ORDER BY b."createdAt" DESC`
    )

    return NextResponse.json({ builders })
  } catch (error: any) {
    console.error('[Admin Builders GET]', error?.message || error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
