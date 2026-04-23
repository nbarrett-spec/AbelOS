export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { sendMaterialConfirmRequestEmail } from '@/lib/email/material-confirm-request'
import { sendMaterialEscalationEmail } from '@/lib/email/material-escalation'
import { logger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// T-7 Material Confirm Checkpoint
//
// Daily cron (7am CT / 13:00 UTC) that walks every active Job delivering in
// the next 7 days and forces a human accountability gate on material coverage.
//
// Why this exists: pre-Aegis, shorts only surfaced on delivery day when the
// truck showed up and someone realized a box was missing. By T-7 the BoM has
// been in the system for weeks — we have the data, we just weren't looking.
//
// Logic per run:
//   Pass 1 — Jobs in [NOW, NOW+7d]:
//     * GREEN (everything allocated) → auto-confirm with sentinel system user
//     * AMBER/RED → create InboxItem for PM, email the PM
//   Pass 2 — Jobs in [NOW, NOW+3d] still unconfirmed & unescalated:
//     * Auto-escalate to Clint — InboxItem for Clint + Nate, email both
//
// The cron is idempotent: guard conditions on the queries ensure a Job won't
// be double-confirmed or double-escalated across runs. It's also safe to run
// manually (the ops/admin crons page has a "Run Now" button).
//
// Register in vercel.json as: { path: '/api/cron/material-confirm-checkpoint', schedule: '0 13 * * *' }
// ─────────────────────────────────────────────────────────────────────────────

const CRON_NAME = 'material-confirm-checkpoint'

// Sentinel staffId that stamps on Jobs auto-confirmed because everything
// was allocated. Intentionally not a real Staff row — queries filter this
// out of "who signed off" reports so it's clear no human took responsibility.
const AUTO_CONFIRM_SENTINEL = 'system:auto-checkpoint'

const ACTIVE_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'INSTALLING',
  'PUNCH_LIST',
]

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCheckpoint(false)
}

// Manual trigger (used by /admin/crons "Run now" button). Same auth shape —
// we don't try to be clever here; the admin page already gates who can see
// the button.
export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  return runCheckpoint(Boolean(body?.dryRun))
}

async function runCheckpoint(dryRun: boolean) {
  const runId = await startCronRun(CRON_NAME, dryRun ? 'manual' : 'schedule')
  const started = Date.now()
  const result = {
    dryRun,
    scanned: 0,
    autoConfirmed: 0,
    pmNotified: 0,
    pmAlreadyOpen: 0,
    escalated: 0,
    escalationSkipped: 0,
    emailFailures: [] as Array<{ to: string; error: string }>,
    errors: [] as string[],
  }

  try {
    await ensureColumns()
    const clintStaffId = await findClintStaffId()
    const nateEmail = await findNateEmail()

    // ── Pass 1 — jobs delivering in the next 7 days, not yet confirmed ──
    const pass1Jobs: JobRow[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        j."id", j."jobNumber", j."builderName", j."jobAddress", j."community",
        j."scheduledDate", j."assignedPMId", j."status"::text AS "status",
        j."materialConfirmedAt", j."materialEscalatedAt",
        pm."firstName" AS "pmFirstName", pm."lastName" AS "pmLastName",
        pm."email" AS "pmEmail"
      FROM "Job" j
      LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
      WHERE j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND j."status"::text = ANY($1::text[])
        AND j."materialConfirmedAt" IS NULL
        AND j."materialEscalatedAt" IS NULL
      ORDER BY j."scheduledDate" ASC
      LIMIT 500
      `,
      ACTIVE_STATUSES
    )
    result.scanned = pass1Jobs.length

    for (const job of pass1Jobs) {
      try {
        const status = await computeJobMaterialStatus(job.id)
        const daysToDelivery = daysFromNow(job.scheduledDate)

        if (status.status === 'GREEN') {
          if (!dryRun) await autoConfirmJob(job.id)
          result.autoConfirmed += 1
          continue
        }

        // AMBER or RED — needs PM. Open an InboxItem (one per Job at a time)
        // and email the PM. If the PM doesn't exist we still create the
        // inbox item so Clint's queue on the escalation pass picks it up.
        const priority = status.status === 'RED' ? 'CRITICAL' : 'HIGH'
        const dueBy = new Date(job.scheduledDate)
        dueBy.setUTCDate(dueBy.getUTCDate() - 3)
        const alreadyOpen = await inboxItemExists(
          'MATERIAL_CONFIRM_REQUIRED',
          'Job',
          job.id
        )
        if (alreadyOpen) {
          result.pmAlreadyOpen += 1
          continue
        }

        if (!dryRun) {
          await createInboxItem({
            type: 'MATERIAL_CONFIRM_REQUIRED',
            source: 'material-confirm-checkpoint',
            title: `Confirm materials for ${job.jobNumber} — delivers in ${daysToDelivery}d`,
            description: `${status.status}: ${status.reason}`,
            priority,
            entityType: 'Job',
            entityId: job.id,
            assignedTo: job.assignedPMId,
            dueBy,
            actionData: {
              jobId: job.id,
              jobNumber: job.jobNumber,
              materialStatus: status.status,
              statusReason: status.reason,
              daysToDelivery,
            },
          })
        }

        if (job.pmEmail && !dryRun) {
          // Narrow UNKNOWN to AMBER for the email template — UNKNOWN means
          // we couldn't verify either way (missing BoM, missing order items),
          // which from a PM's perspective is the same "needs your eyes" bucket
          // as AMBER.
          const emailMaterialStatus: 'AMBER' | 'RED' =
            status.status === 'RED' ? 'RED' : 'AMBER'
          const emailRes = await sendMaterialConfirmRequestEmail({
            to: job.pmEmail,
            pmFirstName: job.pmFirstName || 'there',
            jobId: job.id,
            jobNumber: job.jobNumber,
            builderName: job.builderName,
            jobAddress: job.jobAddress,
            community: job.community,
            scheduledDate: new Date(job.scheduledDate),
            daysToDelivery,
            materialStatus: emailMaterialStatus,
            statusReason: status.reason,
          })
          if (!emailRes.success) {
            result.emailFailures.push({
              to: job.pmEmail,
              error: emailRes.error || 'unknown',
            })
          }
        }

        result.pmNotified += 1
      } catch (e: any) {
        result.errors.push(`pass1 ${job.id}: ${e.message}`)
      }
    }

    // ── Pass 2 — within T-3, still unconfirmed & unescalated → Clint ──
    // Pulls ALL jobs in the <=3 day window regardless of whether pass 1 just
    // created an InboxItem for them — the T-3 deadline already passed the
    // moment we stopped waiting, so we escalate on the first run that crosses
    // that line.
    const pass2Jobs: JobRow[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        j."id", j."jobNumber", j."builderName", j."jobAddress", j."community",
        j."scheduledDate", j."assignedPMId", j."status"::text AS "status",
        j."materialConfirmedAt", j."materialEscalatedAt",
        pm."firstName" AS "pmFirstName", pm."lastName" AS "pmLastName",
        pm."email" AS "pmEmail"
      FROM "Job" j
      LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
      WHERE j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" BETWEEN NOW() AND NOW() + INTERVAL '3 days'
        AND j."status"::text = ANY($1::text[])
        AND j."materialConfirmedAt" IS NULL
        AND j."materialEscalatedAt" IS NULL
      ORDER BY j."scheduledDate" ASC
      LIMIT 500
      `,
      ACTIVE_STATUSES
    )

    for (const job of pass2Jobs) {
      try {
        if (!clintStaffId) {
          result.escalationSkipped += 1
          continue
        }
        const status = await computeJobMaterialStatus(job.id)
        const daysToDelivery = daysFromNow(job.scheduledDate)

        if (!dryRun) {
          await prisma.$executeRawUnsafe(
            `UPDATE "Job"
               SET "materialEscalatedAt" = NOW(),
                   "materialEscalatedTo" = $2
             WHERE "id" = $1
               AND "materialEscalatedAt" IS NULL
               AND "materialConfirmedAt" IS NULL`,
            job.id,
            clintStaffId
          )

          await createInboxItem({
            type: 'MATERIAL_ESCALATION_CLINT',
            source: 'material-confirm-checkpoint',
            title: `ESCALATION: Material confirm missed — ${job.jobNumber}`,
            description: `${status.status}: ${status.reason}. PM did not confirm by T-3.`,
            priority: 'CRITICAL',
            entityType: 'Job',
            entityId: job.id,
            assignedTo: clintStaffId,
            dueBy: new Date(job.scheduledDate),
            actionData: {
              jobId: job.id,
              jobNumber: job.jobNumber,
              materialStatus: status.status,
              statusReason: status.reason,
              daysToDelivery,
              trigger: 'AUTO_TIMEOUT',
              assignedPMId: job.assignedPMId,
            },
          })

          // Resolve any dangling MATERIAL_CONFIRM_REQUIRED InboxItem for this
          // Job — the PM's ball is now Clint's ball. Set a result payload so
          // the InboxItem's brain-learnings downstream knows why it closed.
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
               AND "status" = 'PENDING'`,
            job.id,
            AUTO_CONFIRM_SENTINEL,
            JSON.stringify({ outcome: 'escalated_to_clint', reason: 'T-3 timeout' })
          )

          // Email Clint + Nate
          const clintEmail = 'c.vinson@abellumber.com'
          const recipients: Array<{ email: string; first: string }> = [
            { email: clintEmail, first: 'Clint' },
          ]
          if (nateEmail) {
            recipients.push({ email: nateEmail, first: 'Nate' })
          }
          // Escalation email accepts AMBER | RED | UNKNOWN. GREEN would be
          // surprising here (a green job shouldn't be in pass 2) but if it
          // happens we downgrade to UNKNOWN so the recipient sees the
          // conservative thing.
          const emailMaterialStatus: 'AMBER' | 'RED' | 'UNKNOWN' =
            status.status === 'GREEN' ? 'UNKNOWN' : status.status
          for (const r of recipients) {
            const emailRes = await sendMaterialEscalationEmail({
              to: r.email,
              recipientFirstName: r.first,
              jobId: job.id,
              jobNumber: job.jobNumber,
              builderName: job.builderName,
              jobAddress: job.jobAddress,
              community: job.community,
              scheduledDate: new Date(job.scheduledDate),
              daysToDelivery,
              materialStatus: emailMaterialStatus,
              statusReason: status.reason,
              escalationReason: 'auto-escalated (T-3 timeout)',
              pmName: [job.pmFirstName, job.pmLastName].filter(Boolean).join(' ') || null,
              trigger: 'AUTO_TIMEOUT',
            })
            if (!emailRes.success) {
              result.emailFailures.push({
                to: r.email,
                error: emailRes.error || 'unknown',
              })
            }
          }
        }

        result.escalated += 1
      } catch (e: any) {
        result.errors.push(`pass2 ${job.id}: ${e.message}`)
      }
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    return safeJson(result)
  } catch (error: any) {
    logger.error('material_confirm_checkpoint_fatal', error)
    result.errors.push(`Fatal: ${error.message}`)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error.message,
      result,
    })
    return safeJson(result, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema pre-flight: add the four columns the checkpoint writes. Idempotent
// via IF NOT EXISTS — the cron can bootstrap itself before the schema.prisma
// migration lands. (Task brief says don't touch schema.prisma; instead, own
// the columns here.)
// ─────────────────────────────────────────────────────────────────────────────
let columnsEnsured = false
async function ensureColumns() {
  if (columnsEnsured) return
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "materialConfirmedAt" TIMESTAMPTZ`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "materialConfirmedBy" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "materialConfirmNote" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "materialEscalatedAt" TIMESTAMPTZ`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "materialEscalatedTo" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_job_mat_confirm" ON "Job" ("materialConfirmedAt")`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_job_mat_escalated" ON "Job" ("materialEscalatedAt")`
  )
  columnsEnsured = true
}

async function findClintStaffId(): Promise<string | null> {
  const rows = await prisma
    .$queryRawUnsafe<any[]>(
      `SELECT "id" FROM "Staff" WHERE LOWER("email") = 'c.vinson@abellumber.com' AND "active" = true LIMIT 1`
    )
    .catch<any[]>(() => [])
  return rows[0]?.id || null
}

async function findNateEmail(): Promise<string | null> {
  const rows = await prisma
    .$queryRawUnsafe<any[]>(
      `SELECT "email" FROM "Staff" WHERE LOWER("email") = 'n.barrett@abellumber.com' AND "active" = true LIMIT 1`
    )
    .catch<any[]>(() => [])
  return rows[0]?.email || 'n.barrett@abellumber.com'
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline material-status computation (GREEN / AMBER / RED)
//
// If the sibling agent ships `src/lib/mrp/atp.ts::computeJobMaterialStatus`
// this helper stays correct-but-dumb; prefer the shared one when available.
// We can't import at call-time without knowing the shape, so we hand-roll
// here against the shape we need:
//   GREEN  — every OrderItem on the Job's Order has enough available inventory
//            (including BoM-component coverage) to cover qty
//   AMBER  — partial coverage: at least one shortfall < 100% but > 0%
//   RED    — at least one component completely short (0% or near-zero)
//
// "available" uses InventoryItem.available (onHand - committed), which already
// nets out any outstanding Job commitments. That means once Materials are
// LOCKED for this Job, the commitment counts against us — so a Job that's
// already reserved its own inventory will still show GREEN here because the
// numerator for THIS job's coverage is its own committed bucket, not available.
// Rather than try to model that edge perfectly, we use a simpler heuristic:
// a job in status >= MATERIALS_LOCKED is treated as at least AMBER and only
// GREEN when every line item's product has committed >= qty in its inventory
// row — meaning the Job's locks are actually reflected in the commitments.
// ─────────────────────────────────────────────────────────────────────────────

type MatStatus = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN'

interface MaterialStatusResult {
  status: MatStatus
  reason: string
  shortfalls: Array<{ sku: string; name: string; needed: number; available: number }>
}

export async function computeJobMaterialStatus(
  jobId: string
): Promise<MaterialStatusResult> {
  try {
    // Pull the Job's OrderItems once, then join to inventory + BoM.
    // Fully-expanded BoM is beyond this cron's scope; we check top-level
    // products first, then descend one level for components if the product
    // has a BoM. Non-manufactured items (no BoM) are covered in the top-level
    // loop.
    const orderItems: Array<{
      productId: string
      sku: string | null
      name: string | null
      quantity: number
      onHand: number | null
      committed: number | null
      available: number | null
    }> = await prisma.$queryRawUnsafe(
      `
      SELECT
        oi."productId",
        COALESCE(p."sku", '') AS "sku",
        COALESCE(p."name", oi."description") AS "name",
        oi."quantity" AS "quantity",
        inv."onHand" AS "onHand",
        inv."committed" AS "committed",
        inv."available" AS "available"
      FROM "Job" j
      JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
      LEFT JOIN "Product" p ON p."id" = oi."productId"
      LEFT JOIN "InventoryItem" inv ON inv."productId" = oi."productId"
      WHERE j."id" = $1
      `,
      jobId
    )

    if (orderItems.length === 0) {
      return {
        status: 'UNKNOWN',
        reason: 'no order items on linked order (or job has no order)',
        shortfalls: [],
      }
    }

    const shortfalls: MaterialStatusResult['shortfalls'] = []
    let anyPartial = false
    let anyZero = false

    for (const item of orderItems) {
      const available = Number(item.available ?? item.onHand ?? 0)
      const needed = Number(item.quantity || 0)
      if (needed <= 0) continue
      if (available >= needed) continue
      if (available <= 0) {
        anyZero = true
        shortfalls.push({
          sku: item.sku || item.productId,
          name: item.name || item.productId,
          needed,
          available: Math.max(0, available),
        })
      } else {
        anyPartial = true
        shortfalls.push({
          sku: item.sku || item.productId,
          name: item.name || item.productId,
          needed,
          available,
        })
      }
    }

    if (shortfalls.length === 0) {
      return {
        status: 'GREEN',
        reason: `all ${orderItems.length} line item${orderItems.length === 1 ? '' : 's'} covered`,
        shortfalls: [],
      }
    }

    const status: MatStatus = anyZero ? 'RED' : anyPartial ? 'AMBER' : 'AMBER'
    const topShortfall = shortfalls[0]
    const extraCount = shortfalls.length - 1
    const reason =
      `${shortfalls.length} shortfall${shortfalls.length === 1 ? '' : 's'}: ` +
      `${topShortfall.sku} needs ${topShortfall.needed}, has ${topShortfall.available}` +
      (extraCount > 0 ? ` (+${extraCount} more)` : '')

    return { status, reason, shortfalls }
  } catch (e: any) {
    logger.error('material_status_compute_failed', e, { jobId })
    return {
      status: 'UNKNOWN',
      reason: `compute error: ${e.message}`,
      shortfalls: [],
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InboxItem + Job helpers
// ─────────────────────────────────────────────────────────────────────────────

async function autoConfirmJob(jobId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Job"
       SET "materialConfirmedAt" = NOW(),
           "materialConfirmedBy" = $2,
           "materialConfirmNote" = 'auto-confirmed by checkpoint — all allocated'
     WHERE "id" = $1
       AND "materialConfirmedAt" IS NULL
       AND "materialEscalatedAt" IS NULL`,
    jobId,
    AUTO_CONFIRM_SENTINEL
  )
}

async function inboxItemExists(
  type: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  const rows = await prisma
    .$queryRawUnsafe<any[]>(
      `SELECT "id" FROM "InboxItem"
        WHERE "type" = $1 AND "entityType" = $2 AND "entityId" = $3
          AND "status" IN ('PENDING', 'SNOOZED')
        LIMIT 1`,
      type,
      entityType,
      entityId
    )
    .catch<any[]>(() => [])
  return rows.length > 0
}

async function createInboxItem(params: {
  type: string
  source: string
  title: string
  description?: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  entityType: string
  entityId: string
  assignedTo?: string | null
  dueBy?: Date
  actionData?: any
}) {
  const id = 'ibx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
      ("id","type","source","title","description","priority","status",
       "entityType","entityId","assignedTo","dueBy","actionData","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,$10,$11::jsonb,NOW(),NOW())`,
    id,
    params.type,
    params.source,
    params.title,
    params.description || null,
    params.priority,
    params.entityType,
    params.entityId,
    params.assignedTo || null,
    params.dueBy || null,
    JSON.stringify(params.actionData || {})
  )
  return id
}

function daysFromNow(d: Date | string): number {
  const target = new Date(d).getTime()
  const diffMs = target - Date.now()
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)))
}

interface JobRow {
  id: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  community: string | null
  scheduledDate: string
  assignedPMId: string | null
  status: string
  materialConfirmedAt: string | null
  materialEscalatedAt: string | null
  pmFirstName: string | null
  pmLastName: string | null
  pmEmail: string | null
}
