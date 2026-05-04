/**
 * MCP tools — Analytics & Search domain.
 *
 * Phase 1: ops_dashboard, global_search
 * Phase 2: financial_report, order_analytics
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

export function registerAnalyticsTools(server: McpServer) {
  server.registerTool(
    'ops_dashboard',
    {
      description:
        'Get the ops dashboard KPIs at a glance: 12-month revenue, active builders, overdue invoices, low-stock inventory rows, open orders, and 30-day delivery completion rate. Use for "how is the business doing right now?".',
      inputSchema: {},
    },
    async () => {
      const now = new Date()
      const yearAgo = new Date(now.getTime() - 365 * 86400000)
      const monthAgo = new Date(now.getTime() - 30 * 86400000)

      const [
        revAgg,
        activeBuilders,
        overdueInvoices,
        lowStockRows,
        recentDeliveries,
        completedDeliveries,
        openOrders,
      ] = await Promise.all([
        prisma.order.aggregate({
          _sum: { total: true },
          where: {
            createdAt: { gte: yearAgo },
            status: { not: 'CANCELLED' },
          },
        }),
        prisma.builder.count({ where: { status: 'ACTIVE' } }),
        prisma.invoice.count({
          where: { balanceDue: { gt: 0 }, dueDate: { lt: now } },
        }),
        // Low-stock: inventory rows where available <= reorderPoint AND
        // reorderPoint > 0. Prisma doesn't support column-vs-column where
        // clauses, so use raw SQL.
        prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
          SELECT COUNT(*)::bigint AS count
          FROM "InventoryItem"
          WHERE "reorderPoint" > 0 AND "available" <= "reorderPoint"
        `),
        prisma.delivery.count({ where: { createdAt: { gte: monthAgo } } }),
        prisma.delivery.count({
          where: {
            createdAt: { gte: monthAgo },
            status: 'COMPLETE',
          },
        }),
        prisma.order.count({
          where: {
            status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'] },
          },
        }),
      ])

      const revenue12mo = revAgg?._sum?.total ?? 0
      const lowStockCount = Number(lowStockRows?.[0]?.count ?? BigInt(0))
      const deliveryCompletePercent =
        recentDeliveries > 0 ? (completedDeliveries / recentDeliveries) * 100 : null

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                revenue12mo,
                activeBuilders,
                overdueInvoices,
                lowStockCount,
                openOrders,
                deliveries30d: {
                  total: recentDeliveries,
                  complete: completedDeliveries,
                  completePercent: deliveryCompletePercent,
                },
                generatedAt: now.toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  server.registerTool(
    'global_search',
    {
      description:
        'Search across all entities (jobs, purchase orders, builders, products, vendors). Use for ambiguous queries like "anything related to brookfield" — returns top matches per entity type.',
      inputSchema: {
        q: z.string().min(2).describe('Search text — minimum 2 characters'),
        limit: z.number().int().min(1).max(50).default(10).describe('Max results per entity type'),
      },
    },
    async ({ q, limit = 10 }) => {
      const ilike = { contains: q, mode: 'insensitive' as const }

      const [jobs, purchaseOrders, builders, products, vendors] = await Promise.all([
        prisma.job.findMany({
          where: {
            OR: [
              { jobNumber: ilike },
              { jobAddress: ilike },
              { builderName: ilike },
              { community: ilike },
            ],
          },
          select: {
            id: true,
            jobNumber: true,
            jobAddress: true,
            builderName: true,
            status: true,
          },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.purchaseOrder.findMany({
          where: {
            OR: [
              { poNumber: ilike },
              { vendor: { name: ilike } },
            ],
          },
          select: {
            id: true,
            poNumber: true,
            status: true,
            total: true,
            vendor: { select: { name: true } },
          },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.builder.findMany({
          where: {
            OR: [
              { companyName: ilike },
              { contactName: ilike },
              { email: ilike },
            ],
          },
          select: {
            id: true,
            companyName: true,
            contactName: true,
            email: true,
            status: true,
          },
          take: limit,
          orderBy: { companyName: 'asc' },
        }),
        prisma.product.findMany({
          where: {
            OR: [
              { name: ilike },
              { sku: ilike },
            ],
          },
          select: { id: true, sku: true, name: true, basePrice: true },
          take: limit,
          orderBy: { name: 'asc' },
        }),
        prisma.vendor.findMany({
          where: {
            OR: [
              { name: ilike },
              { code: ilike },
              { email: ilike },
            ],
          },
          select: { id: true, name: true, code: true, email: true, active: true },
          take: limit,
          orderBy: { name: 'asc' },
        }),
      ])

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query: q,
                results: { jobs, purchaseOrders, builders, products, vendors },
                counts: {
                  jobs: jobs.length,
                  purchaseOrders: purchaseOrders.length,
                  builders: builders.length,
                  products: products.length,
                  vendors: vendors.length,
                },
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
