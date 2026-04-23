export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { generateBriefingAudio, isElevenLabsConfigured } from '@/lib/elevenlabs'

/**
 * GET /api/agent-hub/context/daily-brief
 * Today's priorities across all business areas — the morning briefing for the Coordinator.
 * Each section is wrapped in try/catch so one failure doesn't kill the whole brief.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Helper to safely run a query
  async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn() } catch (e) { console.error('Daily brief query failed:', e); return fallback }
  }

  // 1. Revenue snapshot
  const revenueToday = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN p."receivedAt" >= $1 THEN p."amount" ELSE 0 END), 0) AS "paymentsToday",
        COALESCE(SUM(p."amount"), 0) AS "paymentsThisMonth"
      FROM "Payment" p
      WHERE p."receivedAt" >= date_trunc('month', $1::timestamp)
    `, todayStart)
    return rows[0] || { paymentsToday: 0, paymentsThisMonth: 0 }
  }, { paymentsToday: 0, paymentsThisMonth: 0 })

  // 2. Overdue invoices
  const overdueStats = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalOverdue",
        COALESCE(SUM("total" - COALESCE("amountPaid",0)), 0) AS "totalOverdueAmount",
        COUNT(CASE WHEN "dueDate" < NOW() - INTERVAL '60 days' THEN 1 END)::int AS "critical60Plus"
      FROM "Invoice"
      WHERE "status"::text IN ('OVERDUE', 'SENT') AND "dueDate" < NOW()
    `)
    return rows[0] || { totalOverdue: 0, totalOverdueAmount: 0, critical60Plus: 0 }
  }, { totalOverdue: 0, totalOverdueAmount: 0, critical60Plus: 0 })

  // 3. Orders needing attention
  const orderAlerts = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "status"::text AS "status", COUNT(*)::int AS count
      FROM "Order"
      WHERE "status"::text NOT IN ('COMPLETE', 'CANCELLED', 'DELIVERED')
      GROUP BY "status"
    `)
    return rows
  }, [] as any[])

  // New orders today
  const newOrdersToday = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count, COALESCE(SUM("total"), 0) AS "totalValue"
      FROM "Order"
      WHERE "createdAt" >= $1
    `, todayStart)
    return rows[0] || { count: 0, totalValue: 0 }
  }, { count: 0, totalValue: 0 })

  // 4. Deliveries today
  const deliveriesToday = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "scheduledToday",
        COUNT(CASE WHEN d."status"::text = 'DELIVERED' THEN 1 END)::int AS "completedToday",
        COUNT(CASE WHEN d."status"::text = 'IN_TRANSIT' THEN 1 END)::int AS "inTransit"
      FROM "Delivery" d
      JOIN "Job" j ON j."id" = d."jobId"
      WHERE j."scheduledDate"::date = CURRENT_DATE
    `)
    return rows[0] || { scheduledToday: 0, completedToday: 0, inTransit: 0 }
  }, { scheduledToday: 0, completedToday: 0, inTransit: 0 })

  // 5. Stalled deals
  const stalledDeals = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT q."id", q."quoteNumber", q."total", q."createdAt",
             b."companyName" AS "builderName"
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p.id
      JOIN "Builder" b ON b."id" = p."builderId"
      WHERE q."status"::text = 'SENT' AND q."createdAt" < NOW() - INTERVAL '7 days'
      ORDER BY q."total" DESC
      LIMIT 10
    `)
    return rows
  }, [] as any[])

  // 6. At-risk builders
  const atRiskBuilders = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT bi."builderId", b."companyName", bi."healthScore", bi."orderTrend",
             bi."daysSinceLastOrder", bi."totalLifetimeValue"
      FROM "BuilderIntelligence" bi
      JOIN "Builder" b ON b."id" = bi."builderId"
      WHERE bi."orderTrend"::text IN ('DECLINING', 'CHURNING') AND bi."totalLifetimeValue" > 5000
      ORDER BY bi."totalLifetimeValue" DESC
      LIMIT 10
    `)
    return rows
  }, [] as any[])

  // 7. Agent status
  const agentStatus = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "agentRole", "status", "tasksCompletedToday", "errorsToday", "lastHeartbeat"
      FROM "AgentSession"
      ORDER BY "agentRole"
    `)
    return rows
  }, [] as any[])

  // 8. Pending approval tasks
  const pendingApprovals = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "agentRole", "taskType", "title", "priority", "createdAt"
      FROM "AgentTask"
      WHERE "requiresApproval" = true AND "approvedAt" IS NULL AND "status" = 'PENDING'
      ORDER BY
        CASE "priority" WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
        "createdAt" ASC
      LIMIT 10
    `)
    return rows
  }, [] as any[])

  // 9. Low inventory alerts (via InventoryItem table)
  const inventoryAlerts = await safeQuery(async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT p."id", p."name", p."sku", i."onHand" AS "stockQuantity",
             i."available", i."reorderPoint"
      FROM "InventoryItem" i
      JOIN "Product" p ON p."id" = i."productId"
      WHERE i."available" <= i."reorderPoint" AND p."active" = true
      ORDER BY (i."available"::float / NULLIF(i."reorderPoint", 0)) ASC
      LIMIT 10
    `)
    return rows
  }, [] as any[])

  const briefData: any = {
    generatedAt: now.toISOString(),
    revenue: {
      paymentsToday: Number(revenueToday.paymentsToday || 0),
      paymentsThisMonth: Number(revenueToday.paymentsThisMonth || 0),
      newOrdersToday: newOrdersToday.count || 0,
      newOrderValueToday: Number(newOrdersToday.totalValue || 0),
    },
    collections: {
      totalOverdue: overdueStats.totalOverdue || 0,
      totalOverdueAmount: Number(overdueStats.totalOverdueAmount || 0),
      critical60Plus: overdueStats.critical60Plus || 0,
    },
    operations: {
      ordersByStatus: orderAlerts,
      deliveriesToday,
      inventoryAlerts,
    },
    sales: {
      stalledDeals: stalledDeals.map(d => ({ ...d, total: Number(d.total) })),
      stalledDealCount: stalledDeals.length,
      stalledDealValue: stalledDeals.reduce((s: number, d: any) => s + Number(d.total), 0),
    },
    customerHealth: {
      atRiskBuilders: atRiskBuilders.map(b => ({
        ...b,
        totalLifetimeValue: Number(b.totalLifetimeValue),
      })),
      atRiskCount: atRiskBuilders.length,
    },
    agentStatus,
    pendingApprovals,
    pendingApprovalCount: pendingApprovals.length,
  }

  // If ?audio=true, generate a spoken briefing and return MP3
  const wantAudio = request.nextUrl.searchParams.get('audio') === 'true'
  if (wantAudio && isElevenLabsConfigured()) {
    const staffName = request.headers.get('x-staff-firstname') || 'team'
    const rev = briefData.revenue
    const coll = briefData.collections
    const ops = briefData.operations

    const lines = [
      `Revenue: ${rev.paymentsToday > 0 ? `$${rev.paymentsToday.toLocaleString()} received today` : 'No payments yet today'}, $${rev.paymentsThisMonth.toLocaleString()} this month.`,
      rev.newOrdersToday > 0 ? `${rev.newOrdersToday} new orders today worth $${rev.newOrderValueToday.toLocaleString()}.` : '',
      coll.totalOverdue > 0 ? `Collections: ${coll.totalOverdue} overdue invoices totaling $${coll.totalOverdueAmount.toLocaleString()}.${coll.critical60Plus > 0 ? ` ${coll.critical60Plus} are over 60 days.` : ''}` : 'Collections are clear.',
      ops.deliveriesToday?.length > 0 ? `${ops.deliveriesToday.length} deliveries scheduled today.` : 'No deliveries today.',
      ops.inventoryAlerts?.length > 0 ? `${ops.inventoryAlerts.length} inventory alerts need attention.` : '',
      briefData.sales.stalledDealCount > 0 ? `${briefData.sales.stalledDealCount} stalled deals worth $${briefData.sales.stalledDealValue.toLocaleString()}.` : '',
      briefData.pendingApprovalCount > 0 ? `${briefData.pendingApprovalCount} items awaiting approval.` : '',
    ].filter(Boolean).join(' ')

    const audioResult = await generateBriefingAudio({ staffName, briefingText: lines })
    if ('audio' in audioResult) {
      return new Response(audioResult.audio, {
        status: 200,
        headers: {
          'Content-Type': audioResult.contentType,
          'Content-Length': audioResult.byteLength.toString(),
          'Content-Disposition': `inline; filename="daily-brief-${now.toISOString().slice(0,10)}.mp3"`,
        },
      })
    }
    // Fall through to JSON if TTS fails
  }

  return NextResponse.json(briefData)
}
