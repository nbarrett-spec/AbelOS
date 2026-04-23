export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/portal/installer/jobs/[jobId]/escalate
// Body: { reason: string, severity?: 'HIGH'|'CRITICAL' }
// Creates an InboxItem tagged to the Job's assigned PM so they see it
// immediately, plus a DecisionNote[ESCALATION] on the Job timeline.
// ──────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const staffId = request.headers.get('x-staff-id') || 'system'

  let body: { reason?: string; severity?: string } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'Reason is required' }, { status: 400 })
  }
  const severity = body.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH'

  try {
    const jobRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber", "builderName", "community", "assignedPMId"
       FROM "Job" WHERE "id" = $1`,
      jobId,
    )
    if (jobRows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const job = jobRows[0]

    // Insert InboxItem targeted to the assigned PM (or unassigned inbox if none)
    const inboxId = 'ibx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem"
        ("id","type","source","title","description","priority","status",
         "entityType","entityId","assignedTo","actionData","createdAt","updatedAt")
       VALUES ($1,'ESCALATION','installer-portal',$2,$3,$4,'PENDING','Job',$5,$6,$7::jsonb,NOW(),NOW())`,
      inboxId,
      `Install escalation — Job ${job.jobNumber || job.id}`,
      `${job.builderName || ''} · ${job.community || ''}\n\n${reason}`,
      severity,
      jobId,
      job.assignedPMId || null,
      JSON.stringify({
        raisedBy: staffId,
        jobNumber: job.jobNumber,
        reason,
      }),
    )

    // Also record an ESCALATION decision note so the Job timeline shows it
    try {
      const noteId = 'dn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DecisionNote" ("id","jobId","authorId","noteType","subject","body","priority","createdAt")
         VALUES ($1,$2,$3,'ESCALATION'::"DecisionNoteType",$4,$5,$6::"NotePriority",NOW())`,
        noteId, jobId, staffId,
        'Install escalation raised',
        reason,
        severity === 'CRITICAL' ? 'URGENT' : 'HIGH',
      )
    } catch (e: any) {
      console.warn('[installer/escalate] decision note insert failed:', e?.message)
    }

    await audit(request, 'INSTALL_ESCALATE', 'Job', jobId, {
      severity,
      assignedTo: job.assignedPMId,
      inboxId,
    }, 'WARN')

    return NextResponse.json({ ok: true, inboxId, assignedTo: job.assignedPMId })
  } catch (error: any) {
    console.error('[installer/escalate] error:', error?.message)
    return NextResponse.json({ error: 'Failed to escalate' }, { status: 500 })
  }
}
