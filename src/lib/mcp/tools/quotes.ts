/**
 * MCP tools — Quotes domain.
 *
 * Phase 1 (read): search_quotes, get_quote
 * Phase 2 (write): create_quote
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit } from '../wrap'

const QUOTE_STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED'] as const

export function registerQuoteTools(server: McpServer) {
  server.registerTool(
    'search_quotes',
    {
      description:
        'Search quotes by builder, project, status, or date range. Returns quote number, builder, project, total, and validity. Use for "open quotes for Bloomfield", "quotes expiring this week", etc.',
      inputSchema: {
        q: z.string().optional(),
        builderId: z.string().optional(),
        projectName: z.string().optional(),
        status: z.enum(QUOTE_STATUSES).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_quotes', 'READ', async (args: any) => {
      const { q, builderId, projectName, status, dateFrom, dateTo, page = 1, limit = 20 } = args
      const where: any = {}
      if (q) {
        where.OR = [
          { quoteNumber: { contains: q, mode: 'insensitive' } },
          { project: { name: { contains: q, mode: 'insensitive' } } },
          { project: { builder: { companyName: { contains: q, mode: 'insensitive' } } } },
        ]
      }
      if (status) where.status = status
      if (projectName) where.project = { name: projectName }
      if (builderId) where.project = { ...(where.project || {}), builderId }
      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = new Date(dateFrom)
        if (dateTo) where.createdAt.lte = new Date(dateTo)
      }
      const [quotes, total] = await Promise.all([
        prisma.quote.findMany({
          where,
          select: {
            id: true,
            quoteNumber: true,
            status: true,
            total: true,
            validUntil: true,
            createdAt: true,
            project: {
              select: {
                id: true,
                name: true,
                jobAddress: true,
                builder: { select: { id: true, companyName: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.quote.count({ where }),
      ])
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ quotes, total, page, pageSize: limit }, null, 2) }],
      }
    }),
  )

  server.registerTool(
    'get_quote',
    {
      description: 'Get full quote detail with line items and project info.',
      inputSchema: { quoteId: z.string().describe('Quote ID (cuid format)') },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_quote', 'READ', async ({ quoteId }: any) => {
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: {
          items: true,
          project: {
            include: {
              builder: { select: { id: true, companyName: true, email: true } },
            },
          },
        },
      })
      if (!quote) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Quote not found', quoteId }) }],
          isError: true,
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(quote, null, 2) }] }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // create_quote (write)
  //
  // Note: Quote.takeoffId is a required @unique foreign key, and a
  // Quote needs an associated Project. For MCP creation we assume the
  // caller provides projectId AND a placeholder takeoffId — or we
  // create a minimal Takeoff row first. To keep this tool simple,
  // we require an existing takeoffId. If you want a "quick quote"
  // flow without a takeoff, a future tool can wrap that.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_quote',
    {
      description:
        'Create a new DRAFT quote attached to an existing Project + Takeoff. Caller provides line items + pricing. Returns the new quote ID and number.',
      inputSchema: {
        projectId: z.string().describe('Existing Project ID'),
        takeoffId: z.string().describe('Existing Takeoff ID linked to the project'),
        validUntil: z.string().optional().describe('ISO date — when the quote expires (default 30 days)'),
        notes: z.string().optional(),
        items: z
          .array(
            z.object({
              productId: z.string().optional(),
              description: z.string(),
              quantity: z.number().int().positive(),
              unitPrice: z.number().nonnegative(),
              location: z.string().optional(),
            }),
          )
          .min(1)
          .describe('At least one line item'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('create_quote', 'WRITE', async (args: any) => {
      const { projectId, takeoffId, validUntil, notes, items } = args

      // Validate project + takeoff exist (cheaper to fail fast than to
      // catch a Prisma FK violation).
      const [project, takeoff] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
        prisma.takeoff.findUnique({ where: { id: takeoffId }, select: { id: true } }),
      ])
      if (!project) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not found', projectId }) }],
          isError: true,
        }
      }
      if (!takeoff) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Takeoff not found', takeoffId }) }],
          isError: true,
        }
      }

      const subtotal = items.reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0)
      const total = subtotal // tax/term-adjustment handled later by pricing engine

      const year = new Date().getFullYear()
      const yearStart = new Date(year, 0, 1)
      const count = await prisma.quote.count({ where: { createdAt: { gte: yearStart } } })
      const quoteNumber = `Q-${year}-${String(count + 1).padStart(4, '0')}`

      const quote = await prisma.quote.create({
        data: {
          quoteNumber,
          projectId,
          takeoffId,
          subtotal,
          taxRate: 0,
          taxAmount: 0,
          termAdjustment: 0,
          total,
          status: 'DRAFT',
          validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          notes: notes ?? null,
          items: {
            create: items.map((it: any, idx: number) => ({
              productId: it.productId ?? null,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              lineTotal: it.quantity * it.unitPrice,
              location: it.location ?? null,
              sortOrder: idx,
            })),
          },
        },
        select: { id: true, quoteNumber: true, total: true, status: true },
      })

      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, quote }, null, 2) }] }
    }),
  )
}
