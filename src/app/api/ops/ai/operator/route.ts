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

    // Fetch morning brief metrics
    const [
      todayPayments,
      thisMonthPayments,
      todayOrders,
      todayOrderValue,
      overdueInvoices,
      overdueAmount,
      scheduledDeliveries,
      completedDeliveries,
      pendingApprovals,
      actionQueueItems,
    ] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { amount: true },
      }),
      prisma.payment.findMany({
        where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
        select: { amount: true },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { id: true },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { total: true },
      }),
      prisma.invoice.findMany({
        where: { dueDate: { lt: now }, status: { not: 'PAID' } },
        select: { id: true },
      }),
      prisma.invoice.findMany({
        where: { dueDate: { lt: now }, status: { not: 'PAID' } },
        select: { total: true },
      }),
      prisma.delivery.findMany({
        where: {
          createdAt: { gte: todayStart },
        },
        select: { id: true, status: true },
      }),
      prisma.delivery.findMany({
        where: { completedAt: { gte: todayStart } },
        select: { id: true },
      }),
      prisma.agentTask.findMany({
        where: { status: 'AWAITING_APPROVAL' },
        select: { id: true, priority: true },
      }),
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

    // Aggregate metrics
    const paymentsToday = todayPayments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
    const paymentsMonth = thisMonthPayments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
    const newOrdersToday = todayOrders.length
    const newOrderValue = todayOrderValue.reduce((sum: number, o: any) => sum + (o.total || 0), 0)
    const totalOverdue = overdueInvoices.length
    const totalOverdueAmount = overdueAmount.reduce((sum: number, i: any) => sum + (i.total || 0), 0)
    const scheduledToday = scheduledDeliveries.length
    const completedToday = completedDeliveries.length
    const inTransit = scheduledDeliveries.filter((d: any) => d.status === 'IN_TRANSIT').length

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

    // Fetch recent agent activity (last 24h)
    const recentActivity = await prisma.agentTask.findMany({
      where: { completedAt: { gte: yesterdayStart } },
      take: 10,
      select: {
        id: true,
        agentRole: true,
        taskType: true,
        title: true,
        status: true,
        completedAt: true,
      },
      orderBy: { completedAt: 'desc' },
    })

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
