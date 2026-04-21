export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/projects/[projectId]/timeline
 *
 * Returns a denormalized timeline for a project: orders, jobs, and
 * milestones laid out on a date axis. Client renders as Gantt-lite.
 *
 * The "critical path" is computed as the latest-finishing chain:
 * we order jobs by scheduledDate DESC and bold-underline the sequence
 * whose completion pushes overall finish date. No dependsOn relation
 * exists yet, so this is a heuristic — documented in the UI tooltip.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        id: true,
        name: true,
        status: true,
        planName: true,
        lotNumber: true,
        subdivision: true,
        createdAt: true,
        builder: { select: { id: true, companyName: true } },
        quotes: {
          select: {
            id: true,
            quoteNumber: true,
            status: true,
            createdAt: true,
            total: true,
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                total: true,
                deliveryDate: true,
                createdAt: true,
                jobs: {
                  select: {
                    id: true,
                    jobNumber: true,
                    status: true,
                    scheduledDate: true,
                    actualDate: true,
                    completedAt: true,
                    scopeType: true,
                    createdAt: true,
                    assignedPM: {
                      select: { firstName: true, lastName: true },
                    },
                    deliveries: {
                      select: {
                        id: true,
                        deliveryNumber: true,
                        status: true,
                        completedAt: true,
                        createdAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 })
    }

    type Milestone = {
      kind: 'QUOTE' | 'ORDER' | 'JOB' | 'DELIVERY'
      id: string
      label: string
      start: Date
      end: Date | null
      status: string
      meta?: Record<string, any>
    }

    const milestones: Milestone[] = []
    for (const q of project.quotes) {
      milestones.push({
        kind: 'QUOTE',
        id: q.id,
        label: q.quoteNumber,
        start: q.createdAt,
        end: q.createdAt,
        status: q.status,
        meta: { total: q.total },
      })
      if (q.order) {
        milestones.push({
          kind: 'ORDER',
          id: q.order.id,
          label: q.order.orderNumber,
          start: q.order.createdAt,
          end: q.order.deliveryDate || null,
          status: q.order.status,
          meta: { total: q.order.total },
        })
        for (const j of q.order.jobs) {
          milestones.push({
            kind: 'JOB',
            id: j.id,
            label: j.jobNumber,
            start: j.createdAt,
            end: j.scheduledDate || j.completedAt || null,
            status: j.status,
            meta: {
              pm: j.assignedPM
                ? `${j.assignedPM.firstName} ${j.assignedPM.lastName}`
                : null,
              scope: j.scopeType,
            },
          })
          for (const d of j.deliveries) {
            milestones.push({
              kind: 'DELIVERY',
              id: d.id,
              label: d.deliveryNumber,
              start: d.createdAt,
              end: d.completedAt || null,
              status: d.status,
            })
          }
        }
      }
    }

    // Determine axis bounds
    const allDates: Date[] = milestones.flatMap((m) => [m.start, m.end].filter((d): d is Date => !!d))
    allDates.push(project.createdAt)
    const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())))
    const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime()), Date.now()))

    // Critical path: latest-finishing chain of JOBs + DELIVERY
    const jobs = milestones.filter((m) => m.kind === 'JOB' || m.kind === 'DELIVERY')
    jobs.sort((a, b) => (b.end?.getTime() || 0) - (a.end?.getTime() || 0))
    const criticalIds = new Set(jobs.slice(0, 3).map((j) => j.id))

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        planName: project.planName,
        lotNumber: project.lotNumber,
        subdivision: project.subdivision,
        builderName: project.builder.companyName,
      },
      axis: {
        start: minDate.toISOString(),
        end: maxDate.toISOString(),
        spanDays: Math.ceil((maxDate.getTime() - minDate.getTime()) / (24 * 60 * 60 * 1000)),
      },
      milestones: milestones.map((m) => ({
        ...m,
        start: m.start.toISOString(),
        end: m.end?.toISOString() ?? null,
        critical: criticalIds.has(m.id),
      })),
    })
  } catch (err: any) {
    console.error('[projects timeline] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
