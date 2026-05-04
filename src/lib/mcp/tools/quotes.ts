/**
 * MCP tools — Quotes domain.
 *
 * Phase 1 (read-only): search_quotes, get_quote
 * Phase 2 (write): create_quote
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

export function registerQuoteTools(server: McpServer) {
  server.registerTool(
    'search_quotes',
    {
      description:
        'Search quotes by builder, project, status, or date range. Returns quote number, builder, project, total, and validity. Use for "open quotes for Bloomfield", "quotes expiring this week", etc.',
      inputSchema: {
        q: z.string().optional().describe('Search text (quote number, project name, builder name)'),
        builderId: z.string().optional(),
        projectName: z.string().optional().describe('Filter by exact project name match'),
        status: z
          .enum(['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED'])
          .optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
    },
    async ({ q, builderId, projectName, status, dateFrom, dateTo, page = 1, limit = 20 }) => {
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
        content: [{ type: 'text', text: JSON.stringify({ quotes, total, page, pageSize: limit }, null, 2) }],
      }
    },
  )

  server.registerTool(
    'get_quote',
    {
      description: 'Get full quote detail with line items and project info.',
      inputSchema: {
        quoteId: z.string().describe('Quote ID (cuid format)'),
      },
    },
    async ({ quoteId }) => {
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
          content: [{ type: 'text', text: JSON.stringify({ error: 'Quote not found', quoteId }) }],
          isError: true,
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }] }
    },
  )
}
