// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/hyphen/documents/[id]
//
// Lets an operator manually reassign a HyphenDocument to a specific Job.
// Clears any pending HYPHEN_DOC_UNMATCHED InboxItem once assigned.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = params
  let body: { jobId?: string | null; builderId?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const existing = await (prisma as any).hyphenDocument.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // If assigning a jobId, verify it exists
  if (body.jobId) {
    const job = await prisma.job.findUnique({
      where: { id: body.jobId },
      select: { id: true },
    })
    if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 400 })
  }

  const updated = await (prisma as any).hyphenDocument.update({
    where: { id },
    data: {
      jobId: body.jobId ?? existing.jobId,
      builderId: body.builderId ?? existing.builderId,
      matchConfidence: body.jobId ? 'HIGH' : existing.matchConfidence,
      matchMethod: body.jobId ? 'manual' : existing.matchMethod,
    },
  })

  // Resolve any pending unmatched inbox items for this doc
  if (body.jobId) {
    await prisma.inboxItem.updateMany({
      where: {
        type: 'HYPHEN_DOC_UNMATCHED',
        entityType: 'HyphenDocument',
        entityId: id,
        status: 'PENDING',
      },
      data: {
        status: 'COMPLETED',
        resolvedAt: new Date(),
        result: {
          action: 'manual_assign',
          assignedJobId: body.jobId,
        } as any,
      },
    })
  }

  return NextResponse.json({ status: 'ok', document: updated })
}
