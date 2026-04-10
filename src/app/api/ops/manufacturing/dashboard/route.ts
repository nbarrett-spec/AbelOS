export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get jobs in production or staged
    let productionQueue: any[] = []
    try {
      const result = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          jobNumber: string
          builderName: string
          community: string
          scheduledDate: Date
          status: string
        }>
      >(
        `SELECT id, "jobNumber", "builderName", community, "scheduledDate", status
         FROM "Job"
         WHERE status::text IN ('IN_PRODUCTION', 'STAGED')
         ORDER BY "scheduledDate" ASC
         LIMIT 10`
      )
      productionQueue = result
    } catch {
      productionQueue = []
    }

    // Get material pick status summary
    let materialPickSummary = {
      pending: 0,
      picking: 0,
      picked: 0,
      verified: 0,
      short: 0,
    }
    try {
      const counts = await prisma.$queryRawUnsafe<
        Array<{ status: string; count: number }>
      >(
        `SELECT status, COUNT(*)::int as count
         FROM "MaterialPick"
         GROUP BY status`
      )
      counts.forEach((row) => {
        if (row.status === 'PENDING') materialPickSummary.pending = row.count
        else if (row.status === 'PICKING') materialPickSummary.picking = row.count
        else if (row.status === 'PICKED') materialPickSummary.picked = row.count
        else if (row.status === 'VERIFIED') materialPickSummary.verified = row.count
        else if (row.status === 'SHORT') materialPickSummary.short = row.count
      })
    } catch {
      materialPickSummary = {
        pending: 0,
        picking: 0,
        picked: 0,
        verified: 0,
        short: 0,
      }
    }

    // Get recent quality checks with job number
    let recentChecks: Array<{
      id: string
      jobId: string
      checkType: string
      result: string
      createdAt: Date
      jobNumber: string
    }> = []
    try {
      const result = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          jobId: string
          checkType: string
          result: string
          createdAt: Date
          jobNumber: string
        }>
      >(
        `SELECT qc.id, qc."jobId", qc."checkType", qc.result, qc."createdAt", j."jobNumber"
         FROM "QualityCheck" qc
         LEFT JOIN "Job" j ON qc."jobId" = j.id
         ORDER BY qc."createdAt" DESC
         LIMIT 10`
      )
      recentChecks = result.map((check) => ({
        ...check,
        jobNumber: check.jobNumber || 'N/A',
      }))
    } catch {
      recentChecks = []
    }

    // Calculate QC pass rate
    let passRate = 0
    try {
      const result = await prisma.$queryRawUnsafe<
        Array<{ total: number; passed: number }>
      >(
        `SELECT COUNT(*)::int as total,
                SUM(CASE WHEN result::text = 'PASS' THEN 1 ELSE 0 END)::int as passed
         FROM "QualityCheck"`
      )
      if (result.length > 0 && result[0].total > 0) {
        passRate = result[0].passed / result[0].total
      }
    } catch {
      passRate = 0
    }

    // Get jobsInProduction count
    let jobsInProduction = 0
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM "Job"
         WHERE status::text = 'IN_PRODUCTION'`
      )
      jobsInProduction = result.length > 0 ? result[0].count : 0
    } catch {
      jobsInProduction = 0
    }

    // Get picksPending count
    let picksPending = 0
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM "MaterialPick"
         WHERE status::text IN ('PENDING', 'PICKING')`
      )
      picksPending = result.length > 0 ? result[0].count : 0
    } catch {
      picksPending = 0
    }

    // Get itemsStaged count
    let itemsStaged = 0
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM "MaterialPick"
         WHERE status::text = 'VERIFIED'`
      )
      itemsStaged = result.length > 0 ? result[0].count : 0
    } catch {
      itemsStaged = 0
    }

    const response = {
      productionQueue: productionQueue.map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        community: job.community,
        scheduledDate: job.scheduledDate,
        status: job.status === 'IN_PRODUCTION' ? 'IN_PRODUCTION' : 'STAGED',
      })),
      materialPickSummary,
      qualityCheckSummary: {
        recentChecks: recentChecks.map((check) => ({
          id: check.id,
          jobId: check.jobId,
          checkType: check.checkType,
          result: check.result,
          createdAt: check.createdAt,
          jobNumber: check.jobNumber,
        })),
        passRate,
      },
      todaysProduction: {
        jobsInProduction,
        itemsStaged,
        qcPassRate: passRate,
        picksPending,
      },
      kpis: {
        jobsInProduction,
        picksPending,
        qcPassRate: passRate,
        itemsStaged,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Dashboard error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}
