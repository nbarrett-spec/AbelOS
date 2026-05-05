/**
 * MCP tools — Builders / Customers domain.
 *
 * Phase 1 (read): search_builders, get_builder
 * Phase 2: get_builder_statement, update_builder
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit, withRateLimit } from '../wrap'

const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const
const PAYMENT_TERMS = ['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30'] as const

export function registerBuilderTools(server: McpServer) {
  server.registerTool(
    'search_builders',
    {
      description:
        'Search builder accounts (customers). Returns name, status, payment terms, contact info, and order/project counts.',
      inputSchema: {
        search: z.string().optional(),
        status: z.enum(ACCOUNT_STATUSES).optional(),
        paymentTerm: z.enum(PAYMENT_TERMS).optional(),
        builderType: z.enum(['PRODUCTION', 'CUSTOM']).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_builders', 'READ', async (args: any) => {
      const { search, status, paymentTerm, builderType, page = 1, limit = 20 } = args
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
            _count: { select: { orders: true, projects: true } },
          },
          orderBy: { companyName: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.builder.count({ where }),
      ])
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ builders, total, page, pageSize: limit }, null, 2) }],
      }
    }),
  )

  server.registerTool(
    'get_builder',
    {
      description:
        'Get full builder profile with contacts, recent orders/quotes/invoices, and A/R rollup (totalOutstanding, overdueAmount, creditUtilization).',
      inputSchema: { builderId: z.string() },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_builder', 'READ', async ({ builderId }: any) => {
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
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Builder not found', builderId }) }],
          isError: true,
        }
      }
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
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, isPrimary: true },
        }),
      ])
      const totalOutstanding = openInvoices.reduce((s, i) => s + (i.balanceDue || 0), 0)
      const now = Date.now()
      const overdueAmount = openInvoices
        .filter((i) => i.dueDate && new Date(i.dueDate).getTime() < now)
        .reduce((s, i) => s + (i.balanceDue || 0), 0)
      const creditUtilization =
        builder.creditLimit && builder.creditLimit > 0 ? totalOutstanding / builder.creditLimit : null
      return {
        content: [
          {
            type: 'text' as const,
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
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_builder_statement (read)
  //
  // Full A/R statement: every invoice, payments breakdown, aging
  // buckets, DSO over the last 90d.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_builder_statement',
    {
      description:
        'A/R statement for a builder — all invoices, aging buckets (current / 1-30 / 31-60 / 61-90 / 90+), DSO over last 90 days, credit utilization. Use for "what does Bloomfield owe us?" / "Toll AR aging".',
      inputSchema: { builderId: z.string(), since: z.string().optional().describe('ISO date — only invoices after this. Default: last 12 months.') },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_builder_statement', 'READ', async ({ builderId, since }: any) => {
      const cutoff = since ? new Date(since) : new Date(Date.now() - 365 * 86400000)
      const builder = await prisma.builder.findUnique({
        where: { id: builderId },
        select: { id: true, companyName: true, paymentTerm: true, creditLimit: true },
      })
      if (!builder) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Builder not found', builderId }) }],
          isError: true,
        }
      }
      const invoices = await prisma.invoice.findMany({
        where: { builderId, issuedAt: { gte: cutoff } },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          issuedAt: true,
          dueDate: true,
          paidAt: true,
        },
        orderBy: { issuedAt: 'desc' },
      })
      const now = Date.now()
      const aging = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
      let totalOutstanding = 0
      for (const i of invoices) {
        if (i.balanceDue <= 0) continue
        totalOutstanding += i.balanceDue
        if (!i.dueDate) {
          aging.current += i.balanceDue
          continue
        }
        const daysOverdue = (now - new Date(i.dueDate).getTime()) / 86400000
        if (daysOverdue <= 0) aging.current += i.balanceDue
        else if (daysOverdue <= 30) aging['1-30'] += i.balanceDue
        else if (daysOverdue <= 60) aging['31-60'] += i.balanceDue
        else if (daysOverdue <= 90) aging['61-90'] += i.balanceDue
        else aging['90+'] += i.balanceDue
      }
      // DSO: avg days from issuedAt to paidAt for invoices paid in last 90d.
      const ninetyDaysAgo = new Date(now - 90 * 86400000)
      const paidRecently = invoices.filter(
        (i) => i.paidAt && new Date(i.paidAt) >= ninetyDaysAgo && i.issuedAt,
      )
      const dso =
        paidRecently.length > 0
          ? paidRecently.reduce(
              (s, i) =>
                s +
                (new Date(i.paidAt!).getTime() - new Date(i.issuedAt!).getTime()) / 86400000,
              0,
            ) / paidRecently.length
          : null
      const creditUtilization =
        builder.creditLimit && builder.creditLimit > 0 ? totalOutstanding / builder.creditLimit : null

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                builder,
                statementSince: cutoff.toISOString(),
                invoices,
                summary: {
                  totalInvoiced: invoices.reduce((s, i) => s + i.total, 0),
                  totalPaid: invoices.reduce((s, i) => s + i.amountPaid, 0),
                  totalOutstanding,
                  aging,
                  dsoLast90d: dso,
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
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // update_builder (write)
  //
  // Mutate a small whitelist of fields. Mirrors the validated set in
  // /api/admin/builders/[id] PATCH but accepts only the fields that
  // are safe to set via MCP.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'update_builder',
    {
      description:
        'Update a builder account (status, credit limit, payment term, notes). Other fields require the admin UI.',
      inputSchema: {
        builderId: z.string(),
        status: z.enum(ACCOUNT_STATUSES).optional(),
        paymentTerm: z.enum(PAYMENT_TERMS).optional(),
        creditLimit: z.number().nonnegative().optional(),
        taxExempt: z.boolean().optional(),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('update_builder', 'WRITE', withRateLimit('update_builder', async ({ builderId, status, paymentTerm, creditLimit, taxExempt }: any) => {
      const before = await prisma.builder.findUnique({
        where: { id: builderId },
        select: {
          id: true,
          companyName: true,
          status: true,
          paymentTerm: true,
          creditLimit: true,
          taxExempt: true,
        },
      })
      if (!before) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Builder not found', builderId }) }],
          isError: true,
        }
      }
      const data: any = {}
      if (status !== undefined) data.status = status
      if (paymentTerm !== undefined) data.paymentTerm = paymentTerm
      if (creditLimit !== undefined) data.creditLimit = creditLimit
      if (taxExempt !== undefined) data.taxExempt = taxExempt
      if (Object.keys(data).length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No fields supplied to update' }) }],
          isError: true,
        }
      }
      const after = await prisma.builder.update({
        where: { id: builderId },
        data,
        select: {
          id: true,
          companyName: true,
          status: true,
          paymentTerm: true,
          creditLimit: true,
          taxExempt: true,
        },
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, before, after }, null, 2) }],
      }
    })),
  )
}
