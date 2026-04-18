export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

type PhaseStatusType = 'PENDING' | 'ACTIVE' | 'READY' | 'INVOICED' | 'PAID' | 'SKIPPED'

const VALID_TRANSITIONS: Record<string, PhaseStatusType[]> = {
  PENDING: ['ACTIVE', 'SKIPPED'],
  ACTIVE: ['READY', 'SKIPPED'],
  READY: ['INVOICED', 'ACTIVE'], // Can go back to ACTIVE if invoice cancelled
  INVOICED: ['PAID', 'READY'],   // Can revert if invoice voided
  PAID: [],                       // Terminal
  SKIPPED: ['PENDING'],           // Can un-skip
}

// GET /api/ops/jobs/[id]/phases/[phaseId]
export async function GET(request: NextRequest, { params }: { params: { id: string; phaseId: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const phase = await prisma.jobPhase.findFirst({
      where: { id: params.phaseId, jobId: params.id },
    })

    if (!phase) {
      return NextResponse.json({ error: 'Phase not found' }, { status: 404 })
    }

    return NextResponse.json({ phase })
  } catch (error) {
    console.error('Failed to get job phase:', error)
    return NextResponse.json({ error: 'Failed to get phase' }, { status: 500 })
  }
}

// PATCH /api/ops/jobs/[id]/phases/[phaseId] — update phase status, amount, notes
export async function PATCH(request: NextRequest, { params }: { params: { id: string; phaseId: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const phase = await prisma.jobPhase.findFirst({
      where: { id: params.phaseId, jobId: params.id },
    })

    if (!phase) {
      return NextResponse.json({ error: 'Phase not found' }, { status: 404 })
    }

    const body = await request.json()
    const { status, notes, expectedAmount, actualAmount, invoiceId } = body
    const staffId = request.headers.get('x-staff-id')

    const data: Record<string, unknown> = {}

    // Status transition validation
    if (status && status !== phase.status) {
      const allowed = VALID_TRANSITIONS[phase.status] || []
      if (!allowed.includes(status as PhaseStatusType)) {
        return NextResponse.json(
          { error: `Cannot transition from ${phase.status} to ${status}. Allowed: ${allowed.join(', ') || 'none (terminal)'}` },
          { status: 400 }
        )
      }

      data.status = status

      // Set timestamps based on transition
      if (status === 'ACTIVE' && !phase.startedAt) {
        data.startedAt = new Date()
      }
      if (status === 'READY') {
        data.completedAt = new Date()
      }
      if (status === 'INVOICED') {
        data.invoicedAt = new Date()
      }
      if (status === 'SKIPPED') {
        data.skippedAt = new Date()
        data.skippedBy = staffId
      }
      if (status === 'PENDING') {
        // Un-skip: clear skip fields
        data.skippedAt = null
        data.skippedBy = null
      }
    }

    if (notes !== undefined) data.notes = notes
    if (expectedAmount !== undefined) data.expectedAmount = expectedAmount
    if (actualAmount !== undefined) data.actualAmount = actualAmount
    if (invoiceId !== undefined) data.invoiceId = invoiceId

    const updated = await prisma.jobPhase.update({
      where: { id: params.phaseId },
      data,
    })

    await audit(request, 'JOB_PHASE_UPDATED', 'JobPhase', params.phaseId, { before: phase, after: updated })

    return NextResponse.json({ phase: updated })
  } catch (error) {
    console.error('Failed to update job phase:', error)
    return NextResponse.json({ error: 'Failed to update phase' }, { status: 500 })
  }
}

// DELETE /api/ops/jobs/[id]/phases/[phaseId]
export async function DELETE(request: NextRequest, { params }: { params: { id: string; phaseId: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const phase = await prisma.jobPhase.findFirst({
      where: { id: params.phaseId, jobId: params.id },
    })

    if (!phase) {
      return NextResponse.json({ error: 'Phase not found' }, { status: 404 })
    }

    if (phase.status === 'INVOICED' || phase.status === 'PAID') {
      return NextResponse.json(
        { error: 'Cannot delete a phase that has been invoiced or paid' },
        { status: 400 }
      )
    }

    await prisma.jobPhase.delete({ where: { id: params.phaseId } })

    await audit(request, 'JOB_PHASE_DELETED', 'JobPhase', params.phaseId, { deleted: phase })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete job phase:', error)
    return NextResponse.json({ error: 'Failed to delete phase' }, { status: 500 })
  }
}
