export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/builders/[id]/phase-config — get a builder's phase configuration
// Returns their custom config if it exists, otherwise the defaults for their builder type
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const builder = await prisma.builder.findUnique({
      where: { id: params.id },
      select: { id: true, companyName: true, builderType: true },
    })

    if (!builder) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Check for custom config
    const configs = await prisma.builderPhaseConfig.findMany({
      where: { builderId: params.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { template: { select: { id: true, name: true } } },
    })

    if (configs.length > 0) {
      return NextResponse.json({
        builder: { id: builder.id, companyName: builder.companyName, builderType: builder.builderType },
        source: 'custom',
        phases: configs,
      })
    }

    // Fall back to defaults for their builder type
    const defaults = await prisma.jobPhaseTemplate.findMany({
      where: { builderType: builder.builderType, isDefault: true },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      builder: { id: builder.id, companyName: builder.companyName, builderType: builder.builderType },
      source: 'defaults',
      phases: defaults,
    })
  } catch (error) {
    console.error('Failed to get builder phase config:', error)
    return NextResponse.json({ error: 'Failed to get phase config' }, { status: 500 })
  }
}

// POST /api/ops/builders/[id]/phase-config — initialize custom config for a builder
// Copies defaults from their builder type templates, or accepts a custom list
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const builder = await prisma.builder.findUnique({
      where: { id: params.id },
      select: { id: true, builderType: true },
    })

    if (!builder) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const body = await request.json()
    const { phases, fromDefaults } = body

    // Option 1: Copy from defaults
    if (fromDefaults) {
      const templates = await prisma.jobPhaseTemplate.findMany({
        where: { builderType: builder.builderType, isDefault: true },
        orderBy: { sortOrder: 'asc' },
      })

      const configs = await prisma.$transaction(
        templates.map((t) =>
          prisma.builderPhaseConfig.upsert({
            where: { builderId_name: { builderId: params.id, name: t.name } },
            create: {
              builderId: params.id,
              templateId: t.id,
              name: t.name,
              description: t.description,
              sortOrder: t.sortOrder,
              amountType: t.amountType,
              percentage: t.percentage,
              fixedAmount: t.fixedAmount,
              isRequired: t.isRequired,
            },
            update: {
              templateId: t.id,
              sortOrder: t.sortOrder,
              amountType: t.amountType,
              percentage: t.percentage,
              fixedAmount: t.fixedAmount,
              isActive: true,
            },
          })
        )
      )

      await audit(request, 'BUILDER_PHASE_CONFIG_INIT', 'Builder', params.id, { source: 'defaults', count: configs.length })

      return NextResponse.json({ configs }, { status: 201 })
    }

    // Option 2: Custom phases provided
    if (Array.isArray(phases) && phases.length > 0) {
      const configs = await prisma.$transaction(
        phases.map((p: { name: string; description?: string; sortOrder?: number; amountType?: string; percentage?: number; fixedAmount?: number; isRequired?: boolean }, i: number) =>
          prisma.builderPhaseConfig.upsert({
            where: { builderId_name: { builderId: params.id, name: p.name } },
            create: {
              builderId: params.id,
              name: p.name,
              description: p.description || null,
              sortOrder: p.sortOrder ?? i,
              amountType: (p.amountType as 'PERCENTAGE' | 'FIXED' | 'MILESTONE') || 'MILESTONE',
              percentage: p.amountType === 'PERCENTAGE' ? p.percentage : null,
              fixedAmount: p.amountType === 'FIXED' ? p.fixedAmount : null,
              isRequired: p.isRequired ?? false,
            },
            update: {
              description: p.description || null,
              sortOrder: p.sortOrder ?? i,
              amountType: (p.amountType as 'PERCENTAGE' | 'FIXED' | 'MILESTONE') || 'MILESTONE',
              percentage: p.amountType === 'PERCENTAGE' ? p.percentage : null,
              fixedAmount: p.amountType === 'FIXED' ? p.fixedAmount : null,
              isActive: true,
            },
          })
        )
      )

      await audit(request, 'BUILDER_PHASE_CONFIG_SET', 'Builder', params.id, { source: 'custom', count: configs.length })

      return NextResponse.json({ configs }, { status: 201 })
    }

    return NextResponse.json({ error: 'Provide { fromDefaults: true } or { phases: [...] }' }, { status: 400 })
  } catch (error) {
    console.error('Failed to set builder phase config:', error)
    return NextResponse.json({ error: 'Failed to set phase config' }, { status: 500 })
  }
}
