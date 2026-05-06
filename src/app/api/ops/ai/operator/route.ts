import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

// GET /api/ops/ai/operator — unified operator briefing
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

    // Fetch morning brief metrics — push aggregations to the DB so we don't
    // pull every payment/order/invoice/delivery row into Node memory just
    // to count or sum them.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const [
      todayPaymentsAgg,
      thisMonthPaymentsAgg,
      todayOrdersAgg,
      overdueInvoicesAgg,
      scheduledDeliveriesGrouped,
      completedDeliveriesCount,
      pendingApprovals,
      actionQueueItems,
    ] = await Promise.all([
      // Payment has receivedAt (not createdAt) — see prisma/schema.prisma L1671
      prisma.payment.aggregate({
        where: { receivedAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { receivedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: todayStart } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: { dueDate: { lt: now }, status: { not: 'PAID' } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      // Group same-day deliveries by status — one round-trip instead of
      // pulling the full row set just to filter for IN_TRANSIT.
      prisma.delivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: todayStart } },
        _count: { _all: true },
      }),
      prisma.delivery.count({
        where: { completedAt: { gte: todayStart } },
      }),
      // AgentTask model not in schema — read via raw SQL. Returns [] if the
      // table doesn't exist yet (fresh Neon branch).
      prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "priority" FROM "AgentTask" WHERE "status" = 'AWAITING_APPROVAL' LIMIT 200`
      ).catch(() => [] as any[]),
      // Action queue items via raw SQL (model may not be generated)
      prisma.$queryRawUnsafe<any[]>(
        `SELECT id, priority, type FROM "ActionQueueItem" WHERE status = 'PENDING' LIMIT 50`
      ).catch(() => [] as any[]),
    ])

    // Agent fleet — use AgentConfig as a proxy (no AgentSession model)
    const agentConfigs = await prisma.agentConfig.findMany({
      select: { agentRole: true, configKey: true, configValue: true },
    })

    // Group configs by agentRole to derive fleet info
    const agentRoles = [...new Set(agentConfigs.map((c: any) => c.agentRole))]
    const agentFleet = agentRoles.map((role: string) => ({
      role,
      status: 'CONFIGURED',
      currentTask: null,
      lastActivity: null,
      tasksCompleted: 0,
      errors: 0,
    }))

    // Aggregate metrics — values come straight from the DB-side aggregates
    // above; nothing to recompute over a full row set.
    const paymentsToday = Number(todayPaymentsAgg._sum.amount || 0)
    const paymentsMonth = Number(thisMonthPaymentsAgg._sum.amount || 0)
    const newOrdersToday = todayOrdersAgg._count._all
    const newOrderValue = Number(todayOrdersAgg._sum.total || 0)
    const totalOverdue = overdueInvoicesAgg._count._all
    const totalOverdueAmount = Number(overdueInvoicesAgg._sum.total || 0)
    const scheduledToday = scheduledDeliveriesGrouped.reduce(
      (sum: number, g: any) => sum + (g._count?._all || 0),
      0
    )
    const completedToday = completedDeliveriesCount
    const inTransit =
      scheduledDeliveriesGrouped.find((g: any) => g.status === 'IN_TRANSIT')?._count?._all || 0

    // Count action queue by priority
    const highPriorityActions = actionQueueItems.filter((a: any) => a.priority === 'HIGH').length
    const mediumPriorityActions = actionQueueItems.filter((a: any) => a.priority === 'MEDIUM').length
    const lowPriorityActions = actionQueueItems.filter((a: any) => a.priority === 'LOW').length

    // Fetch recommendations
    const recommendations: any[] = []
    try {
      // Stale quotes needing follow-up (Quote has projectId, not builderId)
      const staleQuotes = await prisma.quote.findMany({
        where: {
          status: 'SENT',
          createdAt: { lt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
        },
        take: 3,
        select: { id: true, quoteNumber: true, total: true, createdAt: true, projectId: true },
        orderBy: { createdAt: 'asc' },
      })

      for (const quote of staleQuotes) {
        // Get builder name through project
        let builderName = 'Unknown Builder'
        try {
          const project = await prisma.project.findUnique({
            where: { id: quote.projectId },
            select: { builder: { select: { companyName: true } } },
          })
          if (project?.builder?.companyName) builderName = project.builder.companyName
        } catch {}

        recommendations.push({
          id: `quote-${quote.id}`,
          type: 'FOLLOW_UP',
          title: `Follow up: ${builderName}`,
          description: `Quote ${quote.quoteNumber} needs follow-up`,
          impact: quote.total ? `$${Number(quote.total).toLocaleString()} at risk` : 'Revenue at risk',
          priority: 'HIGH',
        })
      }

      // Low stock products (field is onHand, not quantityOnHand)
      const lowStockProducts = await prisma.inventoryItem.findMany({
        where: {
          onHand: { lte: 5 },
          status: 'IN_STOCK',
        },
        take: 3,
        select: { id: true, productName: true, onHand: true, reorderPoint: true },
        orderBy: { onHand: 'asc' },
      })

      lowStockProducts.forEach((product: any) => {
        recommendations.push({
          id: `reorder-${product.id}`,
          type: 'REORDER',
          title: `Reorder: ${product.productName}`,
          description: `${product.onHand} on hand, below reorder point of ${product.reorderPoint}`,
          impact: 'Immediate action needed',
          priority: product.onHand === 0 ? 'HIGH' : 'MEDIUM',
        })
      })
    } catch (err) {
      console.error('Failed to fetch recommendations:', err)
    }

    // Fetch recent agent activity (last 24h) — AgentTask model not in Prisma
    // schema, so pull via raw SQL. Returns [] if the table doesn't exist yet.
    const recentActivity = await prisma
      .$queryRawUnsafe<any[]>(
        `SELECT "id", "agentRole", "taskType", "title", "status", "completedAt"
           FROM "AgentTask"
          WHERE "completedAt" >= $1
          ORDER BY "completedAt" DESC
          LIMIT 10`,
        yesterdayStart
      )
      .catch(() => [] as any[])

    return NextResponse.json({
      briefing: {
        timestamp: now.toISOString(),
        dailySummary: {
          paymentsToday,
          paymentsThisMonth: paymentsMonth,
          newOrdersToday,
          newOrderValueToday: newOrderValue,
          overdueInvoices: totalOverdue,
          overdueAmount: totalOverdueAmount,
          deliveriesToday: { scheduledToday, completedToday, inTransit },
          tasksCompleted: 0,
          pendingApprovals: pendingApprovals.length,
        },
        actionQueue: {
          total: actionQueueItems.length,
          high: highPriorityActions,
          medium: mediumPriorityActions,
          low: lowPriorityActions,
          items: actionQueueItems.slice(0, 5),
        },
        agentFleet: {
          total: agentFleet.length,
          active: agentFleet.filter((a: any) => a.status === 'ONLINE').length,
          idle: agentFleet.filter((a: any) => a.status === 'IDLE').length,
          offline: agentFleet.filter((a: any) => a.status === 'OFFLINE').length,
          agents: agentFleet,
        },
        recommendations: recommendations.slice(0, 5),
        recentActivity: recentActivity.slice(0, 10),
      },
    })
  } catch (error) {
    console.error('Error fetching operator briefing:', error)
    return NextResponse.json({ error: 'Failed to fetch operator briefing' }, { status: 500 })
  }
}
