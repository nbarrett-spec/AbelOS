export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/phase-templates — list all templates, optionally filtered by builderType
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const builderType = request.nextUrl.searchParams.get('builderType')

    const where: Record<string, unknown> = {}
    if (builderType === 'PRODUCTION' || builderType === 'CUSTOM') {
      where.builderType = builderType
    }

    const templates = await prisma.jobPhaseTemplate.findMany({
      where,
      orderBy: [{ builderType: 'asc' }, { sortOrder: 'asc' }],
    })

    return NextResponse.json({ templates })
  } catch (error) {
    console.error('Failed to list phase templates:', error)
    return NextResponse.json({ error: 'Failed to list templates' }, { status: 500 })
  }
}

// POST /api/ops/phase-templates — create a new template
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, description, builderType, sortOrder, amountType, percentage, fixedAmount, isDefault, isRequired } = body

    if (!name || !builderType) {
      return NextResponse.json({ error: 'name and builderType are required' }, { status: 400 })
    }

    if (builderType !== 'PRODUCTION' && builderType !== 'CUSTOM') {
      return NextResponse.json({ error: 'builderType must be PRODUCTION or CUSTOM' }, { status: 400 })
    }

    if (amountType === 'PERCENTAGE' && (percentage == null || percentage <= 0 || percentage > 100)) {
      return NextResponse.json({ error: 'percentage must be between 0 and 100' }, { status: 400 })
    }

    if (amountType === 'FIXED' && (fixedAmount == null || fixedAmount <= 0)) {
      return NextResponse.json({ error: 'fixedAmount must be a positive number' }, { status: 400 })
    }

    const staffId = request.headers.get('x-staff-id')

    const template = await prisma.jobPhaseTemplate.create({
      data: {
        name,
        description: description || null,
        builderType,
        sortOrder: sortOrder ?? 0,
        amountType: amountType || 'MILESTONE',
        percentage: amountType === 'PERCENTAGE' ? percentage : null,
        fixedAmount: amountType === 'FIXED' ? fixedAmount : null,
        isDefault: isDefault ?? true,
        isRequired: isRequired ?? false,
        createdById: staffId,
      },
    })

    await audit(request, 'PHASE_TEMPLATE_CREATED', 'JobPhaseTemplate', template.id, { template })

    return NextResponse.json({ template }, { status: 201 })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A template with this name already exists for this builder type' }, { status: 409 })
    }
    console.error('Failed to create phase template:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
