/**
 * MCP tools — Invoices / AR / Collections domain.
 *
 * Phase 1 (read-only): search_invoices, get_invoice, get_collections
 * Phase 1 (write):     create_invoice, log_collection_action
 *
 * Schema notes (these tripped us up once — keep in mind):
 *  • Invoice has NO direct Prisma `builder` relation. Only `builderId: String`.
 *    Must look up Builder separately by ID.
 *  • Invoice DOES have these relations: `items`, `payments`, `collectionActions`,
 *    plus `createdBy` (Staff). Use those via `include`.
 *  • InvoiceStatus enum: DRAFT | ISSUED | SENT | PARTIALLY_PAID | PAID | OVERDUE | VOID | WRITE_OFF
 *  • PaymentTerm enum: PAY_AT_ORDER | PAY_ON_DELIVERY | NET_15 | NET_30
 *  • CollectionAction.actionType is a free string (not an enum). We constrain
 *    it at the MCP layer with a Zod enum for tool ergonomics.
 *  • Invoice.createdById is a String FK to Staff. We set the literal
 *    `'mcp-service'` per AEGIS-MCP-CONNECTOR-HANDOFF §10. The Staff row with
 *    id='mcp-service' must exist (seeded as part of MCP onboarding).
 *  • InvoiceNumber format: INV-YYYY-NNNN. Per-year monotonic counter — count
 *    existing invoices issued this year and add 1, zero-padded to 4 digits.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit, withRateLimit } from '@/lib/mcp/wrap'

export function registerInvoiceTools(server: McpServer) {
  // ──────────────────────────────────────────────────────────────────
  // search_invoices
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'search_invoices',
    {
      description:
        'Search and filter invoices with pagination. Returns invoice#, builder name, status, total, balanceDue, dueDate, issuedAt. Use for "show me Brookfield invoices", "what was issued this week", "open AR", etc.',
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe('Search text (matches invoice number — case-insensitive)'),
        builderId: z.string().optional().describe('Filter to a specific builder by ID'),
        status: z
          .enum([
            'DRAFT',
            'ISSUED',
            'SENT',
            'PARTIALLY_PAID',
            'PAID',
            'OVERDUE',
            'VOID',
            'WRITE_OFF',
          ])
          .optional()
          .describe('Filter by exact invoice status'),
        dateFrom: z.string().optional().describe('ISO date — invoices issued on or after'),
        dateTo: z.string().optional().describe('ISO date — invoices issued on or before'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_invoices', 'READ', async (args: any) => {
      const { q, builderId, status, dateFrom, dateTo, page = 1, limit = 20 } = args
      const where: any = {}
      if (q) {
        where.invoiceNumber = { contains: q, mode: 'insensitive' }
      }
      if (builderId) where.builderId = builderId
      if (status) where.status = status
      if (dateFrom || dateTo) {
        where.issuedAt = {}
        if (dateFrom) where.issuedAt.gte = new Date(dateFrom)
        if (dateTo) where.issuedAt.lte = new Date(dateTo)
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          select: {
            id: true,
            invoiceNumber: true,
            builderId: true,
            orderId: true,
            jobId: true,
            status: true,
            paymentTerm: true,
            subtotal: true,
            taxAmount: true,
            total: true,
            amountPaid: true,
            balanceDue: true,
            issuedAt: true,
            dueDate: true,
            paidAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.invoice.count({ where }),
      ])

      // Builder lookup — Invoice has no Prisma relation, so do it in one batch.
      const builderIds = Array.from(new Set(invoices.map((i) => i.builderId)))
      const builders =
        builderIds.length > 0
          ? await prisma.builder.findMany({
              where: { id: { in: builderIds } },
              select: { id: true, companyName: true },
            })
          : []
      const builderById = new Map(builders.map((b) => [b.id, b]))

      const enriched = invoices.map((inv) => ({
        ...inv,
        builder: builderById.get(inv.builderId) ?? null,
      }))

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { invoices: enriched, total, page, pageSize: limit },
              null,
              2,
            ),
          },
        ],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_invoice
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_invoice',
    {
      description:
        'Get full invoice detail: line items, payments, collection actions, and builder info. Use after search_invoices to drill into a specific invoice.',
      inputSchema: {
        invoiceId: z.string().describe('Invoice ID (cuid format)'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_invoice', 'READ', async ({ invoiceId }: any) => {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: true,
          payments: { orderBy: { receivedAt: 'desc' } },
          collectionActions: { orderBy: { sentAt: 'desc' } },
        },
      })

      if (!invoice) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Invoice not found', invoiceId }) },
          ],
          isError: true,
        }
      }

      const builder = await prisma.builder.findUnique({
        where: { id: invoice.builderId },
        select: { id: true, companyName: true, email: true, phone: true },
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...invoice, builder }, null, 2),
          },
        ],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // create_invoice — generate invoice from a delivered order
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_invoice',
    {
      description:
        'Generate an invoice from an existing order. Pulls order items, subtotal, tax, total. Sets status=ISSUED, issuedAt=now, dueDate based on order paymentTerm (defaults to +30 days). Returns { invoiceId, invoiceNumber, total }.',
      inputSchema: {
        orderId: z.string().describe('Source order ID (cuid format)'),
        notes: z.string().optional().describe('Optional notes on the invoice'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('create_invoice', 'WRITE', withRateLimit('create_invoice', async ({ orderId, notes }: any) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      })

      if (!order) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Order not found', orderId }) },
          ],
          isError: true,
        }
      }

      // Generate INV-YYYY-NNNN by counting this-year invoices and adding 1.
      const now = new Date()
      const year = now.getFullYear()
      const yearStart = new Date(year, 0, 1)
      const yearEnd = new Date(year + 1, 0, 1)
      const yearCount = await prisma.invoice.count({
        where: { createdAt: { gte: yearStart, lt: yearEnd } },
      })
      const seq = String(yearCount + 1).padStart(4, '0')
      const invoiceNumber = `INV-${year}-${seq}`

      // Due date: NET_30 default fallback (+30 days). The PaymentTerm enum
      // values map roughly: PAY_AT_ORDER/PAY_ON_DELIVERY → due now, NET_15 → +15, NET_30 → +30.
      const dueDate = new Date(now)
      switch (order.paymentTerm) {
        case 'NET_15':
          dueDate.setDate(dueDate.getDate() + 15)
          break
        case 'PAY_AT_ORDER':
        case 'PAY_ON_DELIVERY':
          // Due immediately
          break
        case 'NET_30':
        default:
          dueDate.setDate(dueDate.getDate() + 30)
          break
      }

      // Order.builderId became nullable post A-DATA-2 (SetNull on builder
      // soft-delete). Invoice.builderId is still required, so refuse here
      // rather than create an orphan invoice.
      if (!order.builderId) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Order has no builder (builder may have been deleted)', orderId }) },
          ],
          isError: true,
        }
      }

      // Sum order items into the invoice. Use order.subtotal/tax/total as
      // the source of truth (already reconciled with shipping etc.) but
      // re-derive the line-level breakdown from items.
      const subtotal = order.subtotal
      const taxAmount = order.taxAmount
      const total = order.total

      const created = await prisma.invoice.create({
        data: {
          invoiceNumber,
          builderId: order.builderId,
          orderId: order.id,
          createdById: 'mcp-service',
          subtotal,
          taxAmount,
          total,
          amountPaid: 0,
          balanceDue: total,
          status: 'ISSUED',
          paymentTerm: order.paymentTerm,
          issuedAt: now,
          dueDate,
          notes: notes ?? null,
          items: {
            create: order.items.map((it) => ({
              productId: it.productId,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              lineTotal: it.lineTotal,
              lineType: 'MATERIAL',
            })),
          },
        },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
        },
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                invoiceId: created.id,
                invoiceNumber: created.invoiceNumber,
                total: created.total,
              },
              null,
              2,
            ),
          },
        ],
      }
    })),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_collections — open AR aged buckets
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_collections',
    {
      description:
        'List open invoices past their due date, optionally bucketed by aging (1-30, 31-60, 60+ days overdue). Returns invoices + per-bucket counts + total overdue. Use for "what\'s past due", "show me the 60+ bucket", collections triage.',
      inputSchema: {
        bucket: z
          .enum(['1-30', '31-60', '60plus', 'all'])
          .default('all')
          .describe('Aging bucket filter'),
        builderId: z.string().optional().describe('Filter to a specific builder by ID'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_collections', 'READ', async (args: any) => {
      const { bucket = 'all', builderId, page = 1, limit = 20 } = args
      const now = new Date()

      // Base filter: open balance, due in the past.
      const where: any = {
        balanceDue: { gt: 0 },
        dueDate: { lt: now },
        status: { notIn: ['PAID', 'VOID', 'WRITE_OFF'] },
      }
      if (builderId) where.builderId = builderId

      // Bucket bounds — date math on dueDate
      const day = 24 * 60 * 60 * 1000
      const cutoff30 = new Date(now.getTime() - 30 * day)
      const cutoff60 = new Date(now.getTime() - 60 * day)
      if (bucket === '1-30') {
        where.dueDate = { lt: now, gte: cutoff30 }
      } else if (bucket === '31-60') {
        where.dueDate = { lt: cutoff30, gte: cutoff60 }
      } else if (bucket === '60plus') {
        where.dueDate = { lt: cutoff60 }
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          select: {
            id: true,
            invoiceNumber: true,
            builderId: true,
            status: true,
            total: true,
            amountPaid: true,
            balanceDue: true,
            issuedAt: true,
            dueDate: true,
          },
          orderBy: { dueDate: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.invoice.count({ where }),
      ])

      // Builder name lookup
      const builderIds = Array.from(new Set(invoices.map((i) => i.builderId)))
      const builders =
        builderIds.length > 0
          ? await prisma.builder.findMany({
              where: { id: { in: builderIds } },
              select: { id: true, companyName: true },
            })
          : []
      const builderById = new Map(builders.map((b) => [b.id, b]))

      // Per-bucket aggregate (always reported for situational awareness,
      // independent of the page filter).
      const aggWhere: any = {
        balanceDue: { gt: 0 },
        dueDate: { lt: now },
        status: { notIn: ['PAID', 'VOID', 'WRITE_OFF'] },
      }
      if (builderId) aggWhere.builderId = builderId

      const [b1, b2, b3] = await Promise.all([
        prisma.invoice.aggregate({
          where: { ...aggWhere, dueDate: { lt: now, gte: cutoff30 } },
          _count: { _all: true },
          _sum: { balanceDue: true },
        }),
        prisma.invoice.aggregate({
          where: { ...aggWhere, dueDate: { lt: cutoff30, gte: cutoff60 } },
          _count: { _all: true },
          _sum: { balanceDue: true },
        }),
        prisma.invoice.aggregate({
          where: { ...aggWhere, dueDate: { lt: cutoff60 } },
          _count: { _all: true },
          _sum: { balanceDue: true },
        }),
      ])

      const totalOverdue =
        (b1._sum.balanceDue ?? 0) + (b2._sum.balanceDue ?? 0) + (b3._sum.balanceDue ?? 0)

      const enriched = invoices.map((inv) => {
        const daysOverdue =
          inv.dueDate != null
            ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / day)
            : null
        return {
          ...inv,
          builder: builderById.get(inv.builderId) ?? null,
          daysOverdue,
        }
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                invoices: enriched,
                total,
                page,
                pageSize: limit,
                bucket,
                buckets: {
                  '1-30': {
                    count: b1._count._all,
                    sum: b1._sum.balanceDue ?? 0,
                  },
                  '31-60': {
                    count: b2._count._all,
                    sum: b2._sum.balanceDue ?? 0,
                  },
                  '60plus': {
                    count: b3._count._all,
                    sum: b3._sum.balanceDue ?? 0,
                  },
                },
                totalOverdue,
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
  // log_collection_action — record a touch on an overdue invoice
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'log_collection_action',
    {
      description:
        'Log a collection action against an invoice (call, email, letter, payment plan, reminder). Inserts a CollectionAction row; does not change the invoice balance. Returns { actionId, invoiceId, actionType }.',
      inputSchema: {
        invoiceId: z.string().describe('Invoice ID (cuid format)'),
        actionType: z
          .enum(['CALL', 'EMAIL', 'LETTER', 'PAYMENT_PLAN', 'REMINDER'])
          .describe('Type of collection action'),
        channel: z
          .string()
          .default('EMAIL')
          .describe('Channel used (EMAIL, SMS, PHONE, LETTER)'),
        notes: z.string().optional().describe('Free-text notes about the action'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit(
      'log_collection_action',
      'WRITE',
      withRateLimit('log_collection_action', async ({ invoiceId, actionType, channel = 'EMAIL', notes }: any) => {
        const invoice = await prisma.invoice.findUnique({
          where: { id: invoiceId },
          select: { id: true },
        })
        if (!invoice) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: 'Invoice not found', invoiceId }) },
            ],
            isError: true,
          }
        }

        const action = await prisma.collectionAction.create({
          data: {
            invoiceId,
            actionType,
            channel,
            sentBy: 'mcp-service',
            notes: notes ?? null,
          },
          select: { id: true, invoiceId: true, actionType: true },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  actionId: action.id,
                  invoiceId: action.invoiceId,
                  actionType: action.actionType,
                },
                null,
                2,
              ),
            },
          ],
        }
      }),
    ),
  )
}
