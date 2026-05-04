/**
 * MCP tools — Projects & Jobs domain.
 *
 * Phase 1 (read-only): search_projects, search_jobs
 *
 * Project = sales-side artifact (blueprint → takeoff → quote → order).
 * Job = ops-side artifact (the physical drop/delivery/install).
 * They are linked indirectly via Order.quote.projectId (no direct FK on Job).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit } from '../wrap'

export function registerProjectTools(server: McpServer) {
  // ──────────────────────────────────────────────────────────────────
  // search_projects
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'search_projects',
    {
      description:
        'Search and filter sales-side projects (blueprint → takeoff → quote → order pipeline). Returns projects with builder name and the most-recent quote. Use for "show me Brookfield projects", "what plans are awaiting takeoff", etc.',
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe('Search text (matches project name, jobAddress, or subdivision)'),
        builderId: z.string().optional().describe('Filter to a specific builder by ID'),
        status: z
          .enum([
            'DRAFT',
            'BLUEPRINT_UPLOADED',
            'TAKEOFF_PENDING',
            'TAKEOFF_COMPLETE',
            'QUOTE_GENERATED',
            'QUOTE_APPROVED',
            'ORDERED',
            'IN_PROGRESS',
            'DELIVERED',
            'COMPLETE',
          ])
          .optional()
          .describe('Filter by exact project status'),
        dateFrom: z.string().optional().describe('ISO date — projects created on or after'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_projects', 'READ', async (args) => {
      const { q, builderId, status, dateFrom, page = 1, limit = 20 } = args
      const where: any = {}
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { jobAddress: { contains: q, mode: 'insensitive' } },
          { subdivision: { contains: q, mode: 'insensitive' } },
        ]
      }
      if (builderId) where.builderId = builderId
      if (status) where.status = status
      if (dateFrom) {
        where.createdAt = { gte: new Date(dateFrom) }
      }

      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          select: {
            id: true,
            name: true,
            jobAddress: true,
            city: true,
            state: true,
            lotNumber: true,
            subdivision: true,
            planName: true,
            sqFootage: true,
            latitude: true,
            longitude: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            builder: { select: { id: true, companyName: true } },
            quotes: {
              select: {
                id: true,
                quoteNumber: true,
                status: true,
                total: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.project.count({ where }),
      ])

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ projects, total, page, pageSize: limit }, null, 2),
          },
        ],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // search_jobs
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'search_jobs',
    {
      description:
        'Search and filter ops-side jobs (the physical drop/delivery/install record). Returns jobs with the most-recent delivery status. Use for "what jobs are scheduled this week", "show me Brookfield jobs in Canyon Ridge", "find job JOB-2026-0142", etc.',
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe('Search text (matches jobNumber, jobAddress, builderName, or community)'),
        status: z
          .enum([
            'CREATED',
            'READINESS_CHECK',
            'MATERIALS_LOCKED',
            'IN_PRODUCTION',
            'STAGED',
            'LOADED',
            'IN_TRANSIT',
            'DELIVERED',
            'INSTALLING',
            'PUNCH_LIST',
            'COMPLETE',
            'INVOICED',
            'CLOSED',
          ])
          .optional()
          .describe('Filter by exact job status'),
        jobNumber: z
          .string()
          .optional()
          .describe('Exact match on jobNumber (e.g., "JOB-2026-0142")'),
        assignedPMId: z.string().optional().describe('Filter to a specific PM by Staff ID'),
        scheduledFrom: z
          .string()
          .optional()
          .describe('ISO date — jobs scheduled on or after'),
        scheduledTo: z
          .string()
          .optional()
          .describe('ISO date — jobs scheduled on or before'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_jobs', 'READ', async (args) => {
      const {
        q,
        status,
        jobNumber,
        assignedPMId,
        scheduledFrom,
        scheduledTo,
        page = 1,
        limit = 20,
      } = args
      const where: any = {}
      if (jobNumber) where.jobNumber = jobNumber
      if (q) {
        where.OR = [
          { jobNumber: { contains: q, mode: 'insensitive' } },
          { jobAddress: { contains: q, mode: 'insensitive' } },
          { builderName: { contains: q, mode: 'insensitive' } },
          { community: { contains: q, mode: 'insensitive' } },
        ]
      }
      if (status) where.status = status
      if (assignedPMId) where.assignedPMId = assignedPMId
      if (scheduledFrom || scheduledTo) {
        where.scheduledDate = {}
        if (scheduledFrom) where.scheduledDate.gte = new Date(scheduledFrom)
        if (scheduledTo) where.scheduledDate.lte = new Date(scheduledTo)
      }

      const [jobs, total] = await Promise.all([
        prisma.job.findMany({
          where,
          select: {
            id: true,
            jobNumber: true,
            boltJobId: true,
            inflowJobId: true,
            orderId: true,
            projectId: true,
            lotBlock: true,
            community: true,
            communityId: true,
            builderName: true,
            builderContact: true,
            jobAddress: true,
            latitude: true,
            longitude: true,
            bwpPoNumber: true,
            hyphenJobId: true,
            scopeType: true,
            jobType: true,
            status: true,
            assignedPMId: true,
            scheduledDate: true,
            actualDate: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
            deliveries: {
              select: {
                id: true,
                deliveryNumber: true,
                status: true,
                departedAt: true,
                arrivedAt: true,
                completedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.job.count({ where }),
      ])

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ jobs, total, page, pageSize: limit }, null, 2),
          },
        ],
      }
    }),
  )
}
