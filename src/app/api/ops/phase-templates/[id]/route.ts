export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/phase-templates/[id]
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const template = await prisma.jobPhaseTemplate.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { builderConfigs: true, jobPhases: true } },
      },
    })

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ template })
  } catch (error) {
    console.error('Failed to get phase template:', error)
    return NextResponse.json({ error: 'Failed to get template' }, { status: 500 })
  }
}

// PUT /api/ops/phase-templates/[id]
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const existing = await prisma.jobPhaseTemplate.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, description, sortOrder, amountType, percentage, fixedAmount, isDefault, isRequired } = body

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (description !== undefined) data.description = description
    if (sortOrder !== undefined) data.sortOrder = sortOrder
    if (isDefault !== undefined) data.isDefault = isDefault
    if (isRequired !== undefined) data.isRequired = isRequired

    if (amountType !== undefined) {
      data.amountType = amountType
      data.percentage = amountType === 'PERCENTAGE' ? (percentage ?? existing.percentage) : null
      data.fixedAmount = amountType === 'FIXED' ? (fixedAmount ?? existing.fixedAmount) : null
    } else {
      if (percentage !== undefined) data.percentage = percentage
      if (fixedAmount !== undefined) data.fixedAmount = fixedAmount
    }

    const template = await prisma.jobPhaseTemplate.update({
      where: { id: params.id },
      data,
    })

    await audit(request, 'PHASE_TEMPLATE_UPDATED', 'JobPhaseTemplate', template.id, { before: existing, after: template })

    return NextResponse.json({ template })
  } catch (error) {
    console.error('Failed to update phase template:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE /api/ops/phase-templates/[id]
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const existing = await prisma.jobPhaseTemplate.findUnique({
      where: { id: params.id },
      include: { _count: { select: { jobPhases: true } } },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    if (existing._count.jobPhases > 0) {
      return NextResponse.json(
        { error: `Cannot delete template — it is referenced by ${existing._count.jobPhases} active job phases. Deactivate it instead.` },
        { status: 409 }
      )
    }

    await prisma.jobPhaseTemplate.delete({ where: { id: params.id } })

    await audit(request, 'PHASE_TEMPLATE_DELETED', 'JobPhaseTemplate', params.id, { deleted: existing })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete phase template:', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
