export const dynamic = 'force-dynamic'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/builder/phase-config — get my phase configuration
export async function GET() {
  try {
    const session = await getSession()
    if (!session || !session.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const builder = await prisma.builder.findUnique({
      where: { id: session.builderId },
      select: { id: true, builderType: true },
    })

    if (!builder) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Check for custom config
    const configs = await prisma.builderPhaseConfig.findMany({
      where: { builderId: session.builderId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        sortOrder: true,
        amountType: true,
        percentage: true,
        fixedAmount: true,
        isRequired: true,
      },
    })

    if (configs.length > 0) {
      return NextResponse.json({ source: 'custom', phases: configs })
    }

    // Fall back to defaults
    const defaults = await prisma.jobPhaseTemplate.findMany({
      where: { builderType: builder.builderType, isDefault: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        sortOrder: true,
        amountType: true,
        percentage: true,
        fixedAmount: true,
        isRequired: true,
      },
    })

    return NextResponse.json({ source: 'defaults', phases: defaults })
  } catch (error) {
    console.error('Failed to get phase config:', error)
    return NextResponse.json({ error: 'Failed to get phase config' }, { status: 500 })
  }
}

// PUT /api/builder/phase-config — customize my phases
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !session.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { phases } = body

    if (!Array.isArray(phases) || phases.length === 0) {
      return NextResponse.json({ error: 'phases array is required' }, { status: 400 })
    }

    // Validate no required phases are being removed
    const existingRequired = await prisma.builderPhaseConfig.findMany({
      where: { builderId: session.builderId, isRequired: true },
      select: { name: true },
    })

    const incomingNames = new Set(phases.map((p: { name: string }) => p.name))
    const missingRequired = existingRequired.filter((r: any) => !incomingNames.has(r.name))

    if (missingRequired.length > 0) {
      return NextResponse.json(
        { error: `Cannot remove required phases: ${missingRequired.map((r: any) => r.name).join(', ')}` },
        { status: 400 }
      )
    }

    // Deactivate all existing, then upsert the new set
    await prisma.builderPhaseConfig.updateMany({
      where: { builderId: session.builderId },
      data: { isActive: false },
    })

    const configs = await prisma.$transaction(
      phases.map((p: { name: string; description?: string; sortOrder?: number; amountType?: string; percentage?: number; fixedAmount?: number }, i: number) =>
        prisma.builderPhaseConfig.upsert({
          where: { builderId_name: { builderId: session.builderId!, name: p.name } },
          create: {
            builderId: session.builderId!,
            name: p.name,
            description: p.description || null,
            sortOrder: p.sortOrder ?? i,
            amountType: (p.amountType as 'PERCENTAGE' | 'FIXED' | 'MILESTONE') || 'MILESTONE',
            percentage: p.amountType === 'PERCENTAGE' ? p.percentage : null,
            fixedAmount: p.amountType === 'FIXED' ? p.fixedAmount : null,
            isActive: true,
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

    return NextResponse.json({ phases: configs })
  } catch (error) {
    console.error('Failed to update phase config:', error)
    return NextResponse.json({ error: 'Failed to update phase config' }, { status: 500 })
  }
}
