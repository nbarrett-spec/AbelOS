export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

// ──────────────────────────────────────────────────────────────────────────
// Manufacturing AI Assistant — Real-time production floor insights
// ──────────────────────────────────────────────────────────────────────────

interface ManufacturingAIRequest {
  message: string
}

interface ManufacturingContext {
  jobsInProductionCount: number
  jobsInProductionList: Array<{
    jobNumber: string
    builderName: string
    scheduledDate: string
  }>
  jobsStagedLoadedCount: number
  pickSummary: {
    pending: number
    picking: number
    picked: number
    verified: number
    short: number
  }
  qcStatsLast30Days: {
    totalChecks: number
    passRate: number
    failCount: number
  }
  topShortageItems: Array<{
    sku: string
    shortCount: number
  }>
  inventoryAlerts: {
    outOfStock: number
    critical: number
  }
  recentCompletions: Array<{
    jobNumber: string
    completedDate: string
  }>
  overdueJobs: Array<{
    jobNumber: string
    builderName: string
    scheduledDate: string
    daysOverdue: number
  }>
  posAwaitingReceipt: number
}

interface ManufacturingAIResponse {
  success: boolean
  response: string
  context: {
    jobsInProduction: number
    picksPending: number
    qcPassRate: number
    shortages: number
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Check authentication via headers
    const staffId = request.headers.get('x-staff-id')
    const staffRole = request.headers.get('x-staff-role')
    if (!staffId || !staffRole) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request body
    const body = (await request.json()) as ManufacturingAIRequest
    if (!body.message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    // 3. Fetch real-time manufacturing context from database
    const context = await fetchManufacturingContext()

    // 4. Prepare system prompt with manufacturing snapshot
    const systemPrompt = buildSystemPrompt(context)

    // 5. Call Claude API
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: body.message,
        },
      ],
    })

    // 6. Extract text response
    const aiResponse = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => (block as any).text)
      .join('\n')

    // 7. Return response with context
    const result: ManufacturingAIResponse = {
      success: true,
      response: aiResponse,
      context: {
        jobsInProduction: context.jobsInProductionCount,
        picksPending: context.pickSummary.pending,
        qcPassRate: context.qcStatsLast30Days.passRate,
        shortages: context.topShortageItems.length,
      },
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[manufacturing-ai] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch real-time manufacturing context from database
// ──────────────────────────────────────────────────────────────────────────

async function fetchManufacturingContext(): Promise<ManufacturingContext> {
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

  // 1. Jobs in production (status IN_PRODUCTION) - top 5
  const jobsInProduction = await prisma.$queryRawUnsafe<
    Array<{
      jobNumber: string
      builderName: string
      scheduledDate: Date | null
    }>
  >(
    `
    SELECT "jobNumber", "builderName", "scheduledDate"
    FROM "Job"
    WHERE "status" = 'IN_PRODUCTION'
    ORDER BY "scheduledDate" ASC NULLS LAST
    LIMIT 5
  `
  )

  const jobsInProductionList = jobsInProduction.map((job: any) => ({
    jobNumber: job.jobNumber,
    builderName: job.builderName,
    scheduledDate: job.scheduledDate
      ? new Date(job.scheduledDate).toISOString().split('T')[0]
      : 'TBD',
  }))

  // 2. Jobs staged/loaded count
  const stagedLoadedResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "Job"
    WHERE "status" IN ('STAGED', 'LOADED')
  `
  )
  const jobsStagedLoadedCount = Number(stagedLoadedResult[0]?.count ?? 0)

  // 3. Pick summary by status
  const pickStatusResult = await prisma.$queryRawUnsafe<
    Array<{ status: string; count: bigint }>
  >(
    `
    SELECT "status", COUNT(*) as count
    FROM "MaterialPick"
    GROUP BY "status"
  `
  )
  const pickSummary = {
    pending: 0,
    picking: 0,
    picked: 0,
    verified: 0,
    short: 0,
  }
  pickStatusResult.forEach((row: any) => {
    const status = row.status.toLowerCase()
    if (status in pickSummary) {
      pickSummary[status as keyof typeof pickSummary] = Number(row.count)
    }
  })

  // 4. QC stats for last 30 days
  const qcTotalResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "QualityCheck"
    WHERE "createdAt" >= $1
  `,
    thirtyDaysAgo.toISOString()
  )
  const qcTotalChecks = Number(qcTotalResult[0]?.count ?? 0)

  const qcPassResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "QualityCheck"
    WHERE "createdAt" >= $1
      AND "result" = 'PASS'
  `,
    thirtyDaysAgo.toISOString()
  )
  const qcPassCount = Number(qcPassResult[0]?.count ?? 0)
  const qcPassRate =
    qcTotalChecks > 0 ? Math.round((qcPassCount / qcTotalChecks) * 100) : 0

  const qcFailResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "QualityCheck"
    WHERE "createdAt" >= $1
      AND "result" = 'FAIL'
  `,
    thirtyDaysAgo.toISOString()
  )
  const qcFailCount = Number(qcFailResult[0]?.count ?? 0)

  // 5. Top 5 shortage items (MaterialPick status SHORT grouped by SKU)
  const shortageItems = await prisma.$queryRawUnsafe<
    Array<{
      sku: string
      count: bigint
    }>
  >(
    `
    SELECT "sku", COUNT(*) as count
    FROM "MaterialPick"
    WHERE "status" = 'SHORT'
    GROUP BY "sku"
    ORDER BY count DESC
    LIMIT 5
  `
  )
  const topShortageItems = shortageItems.map((item: any) => ({
    sku: item.sku,
    shortCount: Number(item.count),
  }))

  // 6. Inventory alerts: out of stock and critical counts
  const outOfStockResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "Inventory"
    WHERE "onHand" = 0
  `
  )
  const outOfStockCount = Number(outOfStockResult[0]?.count ?? 0)

  const criticalResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "Inventory"
    WHERE "onHand" > 0 AND "onHand" <= "reorderPoint"
  `
  )
  const criticalCount = Number(criticalResult[0]?.count ?? 0)

  // 7. Recent completions (last 3 jobs that reached STAGED with dates)
  const recentCompletions = await prisma.$queryRawUnsafe<
    Array<{
      jobNumber: string
      updatedAt: Date
    }>
  >(
    `
    SELECT DISTINCT "jobNumber", "updatedAt"
    FROM (
      SELECT j."jobNumber", j."updatedAt", ROW_NUMBER() OVER (ORDER BY j."updatedAt" DESC) as rn
      FROM "Job" j
      WHERE j."status" = 'STAGED'
      ORDER BY j."updatedAt" DESC
      LIMIT 3
    ) subq
    ORDER BY "updatedAt" DESC
  `
  )
  const recentCompletionsList = recentCompletions.map((job: any) => ({
    jobNumber: job.jobNumber,
    completedDate: new Date(job.updatedAt).toISOString().split('T')[0],
  }))

  // 8. Overdue jobs (scheduledDate < today and status not in STAGED, LOADED)
  const overdueJobs = await prisma.$queryRawUnsafe<
    Array<{
      jobNumber: string
      builderName: string
      scheduledDate: Date
    }>
  >(
    `
    SELECT "jobNumber", "builderName", "scheduledDate"
    FROM "Job"
    WHERE "scheduledDate" < CURRENT_DATE
      AND "status" NOT IN ('STAGED', 'LOADED')
    ORDER BY "scheduledDate" ASC
  `
  )
  const overdueJobsList = overdueJobs.map((job: any) => {
    const scheduled = new Date(job.scheduledDate)
    const daysOverdue = Math.floor(
      (today.getTime() - scheduled.getTime()) / (1000 * 60 * 60 * 24)
    )
    return {
      jobNumber: job.jobNumber,
      builderName: job.builderName,
      scheduledDate: scheduled.toISOString().split('T')[0],
      daysOverdue,
    }
  })

  // 9. POs awaiting receipt count
  const posAwaitingResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `
    SELECT COUNT(*) as count
    FROM "PurchaseOrder"
    WHERE "status" IN ('SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
  `
  )
  const posAwaitingReceipt = Number(posAwaitingResult[0]?.count ?? 0)

  return {
    jobsInProductionCount: jobsInProduction.length,
    jobsInProductionList,
    jobsStagedLoadedCount,
    pickSummary,
    qcStatsLast30Days: {
      totalChecks: qcTotalChecks,
      passRate: qcPassRate,
      failCount: qcFailCount,
    },
    topShortageItems,
    inventoryAlerts: {
      outOfStock: outOfStockCount,
      critical: criticalCount,
    },
    recentCompletions: recentCompletionsList,
    overdueJobs: overdueJobsList,
    posAwaitingReceipt,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Build system prompt with manufacturing snapshot
// ──────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(context: ManufacturingContext): string {
  const today = new Date().toISOString().split('T')[0]

  const jobsInProductionText =
    context.jobsInProductionList.length > 0
      ? context.jobsInProductionList
          .map(
            (job: any) =>
              `- ${job.jobNumber} (${job.builderName}): Scheduled ${job.scheduledDate}`
          )
          .join('\n')
      : '(No jobs currently in production)'

  const topShortagesText =
    context.topShortageItems.length > 0
      ? context.topShortageItems
          .map((item: any) => `- ${item.sku}: ${item.shortCount} short picks`)
          .join('\n')
      : '(No shortage items)'

  const recentCompletionsText =
    context.recentCompletions.length > 0
      ? context.recentCompletions
          .map((job: any) => `- ${job.jobNumber}: ${job.completedDate}`)
          .join('\n')
      : '(No recent completions)'

  const overdueJobsText =
    context.overdueJobs.length > 0
      ? context.overdueJobs
          .map(
            (job: any) =>
              `- ${job.jobNumber} (${job.builderName}): ${job.daysOverdue} days overdue (scheduled ${job.scheduledDate})`
          )
          .join('\n')
      : '(No overdue jobs)'

  return `You are the AI Manufacturing Assistant for Abel Lumber. You have real-time access to the production floor data. Be concise and actionable. Use manufacturing terminology. When reporting issues, prioritize by impact to production schedule. When asked about capacity or scheduling, factor in current WIP and bottlenecks.

Current Manufacturing Snapshot:

PRODUCTION JOBS
- In Production: ${context.jobsInProductionCount} jobs
- Staged/Loaded: ${context.jobsStagedLoadedCount} jobs

TOP 5 JOBS IN PRODUCTION (by scheduled date):
${jobsInProductionText}

MATERIAL PICKING STATUS
- Pending: ${context.pickSummary.pending} picks
- Currently Picking: ${context.pickSummary.picking} picks
- Picked (awaiting verification): ${context.pickSummary.picked} picks
- Verified: ${context.pickSummary.verified} picks
- Short (cannot fulfill): ${context.pickSummary.short} picks

QUALITY CONTROL (Last 30 Days)
- Total Checks: ${context.qcStatsLast30Days.totalChecks}
- Pass Rate: ${context.qcStatsLast30Days.passRate}%
- Fails: ${context.qcStatsLast30Days.failCount}

TOP 5 SHORTAGE ITEMS
${topShortagesText}

INVENTORY ALERTS
- Out of Stock: ${context.inventoryAlerts.outOfStock} items
- Critical Stock (at or below reorder point): ${context.inventoryAlerts.critical} items

RECENT COMPLETIONS (Last 3 Staged Jobs)
${recentCompletionsText}

OVERDUE JOBS
${overdueJobsText}

PURCHASE ORDERS
- Awaiting Receipt: ${context.posAwaitingReceipt} POs (sent to vendor or partially received)

Today's date: ${today}`
}
