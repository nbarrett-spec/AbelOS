export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Fetch jobs with status IN ('IN_PRODUCTION', 'STAGED', 'LOADED')
    const jobsQuery = `
      SELECT
        j.id,
        j."jobNumber",
        j."builderName",
        j.community,
        j."lotBlock",
        j."scheduledDate",
        j.status
      FROM "Job" j
      WHERE j.status::text IN ('IN_PRODUCTION', 'STAGED', 'LOADED')
      ORDER BY j."scheduledDate" ASC
    `

    const jobs: any = await prisma.$queryRawUnsafe(jobsQuery)

    // For each job, fetch its material picks
    const jobsWithPicks = await Promise.all(
      jobs.map(async (job: any) => {
        const picksQuery = `
          SELECT
            id,
            sku,
            description,
            quantity,
            "pickedQty",
            status
          FROM "MaterialPick"
          WHERE "jobId" = $1
        `

        const picks: any = await prisma.$queryRawUnsafe(picksQuery, job.id)

        return {
          id: job.id,
          jobNumber: job.jobNumber,
          builderName: job.builderName,
          community: job.community,
          lotBlock: job.lotBlock,
          scheduledDate: job.scheduledDate,
          status: job.status,
          materialPicks: picks,
          materialPicksCount: picks.length,
        }
      })
    )

    // Count jobs by status
    const countQuery = `
      SELECT status, COUNT(*)::int as count
      FROM "Job"
      WHERE status::text IN ('IN_PRODUCTION', 'STAGED', 'LOADED')
      GROUP BY status
    `

    const countResults: any = await prisma.$queryRawUnsafe(countQuery)

    const counts: Record<string, number> = {}
    countResults.forEach((item: any) => {
      counts[item.status] = item.count
    })

    return NextResponse.json({
      jobs: jobsWithPicks,
      total: jobsWithPicks.length,
      statusCounts: counts,
    })
  } catch (error) {
    console.error('Staging error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch staging jobs' },
      { status: 500 }
    )
  }
}
