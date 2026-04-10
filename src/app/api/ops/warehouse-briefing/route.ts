export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Production Queue - today's jobs ordered by priority/scheduled date
    const productionQueueData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        j."status",
        j."scheduledDate",
        COUNT(DISTINCT mp."id") FILTER (WHERE mp."status"::text IN ('PENDING', 'PICKING')) as "picksRemaining",
        COUNT(DISTINCT mp."id") FILTER (WHERE mp."status"::text IN ('PICKED', 'VERIFIED')) as "picksCompleted"
      FROM "Job" j
      LEFT JOIN "MaterialPick" mp ON j."id" = mp."jobId"
      WHERE j."status"::text IN ('IN_PRODUCTION', 'READY_TO_STAGE')
        AND j."scheduledDate" <= $2::timestamptz
      GROUP BY j."id", j."jobNumber", j."builderName", j."community", j."status", j."scheduledDate"
      ORDER BY j."scheduledDate" ASC, j."createdAt" ASC
      LIMIT 20`,
      today.toISOString(),
      tomorrow.toISOString()
    )

    // Pending Picks - incomplete pick lists
    const pendingPicksData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        mp."id",
        mp."jobId",
        j."jobNumber",
        COUNT(*)::int as "itemCount",
        mp."createdAt",
        mp."status"
      FROM "MaterialPick" mp
      LEFT JOIN "Job" j ON mp."jobId" = j."id"
      WHERE mp."status"::text IN ('PENDING', 'PICKING')
      GROUP BY mp."jobId", mp."id", j."jobNumber", mp."createdAt", mp."status"
      ORDER BY mp."createdAt" ASC
      LIMIT 30`
    )

    // QC Checks Needed - jobs ready for inspection
    const qcNeededData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        COUNT(DISTINCT se."id")::int as "productCount",
        MAX(j."scheduledDate") as "scheduledDate"
      FROM "Job" j
      LEFT JOIN "ScheduleEntry" se ON j."id" = se."jobId"
      WHERE j."status"::text = 'READY_FOR_QC'
      GROUP BY j."id", j."jobNumber", j."builderName"
      ORDER BY j."scheduledDate" ASC
      LIMIT 20`
    )

    // Staging Ready - completed and ready for load
    const stagingReadyData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        COUNT(DISTINCT se."id")::int as "itemCount",
        j."scheduledDate"
      FROM "Job" j
      LEFT JOIN "ScheduleEntry" se ON j."id" = se."jobId"
      WHERE j."status"::text = 'READY_TO_STAGE'
      GROUP BY j."id", j."jobNumber", j."builderName", j."community", j."scheduledDate"
      ORDER BY j."scheduledDate" ASC
      LIMIT 20`
    )

    // Materials Arriving Today - POs arriving today
    const materialsArrivingData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        po."id",
        po."poNumber",
        json_build_object(
          'id', v."id",
          'name', v."name"
        ) as "vendor",
        COUNT(poi."id")::int as "itemCount",
        po."total" as "totalAmount",
        po."expectedDate"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      LEFT JOIN "PurchaseOrderItem" poi ON po."id" = poi."purchaseOrderId"
      WHERE po."expectedDate" >= $1::timestamptz
        AND po."expectedDate" < $2::timestamptz
        AND po."status"::text != 'CANCELLED'
      GROUP BY po."id", v."id"
      ORDER BY po."expectedDate" ASC`,
      today.toISOString(),
      tomorrow.toISOString()
    )

    // Exceptions - production issues
    const exceptionsData = await prisma.$queryRawUnsafe<any[]>(
      `WITH exceptions AS (
        SELECT
          'SHORT_PICK' as type,
          j."jobNumber",
          j."id",
          'short'::text as severity,
          COUNT(*)::int as count,
          'Items short on pick list' as description
        FROM "MaterialPick" mp
        LEFT JOIN "Job" j ON mp."jobId" = j."id"
        WHERE mp."status"::text = 'SHORT'
        GROUP BY j."jobNumber", j."id"

        UNION ALL

        SELECT
          'QC_FAIL' as type,
          j."jobNumber",
          j."id",
          'warning'::text as severity,
          COUNT(*)::int as count,
          'Failed QC checks' as description
        FROM "QualityCheck" qc
        LEFT JOIN "Job" j ON qc."jobId" = j."id"
        WHERE qc."result"::text = 'FAIL'
          AND qc."createdAt" >= NOW() - INTERVAL '24 hours'
        GROUP BY j."jobNumber", j."id"

        UNION ALL

        SELECT
          'MISSING_MATERIAL' as type,
          j."jobNumber",
          j."id",
          'critical'::text as severity,
          COUNT(*)::int as count,
          'Missing components needed for production' as description
        FROM "MaterialPick" mp
        LEFT JOIN "Job" j ON mp."jobId" = j."id"
        WHERE mp."status"::text IN ('PENDING', 'SHORT')
          AND j."status"::text = 'IN_PRODUCTION'
          AND mp."createdAt" < NOW() - INTERVAL '4 hours'
        GROUP BY j."jobNumber", j."id"
      )
      SELECT * FROM exceptions
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'warning' THEN 2
          ELSE 3
        END,
        jobNumber ASC
      LIMIT 20`
    )

    // Count metrics for summary
    const [jobsInProd, picksToComplete, qcChecks, itemsToStage, materialsArriving] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count FROM "Job" WHERE status::text = 'IN_PRODUCTION'`
      ),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(DISTINCT "jobId")::int as count FROM "MaterialPick" WHERE status::text IN ('PENDING', 'PICKING')`
      ),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(DISTINCT "jobId")::int as count FROM "Job" WHERE status::text = 'READY_FOR_QC'`
      ),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(DISTINCT "jobId")::int as count FROM "Job" WHERE status::text = 'READY_TO_STAGE'`
      ),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count FROM "PurchaseOrder"
         WHERE "expectedDate" >= $1::timestamptz AND "expectedDate" < $2::timestamptz
         AND status::text != 'CANCELLED'`,
        today.toISOString(),
        tomorrow.toISOString()
      ),
    ])

    const summary = {
      jobsInProduction: jobsInProd[0]?.count || 0,
      picksToComplete: picksToComplete[0]?.count || 0,
      qcChecksNeeded: qcChecks[0]?.count || 0,
      itemsToStage: itemsToStage[0]?.count || 0,
      materialsArriving: materialsArriving[0]?.count || 0,
      exceptions: exceptionsData.length,
    }

    return safeJson({
      summary,
      productionQueue: productionQueueData,
      pendingPicks: pendingPicksData,
      qcNeeded: qcNeededData,
      stagingReady: stagingReadyData,
      materialsArriving: materialsArrivingData,
      exceptions: exceptionsData,
    })
  } catch (error) {
    console.error('GET /api/ops/warehouse-briefing error:', error)
    return safeJson(
      { error: 'Failed to fetch warehouse briefing', details: String((error as any)?.message || error) },
      { status: 500 }
    )
  }
}
