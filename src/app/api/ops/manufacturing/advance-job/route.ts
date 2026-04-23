export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { allocateJobMaterials, releaseJobMaterials } from '@/lib/mrp'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

/**
 * POST /api/ops/manufacturing/advance-job
 *
 * Advance a job through the manufacturing workflow with validation gates.
 * Each status transition has preconditions that MUST be met.
 *
 * Body: { jobId, targetStatus, overrideReason? }
 *
 * Workflow with gates:
 *   CREATED → READINESS_CHECK       : order must exist
 *   READINESS_CHECK → MATERIALS_LOCKED : all picks allocated (no SHORT status)
 *   MATERIALS_LOCKED → IN_PRODUCTION   : all picks in PENDING or better
 *   IN_PRODUCTION → STAGED            : all picks VERIFIED + QC PASS (PRE_PRODUCTION or IN_PROCESS)
 *   STAGED → LOADED                   : QC PASS (PRE_DELIVERY) required
 *   LOADED → IN_TRANSIT               : driver confirmed
 *   IN_TRANSIT → DELIVERED            : delivery confirmed
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { jobId, targetStatus, overrideReason } = body
    const staffId = request.headers.get('x-staff-id') || 'system'
    const staffRole = request.headers.get('x-staff-role') || ''

    if (!jobId || !targetStatus) {
      return NextResponse.json(
        { error: 'jobId and targetStatus are required' },
        { status: 400 }
      )
    }

    // Get current job state
    const jobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j.id, j."jobNumber", j.status::text as status, j."orderId",
        j."readinessCheck", j."materialsLocked", j."loadConfirmed",
        j."pickListGenerated", j."allMaterialsAllocated", j."qcRequired",
        j."assignedPMId"
      FROM "Job" j
      WHERE j.id = $1
    `, jobId)

    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobs[0]
    const currentStatus = job.status

    // Transition validity is enforced by the canonical status guard
    // (src/lib/state-machines.ts is the single source of truth).
    try {
      requireValidTransition('job', currentStatus, targetStatus)
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // ── Validation Gates ───────────────────────────────────────────────
    const gateFailures: string[] = []
    const isAdmin = staffRole === 'ADMIN'
    const canOverride = isAdmin && overrideReason

    // Gate: CREATED → READINESS_CHECK
    if (targetStatus === 'READINESS_CHECK') {
      if (!job.orderId) {
        gateFailures.push('Job must have a linked order before readiness check')
      }
    }

    // Gate: READINESS_CHECK → MATERIALS_LOCKED
    if (targetStatus === 'MATERIALS_LOCKED') {
      if (!job.pickListGenerated) {
        gateFailures.push('Pick list must be generated before locking materials')
      }
      if (!job.allMaterialsAllocated) {
        // Check actual short picks
        const shortPicks: any[] = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int as count FROM "MaterialPick"
          WHERE "jobId" = $1 AND status::text = 'SHORT'
        `, jobId)
        if (shortPicks[0]?.count > 0) {
          gateFailures.push(`${shortPicks[0].count} material pick(s) still SHORT — waiting on inventory`)
        }
      }
    }

    // Gate: MATERIALS_LOCKED → IN_PRODUCTION
    if (targetStatus === 'IN_PRODUCTION') {
      const unreadyPicks: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count FROM "MaterialPick"
        WHERE "jobId" = $1 AND status::text NOT IN ('PENDING', 'PICKING', 'PICKED', 'VERIFIED')
      `, jobId)
      if (unreadyPicks[0]?.count > 0) {
        gateFailures.push(`${unreadyPicks[0].count} pick(s) not ready for production`)
      }
    }

    // Gate: IN_PRODUCTION → STAGED
    if (targetStatus === 'STAGED') {
      // All picks must be VERIFIED
      const unverifiedPicks: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count FROM "MaterialPick"
        WHERE "jobId" = $1 AND status::text != 'VERIFIED'
      `, jobId)
      if (unverifiedPicks[0]?.count > 0) {
        gateFailures.push(`${unverifiedPicks[0].count} pick(s) not yet verified — all must be VERIFIED before staging`)
      }

      // QC check required (FINAL_UNIT or IN_PROCESS)
      if (job.qcRequired) {
        const qcPass: any[] = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int as count FROM "QualityCheck"
          WHERE "jobId" = $1
            AND "checkType"::text IN ('FINAL_UNIT', 'IN_PROCESS')
            AND result::text IN ('PASS', 'CONDITIONAL_PASS')
        `, jobId)
        if (qcPass[0]?.count === 0) {
          gateFailures.push('QC check (FINAL_UNIT or IN_PROCESS) with PASS result required before staging')
        }
      }
    }

    // Gate: STAGED → LOADED
    if (targetStatus === 'LOADED') {
      if (job.qcRequired) {
        const preDeliveryQC: any[] = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int as count FROM "QualityCheck"
          WHERE "jobId" = $1
            AND "checkType"::text = 'PRE_DELIVERY'
            AND result::text IN ('PASS', 'CONDITIONAL_PASS')
        `, jobId)
        if (preDeliveryQC[0]?.count === 0) {
          gateFailures.push('Pre-delivery QC check with PASS result required before loading')
        }
      }
    }

    // ── QC HARD GATE ─────────────────────────────────────────────────
    // Block any transition to a ship/deliver status if the job is in or past
    // IN_PRODUCTION and has NO passing inspection in EITHER inspection store
    // (QualityCheck + Inspection). The pre-ship statuses are LOADED, IN_TRANSIT,
    // DELIVERED. See /api/ops/inspections (raw SQL 'Inspection' table) and
    // QualityCheck (Prisma model) — both are treated as authoritative.
    const preShipTargets = ['LOADED', 'IN_TRANSIT', 'DELIVERED']
    const inProductionOrLater = [
      'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED',
      'INSTALLING', 'PUNCH_LIST',
    ]
    const needsQcGate = preShipTargets.includes(targetStatus) &&
      inProductionOrLater.includes(currentStatus)

    // Also block if any FAIL/FAILED exists without a subsequent PASS — treat
    // an unresolved failing inspection as a hard stop regardless of status.
    const failingInspection = await hasUnresolvedFailingInspection(jobId)

    if (needsQcGate || failingInspection) {
      const qcPassing = await hasPassingInspection(jobId)

      if (!qcPassing || failingInspection) {
        // Admin-with-overrideReason can bypass
        if (!(isAdmin && overrideReason)) {
          return NextResponse.json(
            {
              blocked: true,
              reason: failingInspection ? 'qc_failed_unresolved' : 'qc_required',
              message: failingInspection
                ? 'Job has an unresolved failing QC inspection — resolve before advancing'
                : 'Job cannot advance past IN_PRODUCTION without a passing QC inspection',
              currentStatus,
              targetStatus,
              hint: 'ADMIN can override by passing overrideReason in the request body',
            },
            { status: 409 }
          )
        }

        // ADMIN override — audit CRITICAL
        await audit(
          request,
          'QC_GATE_OVERRIDDEN',
          'Job',
          jobId,
          {
            jobNumber: job.jobNumber,
            from: currentStatus,
            to: targetStatus,
            overrideReason,
            reason: failingInspection ? 'qc_failed_unresolved' : 'qc_required',
          },
          'CRITICAL'
        )
      }
    }

    // If gates failed and no admin override
    if (gateFailures.length > 0 && !canOverride) {
      return NextResponse.json({
        error: 'Validation gate(s) failed',
        gateFailures,
        hint: 'Admin users can override with overrideReason parameter',
      }, { status: 400 })
    }

    // ── Perform the transition ─────────────────────────────────────────
    const updateFields: string[] = [`status = '${targetStatus}'::"JobStatus"`, `"updatedAt" = NOW()`]

    if (targetStatus === 'READINESS_CHECK') updateFields.push(`"readinessCheck" = true`)
    if (targetStatus === 'MATERIALS_LOCKED') updateFields.push(`"materialsLocked" = true`)
    if (targetStatus === 'LOADED') updateFields.push(`"loadConfirmed" = true`)
    if (targetStatus === 'COMPLETE') updateFields.push(`"completedAt" = NOW()`)
    if (targetStatus === 'DELIVERED') updateFields.push(`"actualDate" = NOW()`)

    await prisma.$executeRawUnsafe(`
      UPDATE "Job" SET ${updateFields.join(', ')} WHERE id = $1
    `, jobId)

    // ── MRP: allocate / release inventory commitments based on transition ──
    try {
      if (targetStatus === 'MATERIALS_LOCKED') {
        await allocateJobMaterials(jobId)
      } else if (
        ['DELIVERED', 'COMPLETE', 'CLOSED'].includes(targetStatus)
      ) {
        await releaseJobMaterials(jobId)
      }
    } catch (mrpErr: any) {
      console.warn('[advance-job] MRP allocation hook failed:', mrpErr?.message)
    }

    // Create decision note for the transition
    await prisma.$executeRawUnsafe(`
      INSERT INTO "DecisionNote"
      (id, "jobId", "authorId", "noteType", subject, body, priority, "createdAt")
      VALUES (
        gen_random_uuid()::text, $1, $2,
        'GENERAL'::"DecisionNoteType",
        $3, $4, 'NORMAL'::"NotePriority", NOW()
      )
    `,
      jobId, staffId,
      `Status → ${targetStatus}`,
      canOverride
        ? `Job advanced from ${currentStatus} to ${targetStatus} (ADMIN OVERRIDE: ${overrideReason}). Gate failures: ${gateFailures.join('; ')}`
        : `Job advanced from ${currentStatus} to ${targetStatus}. All validation gates passed.`
    )

    // Notify PM of status change
    if (job.assignedPMId && job.assignedPMId !== staffId) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Notification" (id, "staffId", type, title, body, link, read, "createdAt")
        VALUES (gen_random_uuid()::text, $1, 'JOB_UPDATE'::"NotificationType", $2, $3, $4, false, NOW())
      `,
        job.assignedPMId,
        `${job.jobNumber} → ${targetStatus}`,
        `Job ${job.jobNumber} has been advanced to ${targetStatus.replace(/_/g, ' ')}.`,
        `/ops/jobs/${jobId}`
      )
    }

    return NextResponse.json({
      success: true,
      jobNumber: job.jobNumber,
      previousStatus: currentStatus,
      newStatus: targetStatus,
      gatesOverridden: canOverride ? gateFailures : [],
      gatesPassed: gateFailures.length === 0,
    })
  } catch (error: any) {
    console.error('[Advance Job] Error:', error)
    return NextResponse.json(
      { error: 'Failed to advance job'},
      { status: 500 }
    )
  }
}

// ── QC inspection helpers ────────────────────────────────────────────
// Two stores exist: QualityCheck (Prisma) and Inspection (raw SQL via
// /api/ops/inspections). Either is accepted as authoritative evidence.

async function hasPassingInspection(jobId: string): Promise<boolean> {
  try {
    const qc: any[] = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "QualityCheck"
       WHERE "jobId" = $1
         AND result::text IN ('PASS', 'CONDITIONAL_PASS')
       LIMIT 1`,
      jobId
    )
    if (qc.length > 0) return true
  } catch {
    // QualityCheck optional — continue
  }
  try {
    const insp: any[] = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "Inspection"
       WHERE "jobId" = $1
         AND "status" IN ('PASS', 'PASS_WITH_NOTES', 'PASSED')
       LIMIT 1`,
      jobId
    )
    if (insp.length > 0) return true
  } catch {
    // Inspection table may not exist in dev
  }
  return false
}

async function hasUnresolvedFailingInspection(jobId: string): Promise<boolean> {
  // A FAIL is "unresolved" if there is no later PASS record on the same job.
  try {
    const qc: any[] = await prisma.$queryRawUnsafe(
      `SELECT "createdAt" FROM "QualityCheck"
       WHERE "jobId" = $1 AND result::text = 'FAIL'
       ORDER BY "createdAt" DESC LIMIT 1`,
      jobId
    )
    if (qc.length > 0) {
      const failAt: Date = qc[0].createdAt
      const laterPass: any[] = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "QualityCheck"
         WHERE "jobId" = $1
           AND result::text IN ('PASS', 'CONDITIONAL_PASS')
           AND "createdAt" > $2
         LIMIT 1`,
        jobId, failAt
      )
      if (laterPass.length === 0) return true
    }
  } catch { /* ignore */ }

  try {
    const insp: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE("completedDate", "updatedAt", "createdAt") AS at
       FROM "Inspection"
       WHERE "jobId" = $1 AND "status" IN ('FAIL', 'FAILED')
       ORDER BY at DESC LIMIT 1`,
      jobId
    )
    if (insp.length > 0) {
      const failAt: Date = insp[0].at
      const laterPass: any[] = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "Inspection"
         WHERE "jobId" = $1
           AND "status" IN ('PASS', 'PASS_WITH_NOTES', 'PASSED')
           AND COALESCE("completedDate", "updatedAt", "createdAt") > $2
         LIMIT 1`,
        jobId, failAt
      )
      if (laterPass.length === 0) return true
    }
  } catch { /* ignore */ }

  return false
}
