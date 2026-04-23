export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { computeJobMaterialStatus } from '@/lib/mrp/atp'

/**
 * GET /api/builder-portal/jobs/:jobId/status
 *
 * Builder drill-down for a single job. Returns a builder-safe breakdown:
 * counts of items on schedule vs at risk, and a short message. We DO NOT
 * return SKUs, product names, vendors, POs, quantities, or costs — the
 * builder sees "3 items" not "3x 8068 Masonite fir RH."
 */

export interface BuilderJobDetail {
  jobId: string
  jobNumber: string | null
  community: string | null
  address: string | null
  scheduledDate: string | null
  status: 'ON_SCHEDULE' | 'AT_RISK' | 'DELAYED' | 'PENDING'
  headline: string
  message: string
  resolutionDate: string | null
  itemsOnSchedule: number
  itemsAtRisk: number
  totalItems: number
  /** Opaque bucket summary, no SKUs. e.g. [{label: 'On schedule', count: 14}] */
  buckets: Array<{ label: string; count: number; tone: 'success' | 'warning' | 'danger' }>
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { jobId } = await params

  try {
    // Ownership guard — confirm this job belongs to the authenticated builder.
    const ownership = await prisma.$queryRawUnsafe<
      Array<{ id: string; jobNumber: string | null; community: string | null; jobAddress: string | null; scheduledDate: Date | null }>
    >(
      `SELECT j.id, j."jobNumber", j.community, j."jobAddress", j."scheduledDate"
       FROM "Job" j
       JOIN "Order" o ON o.id = j."orderId"
       WHERE j.id = $1 AND o."builderId" = $2
       LIMIT 1`,
      jobId,
      session.builderId
    )
    if (ownership.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const job = ownership[0]

    const atp = await computeJobMaterialStatus(jobId, { shortagesOnly: false })
    const totalItems = atp.lines.length
    const itemsOnSchedule = atp.lines.filter((l) => l.status === 'GREEN').length
    const itemsAtRisk = atp.lines.filter((l) => l.status === 'AMBER').length
    const itemsDelayed = atp.lines.filter((l) => l.status === 'RED').length

    const scheduledDate = job.scheduledDate ? new Date(job.scheduledDate) : null
    const daysOut = scheduledDate
      ? Math.max(0, Math.ceil((scheduledDate.getTime() - Date.now()) / 86400000))
      : null
    const dayPhrase =
      daysOut == null ? '' : daysOut === 0 ? 'today' : daysOut === 1 ? 'tomorrow' : `in ${daysOut} days`

    // Find the latest incoming PO across non-GREEN lines for resolution date.
    const incomingDates: Date[] = []
    for (const l of atp.lines) {
      if (l.status === 'GREEN') continue
      for (const po of l.incomingBeforeDueDate) {
        incomingDates.push(new Date(po.expectedDate))
      }
    }
    const latestIncoming =
      incomingDates.length > 0
        ? new Date(Math.max(...incomingDates.map((d) => d.getTime())))
        : null

    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })

    let status: BuilderJobDetail['status']
    let headline: string
    let message: string
    let resolutionDate: Date | null

    if (atp.overallStatus === 'UNKNOWN') {
      status = 'PENDING'
      headline = 'SCHEDULING'
      message = scheduledDate ? `Delivery ${dayPhrase}. Final check pending.` : 'Awaiting delivery date.'
      resolutionDate = scheduledDate
    } else if (atp.overallStatus === 'GREEN') {
      status = 'ON_SCHEDULE'
      headline = 'ON SCHEDULE'
      message = scheduledDate ? `Delivering ${dayPhrase}.` : 'Delivery on schedule.'
      resolutionDate = scheduledDate
    } else if (atp.overallStatus === 'AMBER') {
      status = 'AT_RISK'
      headline = 'AT RISK'
      resolutionDate = latestIncoming ?? scheduledDate
      message = scheduledDate
        ? `Incoming inventory expected ${latestIncoming ? `by ${fmt(latestIncoming)}` : dayPhrase}, delivers ${fmt(scheduledDate)}.`
        : 'Incoming inventory covers the gap.'
    } else {
      status = 'DELAYED'
      headline = 'DELAYED'
      resolutionDate = latestIncoming ?? new Date(Date.now() + 14 * 86400000)
      const shortCount = itemsDelayed
      message = `${shortCount} ${shortCount === 1 ? 'item' : 'items'} short. Expected resolution ${fmt(resolutionDate)}. We're on it.`
    }

    const buckets: BuilderJobDetail['buckets'] = [
      { label: 'On schedule', count: itemsOnSchedule, tone: 'success' },
    ]
    if (itemsAtRisk > 0) buckets.push({ label: 'Incoming', count: itemsAtRisk, tone: 'warning' })
    if (itemsDelayed > 0) buckets.push({ label: 'Working on it', count: itemsDelayed, tone: 'danger' })

    const response: BuilderJobDetail = {
      jobId,
      jobNumber: job.jobNumber,
      community: job.community,
      address: job.jobAddress,
      scheduledDate: scheduledDate ? scheduledDate.toISOString() : null,
      status,
      headline,
      message,
      resolutionDate: resolutionDate ? resolutionDate.toISOString() : null,
      itemsOnSchedule,
      itemsAtRisk,
      totalItems,
      buckets,
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error('[builder-portal/jobs/:id/status] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load job detail' },
      { status: 500 }
    )
  }
}
