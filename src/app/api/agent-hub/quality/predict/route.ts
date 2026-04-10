export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/quality/predict
 * Pre-delivery risk assessment. Scores each delivery job for quality risk factors.
 * Runs before deliveries go out — high-risk ones get flagged for extra QC.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const targetDate = body.targetDate || new Date().toISOString().split('T')[0]
    const jobId = body.jobId // Optional: assess a single job

    // Find jobs/deliveries to assess
    let jobFilter = ''
    const params: any[] = [targetDate]
    if (jobId) {
      jobFilter = `AND j."id" = $2`
      params.push(jobId)
    }

    const jobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT j."id" AS "jobId", j."jobNumber", j."builderName",
             j."scopeType"::text AS "scopeType", j."community",
             j."status"::text AS "jobStatus",
             d."id" AS "deliveryId", d."crewId",
             o."total" AS "orderValue",
             o."id" AS "orderId",
             c."name" AS "crewName"
      FROM "Job" j
      LEFT JOIN "Delivery" d ON d."jobId" = j."id" AND d."status"::text NOT IN ('CANCELLED', 'DELIVERED')
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      LEFT JOIN "Crew" c ON c."id" = d."crewId"
      WHERE j."scheduledDate"::date = $1::date
        ${jobFilter}
      ORDER BY o."total" DESC NULLS LAST
    `, ...params)

    if (jobs.length === 0) {
      return NextResponse.json({
        message: 'No jobs found for quality prediction',
        predictions: [],
      })
    }

    const predictions: any[] = []

    for (const job of jobs) {
      const riskFactors: { factor: string; weight: number; detail: string }[] = []
      let totalRisk = 0

      // ── Factor 1: Order value (high-value = higher stakes) ──
      const orderValue = Number(job.orderValue) || 0
      if (orderValue > 10000) {
        riskFactors.push({ factor: 'HIGH_VALUE_ORDER', weight: 15, detail: `Order value $${orderValue.toFixed(0)} exceeds $10K threshold` })
        totalRisk += 15
      } else if (orderValue > 5000) {
        riskFactors.push({ factor: 'MEDIUM_VALUE_ORDER', weight: 8, detail: `Order value $${orderValue.toFixed(0)}` })
        totalRisk += 8
      }

      // ── Factor 2: Scope complexity ──
      if (job.scopeType === 'FULL_PACKAGE') {
        riskFactors.push({ factor: 'FULL_PACKAGE_SCOPE', weight: 20, detail: 'Full package scope — complex delivery with many line items' })
        totalRisk += 20
      } else if (job.scopeType === 'CUSTOM') {
        riskFactors.push({ factor: 'CUSTOM_SCOPE', weight: 25, detail: 'Custom scope — non-standard items increase error risk' })
        totalRisk += 25
      }

      // ── Factor 3: Builder complaint history ──
      try {
        const complaints: any[] = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int AS count
          FROM "Activity"
          WHERE "entityType" = 'Builder'
            AND "action" LIKE '%COMPLAINT%'
            AND "entityId" IN (
              SELECT "builderId" FROM "Order" WHERE "id" = $1
            )
        `, job.orderId || 'none')

        const complaintCount = complaints[0]?.count || 0
        if (complaintCount > 2) {
          riskFactors.push({ factor: 'COMPLAINT_HISTORY', weight: 20, detail: `Builder has ${complaintCount} prior complaints` })
          totalRisk += 20
        } else if (complaintCount > 0) {
          riskFactors.push({ factor: 'PRIOR_COMPLAINTS', weight: 10, detail: `Builder has ${complaintCount} prior complaint(s)` })
          totalRisk += 10
        }
      } catch (e) {
        // Activity table might not have complaints — skip
      }

      // ── Factor 4: No crew assigned ──
      if (!job.crewId) {
        riskFactors.push({ factor: 'NO_CREW', weight: 15, detail: 'No delivery crew assigned' })
        totalRisk += 15
      }

      // ── Factor 5: Item count on the order ──
      try {
        const itemCount: any[] = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int AS count, COUNT(DISTINCT "productId")::int AS "uniqueProducts"
          FROM "OrderItem"
          WHERE "orderId" = $1
        `, job.orderId || 'none')

        const items = itemCount[0]?.count || 0
        const unique = itemCount[0]?.uniqueProducts || 0
        if (items > 50) {
          riskFactors.push({ factor: 'LARGE_ORDER', weight: 15, detail: `${items} line items, ${unique} unique products` })
          totalRisk += 15
        } else if (items > 20) {
          riskFactors.push({ factor: 'MEDIUM_ORDER', weight: 5, detail: `${items} line items` })
          totalRisk += 5
        }
      } catch (e) {
        // Skip if OrderItem query fails
      }

      // Cap risk at 100
      const riskScore = Math.min(100, totalRisk)
      const recommendation = riskScore >= 60 ? 'PM_REVIEW'
        : riskScore >= 35 ? 'EXTRA_QC'
        : 'STANDARD'

      // Save prediction
      const predId = `qp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(`
        INSERT INTO "QualityPrediction" (
          "id", "jobId", "deliveryId", "riskScore", "riskFactors",
          "recommendation", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
        ON CONFLICT ("id") DO NOTHING
      `,
        predId,
        job.jobId,
        job.deliveryId || null,
        riskScore,
        JSON.stringify(riskFactors),
        recommendation
      )

      // If high risk, create an alert task
      if (riskScore >= 60) {
        const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "AgentTask" (
              "id", "agentRole", "taskType", "title", "description",
              "priority", "status", "payload", "requiresApproval",
              "createdBy", "createdAt", "updatedAt"
            ) VALUES (
              $1, 'OPS', 'CUSTOM', $2, $3,
              'HIGH', 'PENDING', $4::jsonb, true,
              'agent:OPS', NOW(), NOW()
            )
          `,
            taskId,
            `QC Alert: ${job.jobNumber} (Risk ${riskScore}/100)`,
            `High-risk delivery for ${job.builderName}. ${riskFactors.map(f => f.detail).join('; ')}`,
            JSON.stringify({ qualityPredictionId: predId, jobId: job.jobId, riskScore, riskFactors, recommendation })
          )
        } catch (e) {
          console.error('Failed to create QC alert task:', e)
        }
      }

      predictions.push({
        jobId: job.jobId,
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        deliveryId: job.deliveryId,
        crewName: job.crewName,
        orderValue,
        riskScore,
        recommendation,
        riskFactors,
      })
    }

    // Sort by risk (highest first)
    predictions.sort((a, b) => b.riskScore - a.riskScore)

    return NextResponse.json({
      targetDate,
      totalJobs: jobs.length,
      highRisk: predictions.filter(p => p.riskScore >= 60).length,
      mediumRisk: predictions.filter(p => p.riskScore >= 35 && p.riskScore < 60).length,
      lowRisk: predictions.filter(p => p.riskScore < 35).length,
      predictions,
    })
  } catch (error) {
    console.error('POST /api/agent-hub/quality/predict error:', error)
    return NextResponse.json({ error: 'Failed to generate quality predictions' }, { status: 500 })
  }
}

/**
 * GET /api/agent-hub/quality/predict
 * Retrieve existing quality predictions.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const unresolved = searchParams.get('unresolved') === 'true'
    const minRisk = parseInt(searchParams.get('minRisk') || '0', 10)

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (unresolved) {
      conditions.push(`qp."resolved" = false`)
    }
    if (minRisk > 0) {
      conditions.push(`qp."riskScore" >= $${idx}`)
      params.push(minRisk)
      idx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const predictions: any[] = await prisma.$queryRawUnsafe(`
      SELECT qp.*, j."jobNumber", j."builderName", j."community"
      FROM "QualityPrediction" qp
      JOIN "Job" j ON j."id" = qp."jobId"
      ${whereClause}
      ORDER BY qp."riskScore" DESC
      LIMIT 50
    `, ...params)

    return NextResponse.json({
      data: predictions,
      total: predictions.length,
    })
  } catch (error) {
    console.error('GET /api/agent-hub/quality/predict error:', error)
    return NextResponse.json({ error: 'Failed to fetch quality predictions' }, { status: 500 })
  }
}
