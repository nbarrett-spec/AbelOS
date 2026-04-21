export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/projects/standup/[pmId]
 *
 * Generates a markdown standup for a PM covering:
 *   - Completed yesterday (jobs whose status moved to COMPLETE/CLOSED yesterday)
 *   - Committed today (jobs scheduled for today or in-progress)
 *   - Blocked / at-risk (jobs overdue, AWAITING_MATERIAL orders, overdue invoices)
 *
 * Uses Job.updatedAt as a proxy for the status-change date. Not perfect
 * but adequate until we wire an audit log per-job.
 *
 * TODO: replace with AI-authored narrative from the NUC brain.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { pmId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const pmId = params.pmId
    const pm = await prisma.staff.findUnique({
      where: { id: pmId },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    if (!pm) return NextResponse.json({ error: 'PM not found' }, { status: 404 })

    const now = new Date()
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

    const jobs = await prisma.job.findMany({
      where: { assignedPMId: pmId },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        scheduledDate: true,
        completedAt: true,
        updatedAt: true,
        builderName: true,
        community: true,
        lotBlock: true,
        jobAddress: true,
        scopeType: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    const completedYesterday = jobs.filter(
      (j) =>
        ['COMPLETE', 'CLOSED', 'INVOICED'].includes(j.status) &&
        j.updatedAt >= startOfYesterday &&
        j.updatedAt < startOfToday
    )

    const committedToday = jobs.filter(
      (j) =>
        !['COMPLETE', 'CLOSED', 'INVOICED', 'CANCELLED'].includes(j.status) &&
        ((j.scheduledDate && j.scheduledDate >= startOfToday && j.scheduledDate < startOfTomorrow) ||
          ['IN_PRODUCTION', 'INSTALLING', 'STAGED', 'LOADED', 'IN_TRANSIT'].includes(j.status))
    )

    const blocked = jobs.filter(
      (j) =>
        !['COMPLETE', 'CLOSED', 'INVOICED', 'CANCELLED'].includes(j.status) &&
        ((j.scheduledDate && j.scheduledDate < startOfToday) ||
          j.status === 'PUNCH_LIST' ||
          j.order?.status === 'AWAITING_MATERIAL' ||
          j.order?.paymentStatus === 'OVERDUE')
    )

    const bullet = (j: (typeof jobs)[number]) => {
      const loc = [j.lotBlock, j.community || j.builderName].filter(Boolean).join(' — ')
      return `- **${j.jobNumber}** · ${loc} · _${j.status.replace('_', ' ')}_`
    }

    const markdown = [
      `# Standup — ${pm.firstName} ${pm.lastName}`,
      `_${now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}_`,
      ``,
      `## Completed yesterday (${completedYesterday.length})`,
      completedYesterday.length ? completedYesterday.map(bullet).join('\n') : '_Nothing hit complete yesterday._',
      ``,
      `## Committing today (${committedToday.length})`,
      committedToday.length ? committedToday.map(bullet).join('\n') : '_Nothing scheduled for today._',
      ``,
      `## Blocked / at-risk (${blocked.length})`,
      blocked.length
        ? blocked
            .map((j) => {
              const reasons: string[] = []
              if (j.scheduledDate && j.scheduledDate < startOfToday) reasons.push('overdue')
              if (j.order?.status === 'AWAITING_MATERIAL') reasons.push('awaiting material')
              if (j.order?.paymentStatus === 'OVERDUE') reasons.push('payment overdue')
              if (j.status === 'PUNCH_LIST') reasons.push('punch list open')
              return `${bullet(j)}  \n  _${reasons.join(' · ')}_`
            })
            .join('\n')
        : '_No blockers._',
    ].join('\n')

    return NextResponse.json({
      pm: {
        id: pm.id,
        name: `${pm.firstName} ${pm.lastName}`,
        email: pm.email,
      },
      counts: {
        completedYesterday: completedYesterday.length,
        committedToday: committedToday.length,
        blocked: blocked.length,
      },
      markdown,
    })
  } catch (err: any) {
    console.error('[projects standup] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
