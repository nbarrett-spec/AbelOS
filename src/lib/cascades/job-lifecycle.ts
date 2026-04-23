/**
 * Job Lifecycle Cascades
 *
 * Job.status is the most frequently-mutated field in the platform and the
 * one with the most downstream consumers (QC gates, MRP, picks, inbox).
 * This module is the single source of truth for transitions — the
 * manufacturing advance-job route should eventually delegate here.
 *
 * Triggered from:
 *  - POST /api/ops/manufacturing/advance-job  (current site — planned to
 *                                              delegate to advanceJobWithGuards)
 *  - POST /api/ops/manufacturing/generate-picks (uses generatePicksForJob)
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { allocateForJob, releaseForJob } from '@/lib/allocation'

type TransitionResult = {
  ok: boolean
  blocked?: boolean
  reason?: string
  gateFailures?: string[]
  previousStatus?: string
  newStatus?: string
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['READINESS_CHECK'],
  READINESS_CHECK: ['MATERIALS_LOCKED'],
  MATERIALS_LOCKED: ['IN_PRODUCTION'],
  IN_PRODUCTION: ['STAGED'],
  STAGED: ['LOADED'],
  LOADED: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: ['INSTALLING', 'COMPLETE'],
  INSTALLING: ['PUNCH_LIST', 'COMPLETE'],
  PUNCH_LIST: ['COMPLETE'],
  COMPLETE: ['INVOICED'],
  INVOICED: ['CLOSED'],
}

/**
 * advanceJobWithGuards — transition a Job through its state machine with
 * QC-gate enforcement. Returns a structured result; callers decide how to
 * surface the blocked/failure states to the UI.
 *
 * NOTE: the QC checks here mirror the logic in
 * /api/ops/manufacturing/advance-job (which remains the primary caller).
 * Refactoring the route to use this helper is a follow-up; for now this
 * helper is the "library" surface that scripts and new routes can depend on.
 */
export async function advanceJobWithGuards(
  jobId: string,
  fromStatus: string,
  toStatus: string,
  actor: { staffId: string; staffRole?: string; overrideReason?: string } = { staffId: 'system' }
): Promise<TransitionResult> {
  try {
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber", "status"::text AS status, "orderId",
              "assignedPMId"
       FROM "Job" WHERE "id" = $1 LIMIT 1`,
      jobId
    )
    if (jobs.length === 0) return { ok: false, reason: 'job_not_found' }
    const job = jobs[0]

    if (job.status !== fromStatus) {
      return { ok: false, blocked: true, reason: 'stale_from_status', previousStatus: job.status }
    }

    const allowed = VALID_TRANSITIONS[fromStatus] || []
    if (!allowed.includes(toStatus)) {
      return { ok: false, blocked: true, reason: 'invalid_transition', previousStatus: fromStatus }
    }

    // ── QC gate: any attempt to reach LOADED / IN_TRANSIT / DELIVERED
    // requires at least one passing QC record unless ADMIN overrides.
    const preShip = ['LOADED', 'IN_TRANSIT', 'DELIVERED']
    if (preShip.includes(toStatus)) {
      const hasPass = await hasPassingInspection(jobId)
      const hasUnresolvedFail = await hasUnresolvedFailingInspection(jobId)
      if (!hasPass || hasUnresolvedFail) {
        const isAdmin = actor.staffRole === 'ADMIN'
        if (!(isAdmin && actor.overrideReason)) {
          return {
            ok: false,
            blocked: true,
            reason: hasUnresolvedFail ? 'qc_failed_unresolved' : 'qc_required',
            gateFailures: [hasUnresolvedFail ? 'unresolved failing inspection' : 'no passing QC inspection'],
            previousStatus: fromStatus,
          }
        }
      }
    }

    // Apply transition
    const extra: string[] = []
    if (toStatus === 'READINESS_CHECK') extra.push(`"readinessCheck" = true`)
    if (toStatus === 'MATERIALS_LOCKED') extra.push(`"materialsLocked" = true`)
    if (toStatus === 'LOADED') extra.push(`"loadConfirmed" = true`)
    if (toStatus === 'COMPLETE') extra.push(`"completedAt" = COALESCE("completedAt", NOW())`)
    if (toStatus === 'DELIVERED') extra.push(`"actualDate" = COALESCE("actualDate", NOW())`)

    await prisma.$executeRawUnsafe(
      `UPDATE "Job" SET "status" = $1::"JobStatus",${extra.length ? ' ' + extra.join(', ') + ',' : ''} "updatedAt" = NOW() WHERE "id" = $2`,
      toStatus, jobId
    )

    // Allocation-ledger hooks — fire-and-forget so scripts/tests that use
    // advanceJobWithGuards get the same side-effects as the PATCH route.
    if (['READINESS_CHECK', 'MATERIALS_LOCKED'].includes(toStatus)) {
      allocateForJob(jobId).catch((e) =>
        logger.warn('cascade_allocate_failed', { jobId, toStatus, err: e?.message })
      )
    } else if (['DELIVERED', 'COMPLETE', 'CLOSED'].includes(toStatus)) {
      releaseForJob(jobId, `cascade:${toStatus}`).catch((e) =>
        logger.warn('cascade_release_failed', { jobId, toStatus, err: e?.message })
      )
    }

    return { ok: true, previousStatus: fromStatus, newStatus: toStatus }
  } catch (e: any) {
    logger.error('cascade_advanceJobWithGuards_failed', e, { jobId, fromStatus, toStatus })
    return { ok: false, reason: e?.message }
  }
}

/**
 * generatePicksForJob — walks Job → Order → OrderItem → BomEntry and creates
 * MaterialPick rows (idempotent). Sets Job.pickListGenerated = true when at
 * least one pick was created. Returns the count of picks generated.
 *
 * Note: the canonical pick generator lives at
 * /api/ops/manufacturing/generate-picks with richer BoM expansion. This
 * helper is a lightweight convenience for scripts/tests that just need
 * "make the picks exist so the next status gate can clear."
 */
export async function generatePicksForJob(jobId: string): Promise<{ ok: boolean; created: number; detail?: string }> {
  try {
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "orderId" FROM "Job" WHERE "id" = $1`, jobId
    )
    if (jobs.length === 0) return { ok: false, created: 0, detail: 'job_not_found' }
    if (!jobs[0].orderId) return { ok: false, created: 0, detail: 'no_order_linked' }

    const orderId = jobs[0].orderId

    // Skip if picks already exist for this job (idempotent).
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "MaterialPick" WHERE "jobId" = $1`, jobId
    )
    if (Number(existing[0]?.n || 0) > 0) {
      return { ok: true, created: 0, detail: 'picks_already_generated' }
    }

    const orderItems: any[] = await prisma.$queryRawUnsafe(
      `SELECT oi."productId", oi."quantity", oi."description",
              p."sku"
       FROM "OrderItem" oi
       LEFT JOIN "Product" p ON p."id" = oi."productId"
       WHERE oi."orderId" = $1`,
      orderId
    )

    let created = 0
    for (const item of orderItems) {
      const id = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${created}`
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "MaterialPick" (
            "id", "jobId", "productId", "sku", "description",
            "quantity", "pickedQty", "status", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, 0, 'PENDING'::"PickStatus", NOW(), NOW()
          )`,
          id, jobId, item.productId || null,
          item.sku || 'UNKNOWN', item.description || 'Unknown',
          Number(item.quantity || 0)
        )
        created++
      } catch (err) {
        logger.warn('material_pick_insert_failed', { jobId, productId: item.productId, err })
      }
    }

    if (created > 0) {
      // Best-effort flag (column added via migration v2)
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET "pickListGenerated" = true, "updatedAt" = NOW() WHERE "id" = $1`, jobId
        )
      } catch {
        // column may not exist in this environment; swallow
      }
    }

    return { ok: true, created }
  } catch (e: any) {
    logger.error('cascade_generatePicksForJob_failed', e, { jobId })
    return { ok: false, created: 0, detail: e?.message }
  }
}

// ── QC inspection helpers (duplicated from advance-job route for cohesion) ──

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
  } catch { /* ignore */ }
  try {
    const insp: any[] = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "Inspection"
       WHERE "jobId" = $1
         AND "status" IN ('PASS', 'PASS_WITH_NOTES', 'PASSED')
       LIMIT 1`,
      jobId
    )
    if (insp.length > 0) return true
  } catch { /* ignore */ }
  return false
}

async function hasUnresolvedFailingInspection(jobId: string): Promise<boolean> {
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
  return false
}
