/**
 * MCP tools — Orders domain.
 *
 * Phase 1 (read-only): search_orders, get_order
 * Phase 2 (write): create_order_from_quote, update_order_status
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

export function registerOrderTools(server: McpServer) {
  // ──────────────────────────────────────────────────────────────────
  // search_orders
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'search_orders',
    {
      description:
        'Search and filter orders with pagination. Returns orders with builder name, status, totals, and dates. Use for "show me Brookfield orders", "what orders shipped this week", etc.',
      inputSchema: {
        q: z.string().optional().describe('Search text (matches order number or builder name)'),
        status: z
          .enum([
            'RECEIVED',
            'CONFIRMED',
            'IN_PRODUCTION',
            'AWAITING_MATERIAL',
            'READY_TO_SHIP',
            'PARTIAL_SHIPPED',
            'SHIPPED',
            'DELIVERED',
            'COMPLETE',
            'CANCELLED',
          ])
          .optional()
          .describe('Filter by exact order status'),
        builderId: z.string().optional().describe('Filter to a specific builder by ID'),
        dateFrom: z.string().optional().describe('ISO date — orders created on or after'),
        dateTo: z.string().optional().describe('ISO date — orders created on or before'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
    },
    async (args) => {
      const { q, status, builderId, dateFrom, dateTo, page = 1, limit = 20 } = args
      const where: any = {}
      if (q) {
        where.OR = [
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { builder: { companyName: { contains: q, mode: 'insensitive' } } },
        ]
      }
      if (status) where.status = status
      if (builderId) where.builderId = builderId
      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = new Date(dateFrom)
        if (dateTo) where.createdAt.lte = new Date(dateTo)
      }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            orderNumber: true,
            poNumber: true,
            status: true,
            total: true,
            paymentStatus: true,
            paymentTerm: true,
            paidAt: true,
            dueDate: true,
            deliveryDate: true,
            createdAt: true,
            builder: { select: { id: true, companyName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.order.count({ where }),
      ])

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ orders, total, page, pageSize: limit }, null, 2),
          },
        ],
      }
    },
  )

  // ──────────────────────────────────────────────────────────────────
  // get_order
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_order',
    {
      description:
        'Get full order detail with line items, builder, project, and delivery info. Use after search_orders to drill into a specific order.',
      inputSchema: {
        orderId: z.string().describe('Order ID (cuid format)'),
      },
    },
    async ({ orderId }) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          builder: { select: { id: true, companyName: true, email: true, phone: true } },
          items: true,
        },
      })

      if (!order) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Order not found', orderId }) }],
          isError: true,
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(order, null, 2) }],
      }
    },
  )
}
