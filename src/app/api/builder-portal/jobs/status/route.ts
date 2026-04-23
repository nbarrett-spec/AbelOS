export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import {
  computeJobMaterialStatus,
  type JobMaterialStatus,
  type MaterialStatus,
} from '@/lib/mrp/atp'

/**
 * GET /api/builder-portal/jobs/status
 *
 * Builder-facing schedule-risk feed. Returns one row per active job owned by
 * the authenticated builder (via Order.builderId), classified GREEN / AMBER /
 * RED by the ATP engine.
 *
 * Builder view — NOT the staff view. We strip every internal breadcrumb:
 *   - no shortage SKUs / product names
 *   - no PO numbers, vendor names, lead times
 *   - no unit costs, shortage values, reorder qtys
 *   - no allocation math
 *
 * What the builder sees:
 *   - each job's scheduled delivery date
 *   - one of three plain-English statuses
 *   - the earliest date we expect the whole job to be whole (resolutionDate)
 *   - a one-line narrative (voice.md: quiet competence, no oversell)
 */

export interface BuilderJobStatusItem {
  jobId: string
  jobNumber: string | null
  community: string | null
  address: string | null
  scheduledDate: string | null
  status: 'ON_SCHEDULE' | 'AT_RISK' | 'DELAYED' | 'PENDING'
  headline: string
  message: string
  resolutionDate: string | null
  daysUntilDelivery: number | null
  itemsOnSchedule: number
  itemsAtRisk: number
  totalItems: number
}

export interface BuilderJobStatusResponse {
  counts: {
    onSchedule: number
    atRisk: number
    delayed: number
    pending: number
    total: number
  }
  jobs: BuilderJobStatusItem[]
  asOf: string
}

// ── Status translator ─────────────────────────────────────────────────────
// Internal GREEN/AMBER/RED → builder-facing language.

function translate(
  internal: MaterialStatus,
  scheduledDate: Date | null,
  linesRedAmber: Array<{ incomingDate: Date | null; shortfall: number; status: string }>
): {
  status: BuilderJobStatusItem['status']
  headline: string
  message: string
  resolutionDate: Date | null
} {
  const daysOut = scheduledDate
    ? Math.max(0, Math.ceil((scheduledDate.getTime() - Date.now()) / 86400000))
    : null
  const dayPhrase = daysOut == null ? '' : daysOut === 0 ? 'today' : daysOut === 1 ? 'tomorrow' : `in ${daysOut} days`

  if (internal === 'UNKNOWN') {
    return {
      status: 'PENDING',
      headline: 'SCHEDULING',
      message: scheduledDate
        ? `Delivery ${dayPhrase}. Final check pending.`
        : 'Awaiting delivery date.',
      resolutionDate: scheduledDate,
    }
  }

  if (internal === 'GREEN') {
    return {
      status: 'ON_SCHEDULE',
      headline: 'ON SCHEDULE',
      message: scheduledDate ? `Delivering ${dayPhrase}.` : 'Delivery on schedule.',
      resolutionDate: scheduledDate,
    }
  }

  // AMBER / RED — find the latest incoming date (that's when the last piece lands)
  const incomingDates = linesRedAmber
    .map((l) => l.incomingDate)
    .filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()))
  const latestIncoming =
    incomingDates.length > 0
      ? new Date(Math.max(...incomingDates.map((d) => d.getTime())))
      : null

  if (internal === 'AMBER') {
    const resolution = latestIncoming ?? scheduledDate
    const resolutionPhrase = latestIncoming
      ? `by ${formatShortDate(latestIncoming)}`
      : dayPhrase
    return {
      status: 'AT_RISK',
      headline: 'AT RISK',
      message: scheduledDate
        ? `Incoming inventory expected ${resolutionPhrase}, delivers ${formatShortDate(scheduledDate)}.`
        : 'Incoming inventory covers the gap.',
      resolutionDate: resolution,
    }
  }

  // RED — delayed. Resolution = latest incoming if any; otherwise project 10 business days out.
  const fallbackResolution = new Date(Date.now() + 14 * 86400000)
  const resolution = latestIncoming ?? fallbackResolution
  return {
    status: 'DELAYED',
    headline: 'DELAYED',
    message: `Expected resolution ${formatShortDate(resolution)}. We're on it.`,
    resolutionDate: resolution,
  }
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Pull every active Job owned by this builder (via Order.builderId).
    const rawJobs = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        jobNumber: string | null
        community: string | null
        jobAddress: string | null
        scheduledDate: Date | null
      }>
    >(
      `SELECT j.id, j."jobNumber", j.community, j."jobAddress", j."scheduledDate"
       FROM "Job" j
       JOIN "Order" o ON o.id = j."orderId"
       WHERE o."builderId" = $1
         AND j.status NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
       ORDER BY COALESCE(j."scheduledDate", j."createdAt") ASC`,
      session.builderId
    )

    // Compute ATP status per job. Parallelized; each is a single CTE query.
    const statuses: JobMaterialStatus[] = await Promise.all(
      rawJobs.map((j) => computeJobMaterialStatus(j.id, { shortagesOnly: false }))
    )

    const now = new Date()
    const items: BuilderJobStatusItem[] = rawJobs.map((j, idx) => {
      const atp = statuses[idx]
      // Only feed non-GREEN lines into the translator — we need the worst
      // incoming-PO date for resolution phrasing, but we never surface the
      // actual PO/vendor/SKU/qty to the builder.
      const offendingLines = atp.lines
        .filter((l) => l.status !== 'GREEN')
        .map((l) => {
          const firstIncoming = l.incomingBeforeDueDate[0]
          return {
            incomingDate: firstIncoming ? new Date(firstIncoming.expectedDate) : null,
            shortfall: l.shortfall,
            status: l.status,
          }
        })

      const scheduledDate = j.scheduledDate ? new Date(j.scheduledDate) : null
      const t = translate(atp.overallStatus, scheduledDate, offendingLines)

      const totalItems = atp.lines.length
      const itemsOnSchedule = atp.lines.filter((l) => l.status === 'GREEN').length
      const itemsAtRisk = totalItems - itemsOnSchedule

      const daysUntilDelivery = scheduledDate
        ? Math.ceil((scheduledDate.getTime() - now.getTime()) / 86400000)
        : null

      return {
        jobId: j.id,
        jobNumber: j.jobNumber,
        community: j.community,
        address: j.jobAddress,
        scheduledDate: scheduledDate ? scheduledDate.toISOString() : null,
        status: t.status,
        headline: t.headline,
        message: t.message,
        resolutionDate: t.resolutionDate ? t.resolutionDate.toISOString() : null,
        daysUntilDelivery,
        itemsOnSchedule,
        itemsAtRisk,
        totalItems,
      }
    })

    const counts = {
      onSchedule: items.filter((i) => i.status === 'ON_SCHEDULE').length,
      atRisk: items.filter((i) => i.status === 'AT_RISK').length,
      delayed: items.filter((i) => i.status === 'DELAYED').length,
      pending: items.filter((i) => i.status === 'PENDING').length,
      total: items.length,
    }

    const response: BuilderJobStatusResponse = {
      counts,
      jobs: items,
      asOf: now.toISOString(),
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error('[builder-portal/jobs/status] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load job status' },
      { status: 500 }
    )
  }
}
