/**
 * MCP tools — Orders domain.
 *
 * Phase 1 (read): search_orders, get_order
 * Phase 2 (write): create_order_from_quote, update_order_status
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit, withRateLimit } from '../wrap'

const ORDER_STATUSES = [
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
] as const

export function registerOrderTools(server: McpServer) {
  server.registerTool(
    'search_orders',
    {
      description:
        'Search and filter orders with pagination. Returns orders with builder name, status, totals, and dates. Use for "show me Brookfield orders", "what orders shipped this week", etc.',
      inputSchema: {
        q: z.string().optional().describe('Search text (matches order number or builder name)'),
        status: z
          .enum(ORDER_STATUSES)
          .optional()
          .describe('Filter by exact order status'),
        builderId: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_orders', 'READ', async (args: any) => {
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
        content: [{ type: 'text' as const, text: JSON.stringify({ orders, total, page, pageSize: limit }, null, 2) }],
      }
    }),
  )

  server.registerTool(
    'get_order',
    {
      description:
        'Get full order detail with line items, builder, and delivery info. Use after search_orders to drill into a specific order.',
      inputSchema: { orderId: z.string().describe('Order ID (cuid format)') },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_order', 'READ', async ({ orderId }: any) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          builder: { select: { id: true, companyName: true, email: true, phone: true } },
          items: true,
        },
      })
      if (!order) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Order not found', orderId }) }],
          isError: true,
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(order, null, 2) }] }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // create_order_from_quote (write)
  //
  // Convert an APPROVED Quote into an Order. Mirrors what
  // /api/orders POST does for self-service builders, but staff-driven
  // through MCP. Quote.status must be APPROVED — DRAFT/SENT/REJECTED
  // get a clear error.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_order_from_quote',
    {
      description:
        'Convert an APPROVED quote into an Order. Copies line items, links project + builder, generates a new order number. Errors if quote is not APPROVED or already converted.',
      inputSchema: {
        quoteId: z.string().describe('Quote ID to convert'),
        deliveryNotes: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('create_order_from_quote', 'WRITE', withRateLimit('create_order_from_quote', async ({ quoteId, deliveryNotes }: any) => {
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: {
          items: true,
          project: { include: { builder: true } },
        },
      })
      if (!quote) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Quote not found', quoteId }) }],
          isError: true,
        }
      }
      if (quote.status !== 'APPROVED') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Quote must be APPROVED to convert (current status: ${quote.status}). Approve it first via the portal or admin UI.`,
              }),
            },
          ],
          isError: true,
        }
      }
      // Idempotency: existing Order linked via Quote.order back-relation
      const existing = await prisma.order.findUnique({ where: { quoteId } })
      if (existing) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Quote already converted', orderId: existing.id, orderNumber: existing.orderNumber }),
            },
          ],
          isError: true,
        }
      }

      const builder = quote.project.builder
      const year = new Date().getFullYear()
      const yearStart = new Date(year, 0, 1)
      const orderCount = await prisma.order.count({
        where: { createdAt: { gte: yearStart } },
      })
      const orderNumber = `ORD-${year}-${String(orderCount + 1).padStart(4, '0')}`

      const order = await prisma.order.create({
        data: {
          orderNumber,
          builderId: builder.id,
          quoteId: quote.id,
          subtotal: quote.subtotal,
          taxAmount: quote.taxAmount,
          total: quote.total,
          paymentTerm: builder.paymentTerm,
          status: 'RECEIVED',
          deliveryNotes: deliveryNotes ?? null,
          items: {
            create: quote.items.map((qi: any) => ({
              productId: qi.productId ?? '',
              description: qi.description,
              quantity: qi.quantity,
              unitPrice: qi.unitPrice,
              lineTotal: qi.lineTotal,
            })),
          },
        },
        select: { id: true, orderNumber: true, status: true, total: true },
      })

      // Mark quote as ORDERED so it doesn't show up in active-quote queries.
      await prisma.quote.update({
        where: { id: quoteId },
        data: { status: 'ORDERED' },
      })

      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, order }, null, 2) }] }
    })),
  )

  // ──────────────────────────────────────────────────────────────────
  // update_order_status (write)
  //
  // Transition an order to a new status. Doesn't enforce the full
  // lifecycle DAG (that's what /api/orders/[id] does for the UI) —
  // for MCP we trust ADMIN intent but block CANCELLED → anything-else
  // and DELIVERED → earlier states which would corrupt invoicing/jobs.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'update_order_status',
    {
      description:
        'Update an order\'s status. Blocks reverse transitions from CANCELLED or backwards from DELIVERED. Use for "mark this order shipped" / "cancel order ORD-2026-0042".',
      inputSchema: {
        orderId: z.string(),
        newStatus: z.enum(ORDER_STATUSES),
        notes: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('update_order_status', 'WRITE', withRateLimit('update_order_status', async ({ orderId, newStatus, notes }: any) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderNumber: true, status: true, deliveryNotes: true },
      })
      if (!order) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Order not found', orderId }) }],
          isError: true,
        }
      }
      const oldStatus = order.status
      if (oldStatus === 'CANCELLED' && newStatus !== 'CANCELLED') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Cannot un-cancel an order. Create a new one instead.',
              }),
            },
          ],
          isError: true,
        }
      }
      const TERMINAL_REVERSE_BLOCK: Record<string, string[]> = {
        DELIVERED: ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'AWAITING_MATERIAL', 'READY_TO_SHIP', 'PARTIAL_SHIPPED', 'SHIPPED'],
        COMPLETE: ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'AWAITING_MATERIAL', 'READY_TO_SHIP', 'PARTIAL_SHIPPED', 'SHIPPED', 'DELIVERED'],
      }
      if (TERMINAL_REVERSE_BLOCK[oldStatus]?.includes(newStatus)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Cannot move order from ${oldStatus} backward to ${newStatus}. Only forward transitions or CANCELLED are allowed from terminal states.`,
              }),
            },
          ],
          isError: true,
        }
      }
      const noteAppend = notes ? `\n[MCP ${new Date().toISOString()}] ${notes}` : ''
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          deliveryNotes: notes ? `${order.deliveryNotes ?? ''}${noteAppend}`.trim() : undefined,
        },
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true, orderId, orderNumber: order.orderNumber, oldStatus, newStatus }, null, 2),
          },
        ],
      }
    })),
  )
}
