export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { parseRoles } from '@/lib/permissions'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/jobs/[id]/material-confirm
//
// Body: { note?: string }
//
// The assigned PM (or a MANAGER/ADMIN acting for them) stamps "materials are
// allocated / I know the risks" on a Job. Clears any open MATERIAL_CONFIRM_REQUIRED
// InboxItem for the Job. Audit-logged at WARN severity because it's the human
// accountability point — if material shorts later, we want this stamp in the trail.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const { session } = auth

  const jobId = params.id
  let body: { note?: string } = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }
  const note = (body.note || '').trim().slice(0, 2000) || null

  // Load the Job to check authorization. Only the assigned PM, or
  // MANAGER/ADMIN, can confirm. PROJECT_MANAGER acting on someone else's
  // Job would be a surprise — reject so it's explicit.
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "jobNumber", "assignedPMId", "materialConfirmedAt", "materialEscalatedAt"
       FROM "Job" WHERE "id" = $1`,
    jobId
  )
  if (jobRows.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  const job = jobRows[0]

  const roles = parseRoles(session.roles || session.role)
  const isManagerOrAdmin = roles.includes('ADMIN') || roles.includes('MANAGER')
  const isAssignedPM = job.assignedPMId && job.assignedPMId === session.staffId
  if (!isAssignedPM && !isManagerOrAdmin) {
    return NextResponse.json(
      { error: 'Only the assigned PM or a manager can confirm materials' },
      { status: 403 }
    )
  }

  if (job.materialConfirmedAt) {
    return NextResponse.json(
      { error: 'Materials already confirmed for this job', confirmedAt: job.materialConfirmedAt },
      { status: 409 }
    )
  }

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "Job"
          SET "materialConfirmedAt" = NOW(),
              "materialConfirmedBy" = $2,
              "materialConfirmNote" = $3
        WHERE "id" = $1
          AND "materialConfirmedAt" IS NULL`,
      jobId,
      session.staffId,
      note
    )

    // Resolve any open MATERIAL_CONFIRM_REQUIRED inbox item for this Job.
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
          SET "status" = 'COMPLETED',
              "resolvedAt" = NOW(),
              "resolvedBy" = $2,
              "result" = $3::jsonb,
              "updatedAt" = NOW()
        WHERE "type" = 'MATERIAL_CONFIRM_REQUIRED'
          AND "entityType" = 'Job'
          AND "entityId" = $1
          AND "status" IN ('PENDING', 'SNOOZED')`,
      jobId,
      session.staffId,
      JSON.stringify({
        outcome: 'confirmed_by_pm',
        confirmedBy: session.staffId,
        note,
      })
    )

    // Audit at WARN so it surfaces in the audit-log queue.
    await audit(
      request,
      'MATERIAL_CONFIRM',
      'Job',
      jobId,
      {
        jobNumber: job.jobNumber,
        note,
        actor: session.staffId,
        actorRoles: roles,
      },
      'WARN'
    )

    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber", "materialConfirmedAt", "materialConfirmedBy", "materialConfirmNote"
         FROM "Job" WHERE "id" = $1`,
      jobId
    )
    return NextResponse.json(updated[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
