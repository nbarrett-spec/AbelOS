/**
 * MCP tools — Analytics & Search domain.
 *
 * Phase 1: ops_dashboard, global_search
 * Phase 2: financial_report, order_analytics
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit } from '../wrap'

export function registerAnalyticsTools(server: McpServer) {
  server.registerTool(
    'ops_dashboard',
    {
      description:
        'Get the ops dashboard KPIs at a glance: 12-month revenue, active builders, overdue invoices, low-stock inventory rows, open orders, and 30-day delivery completion rate.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('ops_dashboard', 'READ', async () => {
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
          where: { createdAt: { gte: yearAgo }, status: { not: 'CANCELLED' } },
        }),
        prisma.builder.count({ where: { status: 'ACTIVE' } }),
        prisma.invoice.count({ where: { balanceDue: { gt: 0 }, dueDate: { lt: now } } }),
        prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
          SELECT COUNT(*)::bigint AS count
          FROM "InventoryItem"
          WHERE "reorderPoint" > 0 AND "available" <= "reorderPoint"
        `),
        prisma.delivery.count({ where: { createdAt: { gte: monthAgo } } }),
        prisma.delivery.count({ where: { createdAt: { gte: monthAgo }, status: 'COMPLETE' } }),
        prisma.order.count({
          where: { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'] } },
        }),
      ])
      const revenue12mo = revAgg?._sum?.total ?? 0
      const lowStockCount = Number(lowStockRows?.[0]?.count ?? BigInt(0))
      const deliveryCompletePercent =
        recentDeliveries > 0 ? (completedDeliveries / recentDeliveries) * 100 : null
      return {
        content: [
          {
            type: 'text' as const,
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
    }),
  )

  server.registerTool(
    'global_search',
    {
      description:
        'Search across all entities (jobs, purchase orders, builders, products, vendors). Use for ambiguous queries like "anything related to brookfield".',
      inputSchema: {
        q: z.string().min(2),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('global_search', 'READ', async ({ q, limit = 10 }: any) => {
      const ilike = { contains: q, mode: 'insensitive' as const }
      const [jobs, purchaseOrders, builders, products, vendors] = await Promise.all([
        prisma.job.findMany({
          where: {
            OR: [{ jobNumber: ilike }, { jobAddress: ilike }, { builderName: ilike }, { community: ilike }],
          },
          select: { id: true, jobNumber: true, jobAddress: true, builderName: true, status: true },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.purchaseOrder.findMany({
          where: { OR: [{ poNumber: ilike }, { vendor: { name: ilike } }] },
          select: { id: true, poNumber: true, status: true, total: true, vendor: { select: { name: true } } },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.builder.findMany({
          where: { OR: [{ companyName: ilike }, { contactName: ilike }, { email: ilike }] },
          select: { id: true, companyName: true, contactName: true, email: true, status: true },
          take: limit,
          orderBy: { companyName: 'asc' },
        }),
        prisma.product.findMany({
          where: { OR: [{ name: ilike }, { sku: ilike }] },
          select: { id: true, sku: true, name: true, basePrice: true },
          take: limit,
          orderBy: { name: 'asc' },
        }),
        prisma.vendor.findMany({
          where: { OR: [{ name: ilike }, { code: ilike }, { email: ilike }] },
          select: { id: true, name: true, code: true, email: true, active: true },
          take: limit,
          orderBy: { name: 'asc' },
        }),
      ])
      return {
        content: [
          {
            type: 'text' as const,
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
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // financial_report (read)
  //
  // High-level financial pulls. Pulls revenue, AR, COGS, gross margin
  // for a period. Doesn't try to be the full P&L — rolls invoices,
  // POs, and orders for the requested type.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'financial_report',
    {
      description:
        'Generate a financial summary for a date range: revenue, AR aging, COGS via PO spend, gross-margin estimate. reportType selects the cut.',
      inputSchema: {
        reportType: z.enum(['revenue', 'ar_aging', 'po_spend', 'gross_margin', 'dso']),
        dateFrom: z.string().describe('ISO start date'),
        dateTo: z.string().describe('ISO end date'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('financial_report', 'READ', async ({ reportType, dateFrom, dateTo }: any) => {
      const start = new Date(dateFrom)
      const end = new Date(dateTo)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid dateFrom or dateTo' }) }],
          isError: true,
        }
      }

      if (reportType === 'revenue') {
        const orders = await prisma.order.aggregate({
          _sum: { total: true, subtotal: true, taxAmount: true },
          _count: true,
          where: { createdAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                reportType,
                periodStart: start.toISOString(),
                periodEnd: end.toISOString(),
                orderCount: orders._count,
                grossRevenue: orders._sum.total ?? 0,
                subtotal: orders._sum.subtotal ?? 0,
                tax: orders._sum.taxAmount ?? 0,
              }, null, 2),
            },
          ],
        }
      }

      if (reportType === 'ar_aging') {
        const invoices = await prisma.invoice.findMany({
          where: { issuedAt: { gte: start, lte: end }, balanceDue: { gt: 0 } },
          select: { balanceDue: true, dueDate: true },
        })
        const now = Date.now()
        const aging = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
        for (const i of invoices) {
          const days = i.dueDate ? (now - new Date(i.dueDate).getTime()) / 86400000 : -1
          if (days <= 0) aging.current += i.balanceDue
          else if (days <= 30) aging['1-30'] += i.balanceDue
          else if (days <= 60) aging['31-60'] += i.balanceDue
          else if (days <= 90) aging['61-90'] += i.balanceDue
          else aging['90+'] += i.balanceDue
        }
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ reportType, periodStart: start.toISOString(), periodEnd: end.toISOString(), aging, totalOpenInvoices: invoices.length }, null, 2) },
          ],
        }
      }

      if (reportType === 'po_spend') {
        const pos = await prisma.purchaseOrder.aggregate({
          _sum: { total: true },
          _count: true,
          where: { orderedAt: { gte: start, lte: end } },
        })
        const byVendor = await prisma.purchaseOrder.groupBy({
          by: ['vendorId'],
          _sum: { total: true },
          where: { orderedAt: { gte: start, lte: end } },
          orderBy: { _sum: { total: 'desc' } },
          take: 10,
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ reportType, periodStart: start.toISOString(), periodEnd: end.toISOString(), totalPOs: pos._count, totalSpend: pos._sum.total ?? 0, top10ByVendor: byVendor }, null, 2),
            },
          ],
        }
      }

      if (reportType === 'gross_margin') {
        const [revAgg, poAgg] = await Promise.all([
          prisma.order.aggregate({ _sum: { total: true }, where: { createdAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } } }),
          prisma.purchaseOrder.aggregate({ _sum: { total: true }, where: { orderedAt: { gte: start, lte: end } } }),
        ])
        const revenue = revAgg._sum.total ?? 0
        const cogs = poAgg._sum.total ?? 0
        const gross = revenue - cogs
        const grossMarginPercent = revenue > 0 ? (gross / revenue) * 100 : null
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ reportType, periodStart: start.toISOString(), periodEnd: end.toISOString(), revenue, cogs, grossMargin: gross, grossMarginPercent }, null, 2) },
          ],
        }
      }

      // dso
      const paidInvoices = await prisma.invoice.findMany({
        where: { paidAt: { gte: start, lte: end }, issuedAt: { not: null } },
        select: { issuedAt: true, paidAt: true, total: true },
      })
      const dso =
        paidInvoices.length > 0
          ? paidInvoices.reduce(
              (s, i) =>
                s +
                (new Date(i.paidAt!).getTime() - new Date(i.issuedAt!).getTime()) / 86400000,
              0,
            ) / paidInvoices.length
          : null
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ reportType, periodStart: start.toISOString(), periodEnd: end.toISOString(), invoicesPaid: paidInvoices.length, dsoDays: dso }, null, 2) },
        ],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // order_analytics (read)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'order_analytics',
    {
      description:
        'Order trend analysis. Aggregates orders by month/week with totals + counts, optionally scoped to a builder.',
      inputSchema: {
        dateFrom: z.string(),
        dateTo: z.string(),
        builderId: z.string().optional(),
        groupBy: z.enum(['day', 'week', 'month']).default('month'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('order_analytics', 'READ', async ({ dateFrom, dateTo, builderId, groupBy = 'month' }: any) => {
      const start = new Date(dateFrom)
      const end = new Date(dateTo)
      const truncFn = groupBy === 'day' ? 'day' : groupBy === 'week' ? 'week' : 'month'
      // truncFn is from a closed enum (day/week/month) so direct interpolation
      // is safe. builderId is user input — bind as $3.
      const builderFilter = builderId ? `AND "builderId" = $3` : ''
      const params: any[] = [start, end]
      if (builderId) params.push(String(builderId))
      const rows = await prisma.$queryRawUnsafe<Array<{ bucket: Date; orders: bigint; total: number; avg: number }>>(`
        SELECT
          date_trunc('${truncFn}', "createdAt") AS bucket,
          COUNT(*)::bigint AS orders,
          SUM(total)::float AS total,
          AVG(total)::float AS avg
        FROM "Order"
        WHERE "createdAt" >= $1 AND "createdAt" <= $2 AND status != 'CANCELLED' ${builderFilter}
        GROUP BY 1
        ORDER BY 1 ASC
      `, ...params)
      const trends = rows.map((r) => ({
        bucket: r.bucket,
        orders: Number(r.orders),
        total: r.total,
        avgOrderSize: r.avg,
      }))
      const totalOrders = trends.reduce((s, t) => s + t.orders, 0)
      const totalRevenue = trends.reduce((s, t) => s + (t.total ?? 0), 0)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                builderId: builderId ?? null,
                periodStart: start.toISOString(),
                periodEnd: end.toISOString(),
                groupBy,
                trends,
                totalOrders,
                totalRevenue,
                avgOrderSize: totalOrders > 0 ? totalRevenue / totalOrders : null,
              },
              null,
              2,
            ),
          },
        ],
      }
    }),
  )
}
