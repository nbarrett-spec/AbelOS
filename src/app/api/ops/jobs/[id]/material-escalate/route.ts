export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { parseRoles } from '@/lib/permissions'
import { sendMaterialEscalationEmail } from '@/lib/email/material-escalation'
import { logger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/jobs/[id]/material-escalate
//
// Body: { reason: string }
//
// PM voluntarily escalates — "I don't have the coverage to confirm, Clint
// needs to see this." Same gatekeeping as confirm (PM of the Job or MANAGER/ADMIN).
// Creates Clint-assigned InboxItem + emails Clint and Nate. Stamps audit.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const { session } = auth

  const jobId = params.id
  let body: { reason?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 })
  }
  const reason = (body.reason || '').trim()
  if (!reason) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 })
  }

  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT j."id", j."jobNumber", j."builderName", j."jobAddress", j."community",
            j."scheduledDate", j."assignedPMId",
            j."materialConfirmedAt", j."materialEscalatedAt",
            j."materialConfirmNote",
            pm."firstName" AS "pmFirstName", pm."lastName" AS "pmLastName"
       FROM "Job" j
       LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
      WHERE j."id" = $1`,
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
      { error: 'Only the assigned PM or a manager can escalate materials' },
      { status: 403 }
    )
  }

  if (job.materialConfirmedAt) {
    return NextResponse.json(
      { error: 'Materials already confirmed — no need to escalate' },
      { status: 409 }
    )
  }
  if (job.materialEscalatedAt) {
    return NextResponse.json(
      { error: 'Materials already escalated', escalatedAt: job.materialEscalatedAt },
      { status: 409 }
    )
  }

  // Find Clint. If he isn't in the DB yet, fail loudly — escalation-to-Clint
  // with no Clint is useless.
  const clintRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "email" FROM "Staff" WHERE LOWER("email") = 'c.vinson@abellumber.com' AND "active" = true LIMIT 1`
  )
  const clintStaffId = clintRows[0]?.id
  const clintEmail = clintRows[0]?.email || 'c.vinson@abellumber.com'
  if (!clintStaffId) {
    return NextResponse.json(
      { error: 'Escalation target (Clint) not found in Staff — cannot escalate' },
      { status: 503 }
    )
  }

  // Append reason to the existing note (don't overwrite — keeps the PM's
  // context intact if they'd written anything pre-escalate).
  const now = new Date()
  const appended =
    (job.materialConfirmNote ? `${job.materialConfirmNote}\n\n` : '') +
    `[${now.toISOString()}] Escalated by ${session.firstName || session.email}: ${reason}`

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "Job"
          SET "materialEscalatedAt" = NOW(),
              "materialEscalatedTo" = $2,
              "materialConfirmNote" = $3
        WHERE "id" = $1
          AND "materialEscalatedAt" IS NULL
          AND "materialConfirmedAt" IS NULL`,
      jobId,
      clintStaffId,
      appended.slice(0, 4000)
    )

    // Create the Clint inbox item. Nate doesn't get his own inbox item — he
    // already has the umbrella admin view — but he gets the email.
    const inboxId = 'ibx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem"
        ("id","type","source","title","description","priority","status",
         "entityType","entityId","assignedTo","dueBy","actionData","createdAt","updatedAt")
       VALUES ($1,'MATERIAL_ESCALATION_CLINT','pm-escalate',$2,$3,'CRITICAL','PENDING',
               'Job',$4,$5,$6,$7::jsonb,NOW(),NOW())`,
      inboxId,
      `ESCALATION: Material confirm — ${job.jobNumber}`,
      `PM escalated: ${reason}`,
      jobId,
      clintStaffId,
      job.scheduledDate,
      JSON.stringify({
        jobId,
        jobNumber: job.jobNumber,
        trigger: 'PM_REQUESTED',
        pmReason: reason,
        escalatedBy: session.staffId,
      })
    )

    // Close any open MATERIAL_CONFIRM_REQUIRED inbox item — the PM's ball is
    // passed.
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
      JSON.stringify({ outcome: 'escalated_by_pm', reason })
    )

    await audit(
      request,
      'MATERIAL_ESCALATE',
      'Job',
      jobId,
      {
        jobNumber: job.jobNumber,
        reason,
        escalatedTo: clintStaffId,
        trigger: 'PM_REQUESTED',
      },
      'WARN'
    )

    // Email Clint + Nate (best-effort; never block the response on email).
    const nateEmail = 'n.barrett@abellumber.com'
    const daysToDelivery = job.scheduledDate
      ? Math.max(0, Math.round((new Date(job.scheduledDate).getTime() - Date.now()) / (86400 * 1000)))
      : 0
    const pmName = [job.pmFirstName, job.pmLastName].filter(Boolean).join(' ') || null

    // Run emails in the background — the response shouldn't wait.
    Promise.all([
      sendMaterialEscalationEmail({
        to: clintEmail,
        recipientFirstName: 'Clint',
        jobId,
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        jobAddress: job.jobAddress,
        community: job.community,
        scheduledDate: new Date(job.scheduledDate),
        daysToDelivery,
        materialStatus: 'UNKNOWN',
        statusReason: 'see Job page',
        escalationReason: reason,
        pmName,
        trigger: 'PM_REQUESTED',
      }),
      sendMaterialEscalationEmail({
        to: nateEmail,
        recipientFirstName: 'Nate',
        jobId,
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        jobAddress: job.jobAddress,
        community: job.community,
        scheduledDate: new Date(job.scheduledDate),
        daysToDelivery,
        materialStatus: 'UNKNOWN',
        statusReason: 'see Job page',
        escalationReason: reason,
        pmName,
        trigger: 'PM_REQUESTED',
      }),
    ]).catch((e) => logger.error('material_escalate_email_failed', e, { jobId }))

    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber", "materialEscalatedAt", "materialEscalatedTo", "materialConfirmNote"
         FROM "Job" WHERE "id" = $1`,
      jobId
    )
    return NextResponse.json(updated[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
