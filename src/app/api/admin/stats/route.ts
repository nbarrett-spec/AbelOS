export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  // SECURITY: Require staff auth for business stats
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ops-side stats — staff auth verified

    // Get total builders
    const totalBuildersResult = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::int as count FROM "Builder"`
    )
    const totalBuilders = parseInt(totalBuildersResult?.[0]?.count || '0')

    // Get total products
    const totalProductsResult = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::int as count FROM "Product" WHERE active = true`
    )
    const totalProducts = parseInt(totalProductsResult?.[0]?.count || '0')

    // Get total projects
    const totalProjectsResult = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::int as count FROM "Project"`
    )
    const totalProjects = parseInt(totalProjectsResult?.[0]?.count || '0')

    // Get recent quotes for revenue calculation
    const allQuotes = await prisma.$queryRawUnsafe<Array<{
      id: string;
      total: number;
      status: string;
      createdAt: Date;
      companyName: string;
    }>>(
      `SELECT q.id, q.total, q.status, q."createdAt", b."companyName"
       FROM "Quote" q
       JOIN "Project" p ON q."projectId" = p.id
       JOIN "Builder" b ON p."builderId" = b.id
       ORDER BY q."createdAt" DESC
       LIMIT 10`
    )

    // Get total quotes count
    const totalQuotesResult = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::int as count FROM "Quote"`
    )
    const totalQuotes = parseInt(totalQuotesResult?.[0]?.count || '0')

    const totalRevenue = allQuotes.reduce((sum, q) => sum + q.total, 0)

    // Format recent quotes for display
    const recentQuotes = allQuotes.map((quote) => ({
      id: quote.id,
      quoteNumber: `Quote #${quote.id.slice(0, 8)}`,
      builderName: quote.companyName,
      total: quote.total,
      status: quote.status,
      createdAt: quote.createdAt,
    }))

    return NextResponse.json({
      stats: {
        totalBuilders,
        totalProducts,
        totalProjects,
        totalQuotes,
        totalRevenue,
      },
      recentQuotes,
    })
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
