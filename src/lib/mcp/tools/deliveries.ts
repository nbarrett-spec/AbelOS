/**
 * MCP tools — Deliveries domain.
 *
 * Tools:
 *   - get_todays_deliveries  (READ)  — today's deliveries grouped by crew
 *   - dispatch_delivery      (WRITE) — create a SCHEDULED Delivery for a Job
 *   - track_delivery         (READ)  — delivery + recent tracking entries + status-based ETA
 *   - delivery_kpis          (READ)  — completion %, cycle time, refused/partial/rescheduled, on-time %
 *
 * Schema notes (these are easy to get wrong — keep in mind):
 *  • Delivery links to Job (NOT Order). To find a delivery for an Order:
 *      Order → Order.id == Job.orderId → Job → Job.deliveries
 *  • Delivery has NO `scheduledDate` field of its own. The schedule lives on
 *    the parent Job (`job.scheduledDate`). The `scheduledDate` arg on
 *    dispatch_delivery is a reference / sanity check input — it is not
 *    persisted on the Delivery row.
 *  • DeliveryStatus does NOT include a 'DELIVERED' value — completion is
 *    represented by the `COMPLETE` status.
 *  • Address is required on Delivery — pulled from job.jobAddress at dispatch.
 *  • DeliveryTracking rows are point-in-time status updates, not the
 *    delivery's primary status. The Delivery itself owns the canonical
 *    `status` field.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit } from '@/lib/mcp/wrap'

// Status-based ETA descriptors used by track_delivery. No GPS lookup —
// purely a derived label so the caller doesn't have to know the enum.
const ETA_BY_STATUS: Record<string, string> = {
  SCHEDULED: 'pending',
  LOADING: 'loading at warehouse',
  IN_TRANSIT: 'in transit',
  ARRIVED: 'arrived on site',
  UNLOADING: 'unloading on site',
  COMPLETE: 'delivered',
  PARTIAL_DELIVERY: 'partially delivered',
  REFUSED: 'refused on site',
  RESCHEDULED: 'rescheduled',
}

export function registerDeliveryTools(server: McpServer) {
  // ──────────────────────────────────────────────────────────────────
  // get_todays_deliveries
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_todays_deliveries',
    {
      description:
        "Today's deliveries, grouped by crew. Pulls deliveries whose parent Job has scheduledDate == today, plus any deliveries whose own createdAt is today (covers same-day dispatches without a Job scheduledDate). Returns crews[] (each with crew name, type, and deliveries[]) and total count. Use for the morning dispatcher view.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_todays_deliveries', 'READ', async () => {
      const now = new Date()
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

      const deliveries = await prisma.delivery.findMany({
        where: {
          OR: [
            { job: { scheduledDate: { gte: startOfDay, lte: endOfDay } } },
            { createdAt: { gte: startOfDay, lte: endOfDay } },
          ],
        },
        select: {
          id: true,
          deliveryNumber: true,
          status: true,
          routeOrder: true,
          address: true,
          departedAt: true,
          arrivedAt: true,
          completedAt: true,
          notes: true,
          createdAt: true,
          jobId: true,
          crewId: true,
          crew: { select: { id: true, name: true, crewType: true } },
          job: {
            select: {
              id: true,
              jobNumber: true,
              jobAddress: true,
              builderName: true,
              scheduledDate: true,
            },
          },
        },
        orderBy: [{ crewId: 'asc' }, { routeOrder: 'asc' }, { createdAt: 'asc' }],
      })

      // Group by crew. Unassigned deliveries go under a synthetic 'unassigned' bucket.
      const groups = new Map<
        string,
        {
          crewId: string | null
          crewName: string
          crewType: string | null
          deliveries: typeof deliveries
        }
      >()
      for (const d of deliveries) {
        const key = d.crewId ?? '__unassigned__'
        if (!groups.has(key)) {
          groups.set(key, {
            crewId: d.crewId,
            crewName: d.crew?.name ?? 'Unassigned',
            crewType: d.crew?.crewType ?? null,
            deliveries: [],
          })
        }
        groups.get(key)!.deliveries.push(d)
      }

      const crews = Array.from(groups.values()).map((g) => ({
        crewId: g.crewId,
        crewName: g.crewName,
        crewType: g.crewType,
        deliveryCount: g.deliveries.length,
        deliveries: g.deliveries,
      }))

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                date: startOfDay.toISOString().slice(0, 10),
                totalDeliveries: deliveries.length,
                crewCount: crews.length,
                crews,
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
  // dispatch_delivery
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'dispatch_delivery',
    {
      description:
        "Create a new SCHEDULED Delivery for a Job. Generates a DEL-YYYY-NNNN number, copies the address from job.jobAddress, and sets status=SCHEDULED. Note: deliveries link to Jobs (not Orders) and do not store their own scheduledDate — the Job's scheduledDate is authoritative. The scheduledDate arg here is used as a sanity-check reference and persisted in the delivery notes.",
      inputSchema: {
        jobId: z.string().describe('Job ID this delivery is for (cuid). Required.'),
        scheduledDate: z
          .string()
          .describe(
            'Reference scheduled date in ISO format. Compared to the Job.scheduledDate; mismatch is captured in notes.',
          ),
        notes: z.string().optional().describe('Optional dispatcher notes'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('dispatch_delivery', 'WRITE', async (args) => {
      const { jobId, scheduledDate, notes } = args as {
        jobId: string
        scheduledDate: string
        notes?: string
      }

      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          jobNumber: true,
          jobAddress: true,
          builderName: true,
          scheduledDate: true,
        },
      })

      if (!job) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Job not found', jobId }) },
          ],
          isError: true,
        }
      }

      if (!job.jobAddress) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Cannot dispatch delivery — job.jobAddress is empty',
                jobId,
                jobNumber: job.jobNumber,
              }),
            },
          ],
          isError: true,
        }
      }

      const requestedDate = new Date(scheduledDate)
      if (Number.isNaN(requestedDate.getTime())) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid scheduledDate ISO string', scheduledDate }),
            },
          ],
          isError: true,
        }
      }

      // Generate DEL-YYYY-NNNN. Use the requested year and find the next
      // sequence number for that year. Done in a small transaction to avoid
      // collision under concurrent dispatch.
      const created = await prisma.$transaction(async (tx) => {
        const year = requestedDate.getFullYear()
        const prefix = `DEL-${year}-`
        const last = await tx.delivery.findFirst({
          where: { deliveryNumber: { startsWith: prefix } },
          orderBy: { deliveryNumber: 'desc' },
          select: { deliveryNumber: true },
        })
        let seq = 1
        if (last?.deliveryNumber) {
          const tail = last.deliveryNumber.slice(prefix.length)
          const parsed = Number.parseInt(tail, 10)
          if (Number.isFinite(parsed)) seq = parsed + 1
        }
        const deliveryNumber = `${prefix}${String(seq).padStart(4, '0')}`

        // Capture the requested-vs-Job-scheduledDate alignment in notes for
        // the dispatcher. Delivery has no scheduledDate column.
        const jobScheduled = job.scheduledDate?.toISOString() ?? 'unset'
        const refLine = `[dispatch ref] requested=${requestedDate.toISOString()} job.scheduledDate=${jobScheduled}`
        const composedNotes = notes ? `${refLine}\n${notes}` : refLine

        return tx.delivery.create({
          data: {
            jobId: job.id,
            deliveryNumber,
            address: job.jobAddress!,
            status: 'SCHEDULED',
            notes: composedNotes,
          },
          select: {
            id: true,
            deliveryNumber: true,
            jobId: true,
            address: true,
            status: true,
            routeOrder: true,
            notes: true,
            createdAt: true,
          },
        })
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                delivery: created,
                job: {
                  id: job.id,
                  jobNumber: job.jobNumber,
                  builderName: job.builderName,
                  scheduledDate: job.scheduledDate,
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
  // track_delivery
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'track_delivery',
    {
      description:
        'Get a delivery with its recent tracking updates and a status-derived ETA label. No GPS — etaLabel is purely derived from the delivery status (e.g. SCHEDULED -> "pending", IN_TRANSIT -> "in transit", COMPLETE -> "delivered").',
      inputSchema: {
        deliveryId: z.string().describe('Delivery ID (cuid)'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('track_delivery', 'READ', async (args) => {
      const { deliveryId } = args as { deliveryId: string }

      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          crew: { select: { id: true, name: true, crewType: true } },
          job: {
            select: {
              id: true,
              jobNumber: true,
              jobAddress: true,
              builderName: true,
              scheduledDate: true,
            },
          },
          tracking: {
            orderBy: { timestamp: 'desc' },
            take: 25,
          },
        },
      })

      if (!delivery) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Delivery not found', deliveryId }) },
          ],
          isError: true,
        }
      }

      const etaLabel = ETA_BY_STATUS[delivery.status] ?? 'unknown'
      // Last DeliveryTracking row may carry a real ETA timestamp; surface it if so.
      const lastTrackingEta = delivery.tracking[0]?.eta ?? null

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                delivery,
                etaLabel,
                lastTrackingEta,
                trackingCount: delivery.tracking.length,
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
  // delivery_kpis
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'delivery_kpis',
    {
      description:
        'Delivery KPIs across a date range (defaults to last 30 days). Returns totalDeliveries, completePercent, avgCycleTimeHours (createdAt → completedAt for COMPLETE), refusedCount, partialCount, rescheduledCount, and onTimePercent (COMPLETE deliveries whose Job.scheduledDate is within +/- 1 day of the actual completedAt).',
      inputSchema: {
        dateFrom: z
          .string()
          .optional()
          .describe('ISO date — start of window. Defaults to 30 days ago.'),
        dateTo: z
          .string()
          .optional()
          .describe('ISO date — end of window. Defaults to now.'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('delivery_kpis', 'READ', async (args) => {
      const { dateFrom, dateTo } = (args ?? {}) as { dateFrom?: string; dateTo?: string }

      const to = dateTo ? new Date(dateTo) : new Date()
      const from = dateFrom
        ? new Date(dateFrom)
        : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)

      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid dateFrom/dateTo', dateFrom, dateTo }),
            },
          ],
          isError: true,
        }
      }

      const deliveries = await prisma.delivery.findMany({
        where: {
          createdAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          completedAt: true,
          job: { select: { scheduledDate: true } },
        },
      })

      const total = deliveries.length
      const completed = deliveries.filter((d) => d.status === 'COMPLETE')
      const refusedCount = deliveries.filter((d) => d.status === 'REFUSED').length
      const partialCount = deliveries.filter((d) => d.status === 'PARTIAL_DELIVERY').length
      const rescheduledCount = deliveries.filter((d) => d.status === 'RESCHEDULED').length

      const completePercent = total > 0 ? (completed.length / total) * 100 : 0

      // Avg cycle time in hours, only for COMPLETE w/ both timestamps.
      const cycleHours: number[] = []
      for (const d of completed) {
        if (d.completedAt && d.createdAt) {
          const ms = d.completedAt.getTime() - d.createdAt.getTime()
          if (ms >= 0) cycleHours.push(ms / (1000 * 60 * 60))
        }
      }
      const avgCycleTimeHours =
        cycleHours.length > 0
          ? cycleHours.reduce((a, b) => a + b, 0) / cycleHours.length
          : null

      // On-time: completed where Job.scheduledDate is within +/- 1 day of completedAt.
      const ONE_DAY_MS = 24 * 60 * 60 * 1000
      let onTimeEligible = 0
      let onTimeHits = 0
      for (const d of completed) {
        const sched = d.job?.scheduledDate
        if (!sched || !d.completedAt) continue
        onTimeEligible++
        const diff = Math.abs(d.completedAt.getTime() - sched.getTime())
        if (diff <= ONE_DAY_MS) onTimeHits++
      }
      const onTimePercent = onTimeEligible > 0 ? (onTimeHits / onTimeEligible) * 100 : null

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                window: { from: from.toISOString(), to: to.toISOString() },
                totalDeliveries: total,
                completePercent: Number(completePercent.toFixed(2)),
                avgCycleTimeHours:
                  avgCycleTimeHours !== null ? Number(avgCycleTimeHours.toFixed(2)) : null,
                refusedCount,
                partialCount,
                rescheduledCount,
                onTimePercent:
                  onTimePercent !== null ? Number(onTimePercent.toFixed(2)) : null,
                onTimeSampleSize: onTimeEligible,
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
