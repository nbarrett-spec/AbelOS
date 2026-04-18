export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/jobs/[id]/phases — list all phases for a job
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      select: { id: true, jobNumber: true, builderName: true },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const phases = await prisma.jobPhase.findMany({
      where: { jobId: params.id },
      orderBy: { sortOrder: 'asc' },
    })

    // Calculate totals
    const totalExpected = phases.reduce((sum: any, p: any) => sum + (p.expectedAmount || 0), 0)
    const totalActual = phases.reduce((sum: any, p: any) => sum + (p.actualAmount || 0), 0)
    const completedCount = phases.filter((p: any) => ['INVOICED', 'PAID'].includes(p.status)).length

    return NextResponse.json({
      job: { id: job.id, jobNumber: job.jobNumber, builderName: job.builderName },
      phases,
      summary: {
        totalPhases: phases.length,
        completedPhases: completedCount,
        totalExpected,
        totalActual,
        percentComplete: phases.length > 0 ? Math.round((completedCount / phases.length) * 100) : 0,
      },
    })
  } catch (error) {
    console.error('Failed to list job phases:', error)
    return NextResponse.json({ error: 'Failed to list phases' }, { status: 500 })
  }
}

// POST /api/ops/jobs/[id]/phases — initialize phases on a job from builder's config or defaults
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        order: { select: { builderId: true, total: true } },
        phases: { select: { id: true } },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.phases.length > 0) {
      return NextResponse.json({ error: 'Job already has phases initialized. Delete existing phases first.' }, { status: 409 })
    }

    const body = await request.json()
    const { jobTotal } = body // Optional: override for resolving percentages

    const builderId = job.order?.builderId
    const total = jobTotal ?? job.order?.total ?? 0

    // Try builder-specific config first, then defaults
    let phaseSource: Array<{
      templateId?: string | null
      configId?: string | null
      name: string
      sortOrder: number
      amountType: string
      percentage: number | null
      fixedAmount: number | null
    }> = []

    if (builderId) {
      const configs = await prisma.builderPhaseConfig.findMany({
        where: { builderId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      })

      if (configs.length > 0) {
        phaseSource = configs.map((c: any) => ({
          templateId: c.templateId,
          configId: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          amountType: c.amountType,
          percentage: c.percentage,
          fixedAmount: c.fixedAmount,
        }))
      }
    }

    // Fall back to type-based defaults
    if (phaseSource.length === 0) {
      // Determine builder type
      let builderType: 'PRODUCTION' | 'CUSTOM' = 'CUSTOM'
      if (builderId) {
        const builder = await prisma.builder.findUnique({
          where: { id: builderId },
          select: { builderType: true },
        })
        if (builder) builderType = builder.builderType
      }

      const templates = await prisma.jobPhaseTemplate.findMany({
        where: { builderType, isDefault: true },
        orderBy: { sortOrder: 'asc' },
      })

      phaseSource = templates.map((t: any) => ({
        templateId: t.id,
        configId: null,
        name: t.name,
        sortOrder: t.sortOrder,
        amountType: t.amountType,
        percentage: t.percentage,
        fixedAmount: t.fixedAmount,
      }))
    }

    if (phaseSource.length === 0) {
      return NextResponse.json({ error: 'No phase templates found. Create templates first.' }, { status: 400 })
    }

    // Create phase instances, resolving amounts
    const phases = await prisma.$transaction(
      phaseSource.map((p) => {
        let expectedAmount: number | null = null
        if (p.amountType === 'PERCENTAGE' && p.percentage != null && total > 0) {
          expectedAmount = Math.round((p.percentage / 100) * total * 100) / 100
        } else if (p.amountType === 'FIXED' && p.fixedAmount != null) {
          expectedAmount = p.fixedAmount
        }

        return prisma.jobPhase.create({
          data: {
            jobId: params.id,
            templateId: p.templateId || null,
            configId: p.configId || null,
            name: p.name,
            sortOrder: p.sortOrder,
            amountType: p.amountType as 'PERCENTAGE' | 'FIXED' | 'MILESTONE',
            percentage: p.percentage,
            expectedAmount,
          },
        })
      })
    )

    await audit(request, 'JOB_PHASES_INITIALIZED', 'Job', params.id, {
      phaseCount: phases.length,
      jobTotal: total,
      phases: phases.map((p: any) => ({ name: p.name, expectedAmount: p.expectedAmount })),
    })

    return NextResponse.json({ phases }, { status: 201 })
  } catch (error) {
    console.error('Failed to initialize job phases:', error)
    return NextResponse.json({ error: 'Failed to initialize phases' }, { status: 500 })
  }
}
