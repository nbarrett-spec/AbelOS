export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// Job Profile API — deep data fetch for the comprehensive job profile view
//
// Returns: job details, order, builder, community, phases, deliveries,
// invoices, activities, tasks, installations, quality checks, material picks,
// blueprints (via project), comm logs, change orders, decision notes
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Core job with all relations
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        order: {
          include: {
            builder: {
              select: {
                id: true,
                companyName: true,
                contactName: true,
                email: true,
                phone: true,
                builderType: true,
                paymentTerm: true,
                creditLimit: true,
                accountBalance: true,
                status: true,
              },
            },
            items: {
              include: {
                product: {
                  select: { id: true, sku: true, name: true, category: true },
                },
              },
            },
          },
        },
        assignedPM: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true },
        },
        phases: {
          orderBy: { sortOrder: 'asc' },
        },
        deliveries: {
          include: {
            crew: {
              include: {
                members: {
                  include: { staff: { select: { firstName: true, lastName: true } } },
                },
              },
            },
            tracking: { orderBy: { timestamp: 'desc' }, take: 5 },
          },
          orderBy: { createdAt: 'desc' },
        },
        installations: {
          orderBy: { createdAt: 'desc' },
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        materialPicks: {
          orderBy: { createdAt: 'desc' },
        },
        qualityChecks: {
          orderBy: { createdAt: 'desc' },
        },
        scheduleEntries: {
          orderBy: { date: 'asc' },
        },
        decisionNotes: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Fetch invoices linked to this job
    const invoices: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(`
      SELECT i.*,
        (SELECT COUNT(*) FROM "Payment" p WHERE p."invoiceId" = i."id") as "paymentCount"
      FROM "Invoice" i
      WHERE i."jobId" = $1 OR i."orderId" = $2
      ORDER BY i."createdAt" DESC
    `, params.id, job.orderId || '')

    // Fetch comm log entries for this builder
    let commLogs: Array<Record<string, unknown>> = []
    if (job.order?.builder?.id) {
      commLogs = await prisma.$queryRawUnsafe(`
        SELECT cl.*,
          s."firstName" as "staffFirstName",
          s."lastName" as "staffLastName"
        FROM "CommunicationLog" cl
        LEFT JOIN "Staff" s ON s."id" = cl."staffId"
        WHERE cl."builderId" = $1
        ORDER BY cl."createdAt" DESC
        LIMIT 20
      `, job.order.builder.id)
    }

    // Fetch change orders for this job
    let changeOrders: Array<Record<string, unknown>> = []
    try {
      changeOrders = await prisma.$queryRawUnsafe(`
        SELECT * FROM "ChangeOrder"
        WHERE "jobId" = $1
        ORDER BY "createdAt" DESC
      `, params.id)
    } catch { /* table may not exist */ }

    // Fetch blueprints if this job has a project
    let blueprints: Array<Record<string, unknown>> = []
    if (job.order) {
      try {
        blueprints = await prisma.$queryRawUnsafe(`
          SELECT b.*,
            (SELECT COUNT(*) FROM "Takeoff" t WHERE t."blueprintId" = b."id") as "takeoffCount"
          FROM "Blueprint" b
          JOIN "Project" p ON p."id" = b."projectId"
          JOIN "Order" o ON o."quoteId" = (SELECT q."id" FROM "Quote" q JOIN "Takeoff" tk ON tk."id" = q."takeoffId" WHERE tk."projectId" = p."id" LIMIT 1)
          WHERE o."id" = $1
          ORDER BY b."createdAt" DESC
        `, job.orderId || '')
      } catch { /* complex join may fail if no project chain */ }
    }

    // Fetch community data if production builder
    let community = null
    if (job.communityId) {
      community = await prisma.community.findUnique({
        where: { id: job.communityId },
        include: {
          contacts: true,
          floorPlans: { where: { active: true }, orderBy: { name: 'asc' } },
        },
      })
    }

    // Phase summary
    const phaseSummary = {
      totalPhases: job.phases.length,
      completedPhases: job.phases.filter((p: any) => ['INVOICED', 'PAID'].includes(p.status)).length,
      activePhase: job.phases.find((p: any) => p.status === 'ACTIVE')?.name || null,
      totalExpected: job.phases.reduce((sum: any, p: any) => sum + (p.expectedAmount || 0), 0),
      totalInvoiced: job.phases.reduce((sum: any, p: any) => sum + (p.actualAmount || 0), 0),
    }

    return NextResponse.json({
      job,
      invoices,
      commLogs,
      changeOrders,
      blueprints,
      community,
      phaseSummary,
    })
  } catch (error) {
    console.error('Failed to load job profile:', error)
    return NextResponse.json({ error: 'Failed to load job profile' }, { status: 500 })
  }
}
