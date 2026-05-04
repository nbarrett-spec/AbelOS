/**
 * MCP tools — Builders / Customers domain.
 *
 * Phase 1 (read-only): search_builders, get_builder
 * Phase 2: get_builder_statement, update_builder
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

export function registerBuilderTools(server: McpServer) {
  server.registerTool(
    'search_builders',
    {
      description:
        'Search builder accounts (customers). Returns name, status, payment terms, contact info, and order/quote counts. Use for "who do we sell to", "show me Bloomfield", "active builders in DFW".',
      inputSchema: {
        search: z.string().optional().describe('Free-text — matches company name, contact, email'),
        status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
        paymentTerm: z
          .enum(['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30'])
          .optional(),
        builderType: z.enum(['PRODUCTION', 'CUSTOM']).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
    },
    async ({ search, status, paymentTerm, builderType, page = 1, limit = 20 }) => {
      const where: any = {}
      if (search) {
        where.OR = [
          { companyName: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ]
      }
      if (status) where.status = status
      if (paymentTerm) where.paymentTerm = paymentTerm
      if (builderType) where.builderType = builderType

      const [builders, total] = await Promise.all([
        prisma.builder.findMany({
          where,
          select: {
            id: true,
            companyName: true,
            contactName: true,
            email: true,
            phone: true,
            city: true,
            state: true,
            status: true,
            paymentTerm: true,
            creditLimit: true,
            builderType: true,
            territory: true,
            _count: {
              select: { orders: true, projects: true },
            },
          },
          orderBy: { companyName: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.builder.count({ where }),
      ])

      return {
        content: [{ type: 'text', text: JSON.stringify({ builders, total, page, pageSize: limit }, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_builder',
    {
      description:
        'Get full builder profile with contacts, payment history, recent orders/quotes/invoices, and A/R summary (total outstanding, overdue, credit utilization).',
      inputSchema: {
        builderId: z.string().describe('Builder ID (cuid format)'),
      },
    },
    async ({ builderId }) => {
      const builder = await prisma.builder.findUnique({
        where: { id: builderId },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          licenseNumber: true,
          status: true,
          paymentTerm: true,
          creditLimit: true,
          taxExempt: true,
          builderType: true,
          territory: true,
          annualVolume: true,
          website: true,
          createdAt: true,
        },
      })
      if (!builder) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Builder not found', builderId }) }],
          isError: true,
        }
      }

      // Roll up A/R + activity.
      const [recentOrders, recentQuotes, openInvoices, contacts] = await Promise.all([
        prisma.order.findMany({
          where: { builderId },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            paymentStatus: true,
            paidAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.quote.findMany({
          where: { project: { builderId } },
          select: {
            id: true,
            quoteNumber: true,
            status: true,
            total: true,
            createdAt: true,
            project: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.invoice.findMany({
          where: { builderId, balanceDue: { gt: 0 } },
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            balanceDue: true,
            issuedAt: true,
            dueDate: true,
          },
          orderBy: { dueDate: 'asc' },
        }),
        prisma.builderContact.findMany({
          where: { builderId, active: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
            isPrimary: true,
          },
        }),
      ])

      const totalOutstanding = openInvoices.reduce((s, i) => s + (i.balanceDue || 0), 0)
      const now = Date.now()
      const overdueAmount = openInvoices
        .filter((i) => i.dueDate && new Date(i.dueDate).getTime() < now)
        .reduce((s, i) => s + (i.balanceDue || 0), 0)
      const creditUtilization =
        builder.creditLimit && builder.creditLimit > 0
          ? totalOutstanding / builder.creditLimit
          : null

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                builder,
                contacts,
                recentOrders,
                recentQuotes,
                openInvoices,
                ar: {
                  totalOutstanding,
                  overdueAmount,
                  openInvoiceCount: openInvoices.length,
                  creditLimit: builder.creditLimit,
                  creditUtilization,
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
