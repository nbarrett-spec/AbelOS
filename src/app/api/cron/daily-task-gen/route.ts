/**
 * /api/cron/daily-task-gen — Auto-generate role-based tasks
 *
 * Spec: STAFF-TASK-SYSTEM-SPEC.md §4.
 *
 * Runs daily at 6:00 AM CT (11:00 UTC), before pm-daily-tasks (6:30 AM).
 *
 * What it does:
 *   1. Resolves a system creator (first ADMIN, falls back to first active staff)
 *   2. PM tasks       — overdue jobs, today's readiness, material ETAs
 *   3. Sales tasks    — quote follow-ups
 *   4. Accounting     — overdue invoice collection (>30d) + follow-up (7-30d)
 *   5. Leadership     — PO >$5K pending approval, Monday P&L review
 *   6. Escalation     — CRITICAL overdue → manager; HIGH overdue >2d → manager
 *
 * Idempotency: every task uses a `sourceKey` like
 *   "<type>:<entityId>:<bucket>"
 * The route checks for an existing row with that key before inserting.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>.
 *
 * Triggers I deliberately skipped (schema fields unclear/missing):
 *   - Deal stage idle (Deal model has no status timestamp surfaced)
 *   - Contract renewal (no Contract model with end-date)
 *   - Builder application unreviewed (no clear table)
 *   - Builder health grade dropped (grade lives in Brain, not Aegis DB)
 *   - Credit memo pending approval (CreditMemo model status unclear)
 *   - Payment reconciliation (state spread across Payment/Invoice)
 * Each can be added incrementally later without changing the framework.
 */

export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import crypto from 'crypto'

interface GenResult {
  pm: number
  sales: number
  accounting: number
  leadership: number
  escalations: number
  skipped: number
  errors: string[]
}

function newTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function weekOf(d: Date = new Date()): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = x.getDay() // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow // Monday-anchored
  x.setDate(x.getDate() + offset)
  return x.toISOString().slice(0, 10)
}

async function resolveSystemCreator(): Promise<string | null> {
  // Prefer ADMIN, fall back to any active staff. The Task FK forces a real
  // staff id — we can't insert a synthetic 'SYSTEM' string.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "active" = true AND "role"::text = 'ADMIN'
      ORDER BY "createdAt" ASC
      LIMIT 1`,
  )
  if (rows[0]?.id) return rows[0].id
  const fb: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" WHERE "active" = true ORDER BY "createdAt" ASC LIMIT 1`,
  )
  return fb[0]?.id ?? null
}

async function existsBySourceKey(sourceKey: string): Promise<boolean> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "Task" WHERE "sourceKey" = $1 LIMIT 1`,
    sourceKey,
  )
  return rows.length > 0
}

interface TaskInsert {
  assigneeId: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category: string
  dueDate: Date | null
  sourceKey: string
  jobId?: string | null
  builderId?: string | null
  communityId?: string | null
}

async function createTaskIfMissing(
  creatorId: string,
  task: TaskInsert,
  result: GenResult,
  bucket: 'pm' | 'sales' | 'accounting' | 'leadership' | 'escalations',
): Promise<boolean> {
  try {
    if (await existsBySourceKey(task.sourceKey)) {
      result.skipped++
      return false
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" (
         "id", "assigneeId", "creatorId", "jobId", "builderId", "communityId",
         "title", "description",
         "priority", "status", "category",
         "dueDate", "sourceKey",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8,
         $9::"TaskPriority", 'TODO'::"TaskStatus", $10::"TaskCategory",
         $11, $12,
         NOW(), NOW()
       )`,
      newTaskId(),
      task.assigneeId,
      creatorId,
      task.jobId ?? null,
      task.builderId ?? null,
      task.communityId ?? null,
      task.title,
      task.description,
      task.priority,
      task.category,
      task.dueDate,
      task.sourceKey,
    )
    result[bucket]++
    return true
  } catch (err: any) {
    result.errors.push(
      `${task.sourceKey}: ${err?.message?.slice?.(0, 200) || 'insert failed'}`,
    )
    return false
  }
}

// ──────────────────────────────────────────────────────────────────
// PM Tasks
// ──────────────────────────────────────────────────────────────────

async function generatePmTasks(creatorId: string, result: GenResult) {
  const today = isoDate()
  const week = weekOf()

  // Overdue jobs (CRITICAL): scheduledDate < today AND status not terminal.
  const overdueJobs: any[] = await prisma.$queryRawUnsafe(
    `SELECT j."id", j."jobNumber", j."jobAddress", j."assignedPMId",
            j."scheduledDate", j."communityId",
            o."builderId" AS "builderId",
            EXTRACT(DAY FROM NOW() - j."scheduledDate")::int AS "daysLate"
       FROM "Job" j
  LEFT JOIN "Order" o ON o."id" = j."orderId"
      WHERE j."assignedPMId" IS NOT NULL
        AND j."scheduledDate" IS NOT NULL
        AND j."scheduledDate"::date < CURRENT_DATE
        AND j."status"::text NOT IN ('COMPLETE', 'INVOICED', 'CLOSED')
      LIMIT 200`,
  )
  for (const j of overdueJobs) {
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: j.assignedPMId,
        title: `Overdue job: ${j.jobNumber} — ${j.daysLate}d late`,
        description: `Job ${j.jobNumber} at ${j.jobAddress || 'site'} was scheduled for ${
          j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString() : 'an earlier date'
        }. Confirm status with crew or reschedule.`,
        priority: 'CRITICAL',
        category: 'EXCEPTION_RESOLUTION',
        dueDate: new Date(),
        sourceKey: `job-overdue:${j.id}:${week}`,
        jobId: j.id,
        builderId: j.builderId,
        communityId: j.communityId,
      },
      result,
      'pm',
    )
  }

  // Today's readiness incomplete (HIGH): scheduledDate = today, readinessCheck = false.
  const readinessJobs: any[] = await prisma.$queryRawUnsafe(
    `SELECT j."id", j."jobNumber", j."jobAddress", j."assignedPMId",
            j."communityId",
            o."builderId" AS "builderId"
       FROM "Job" j
  LEFT JOIN "Order" o ON o."id" = j."orderId"
      WHERE j."assignedPMId" IS NOT NULL
        AND j."scheduledDate"::date = CURRENT_DATE
        AND j."readinessCheck" = false
        AND j."status"::text NOT IN ('COMPLETE', 'INVOICED', 'CLOSED', 'CANCELLED')
      LIMIT 200`,
  )
  for (const j of readinessJobs) {
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: j.assignedPMId,
        title: `Verify readiness: Job ${j.jobNumber} at ${j.jobAddress || 'site'}`,
        description: `Today's job has no readiness confirmation. Confirm materials, crew, and access.`,
        priority: 'HIGH',
        category: 'READINESS_CHECK',
        dueDate: endOfTodayDate(),
        sourceKey: `readiness:${j.id}:${today}`,
        jobId: j.id,
        builderId: j.builderId,
        communityId: j.communityId,
      },
      result,
      'pm',
    )
  }

  // Material arriving today (MEDIUM): POs with expectedDate = today.
  // PurchaseOrder has no direct Job link — round-robin across active PMs
  // so somebody owns the receiving check.
  const pmRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "active" = true AND "role"::text = 'PROJECT_MANAGER'
      ORDER BY "createdAt" ASC`,
  )
  if (pmRows.length > 0) {
    const materialPOs: any[] = await prisma.$queryRawUnsafe(
      `SELECT po."id" AS "poId", po."poNumber", po."expectedDate",
              v."name" AS "vendorName"
         FROM "PurchaseOrder" po
         JOIN "Vendor" v ON v."id" = po."vendorId"
        WHERE po."expectedDate"::date = CURRENT_DATE
          AND po."status"::text NOT IN ('CANCELLED', 'RECEIVED')
        LIMIT 200`,
    )
    let pmIdx = 0
    for (const m of materialPOs) {
      const pmId = pmRows[pmIdx % pmRows.length].id
      pmIdx++
      await createTaskIfMissing(
        creatorId,
        {
          assigneeId: pmId,
          title: `Material arriving: PO ${m.poNumber} from ${m.vendorName}`,
          description: `Expected delivery today. Verify receipt and update inventory.`,
          priority: 'MEDIUM',
          category: 'MATERIAL_VERIFICATION',
          dueDate: endOfTodayDate(),
          sourceKey: `material-eta:${m.poId}:${today}`,
        },
        result,
        'pm',
      )
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Sales Tasks
// ──────────────────────────────────────────────────────────────────

async function generateSalesTasks(creatorId: string, result: GenResult) {
  const week = weekOf()

  // Builder doesn't have a direct salesRepId — round-robin quote-follow-ups
  // across SALES_REP staff so somebody owns the call.
  const reps: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "active" = true AND "role"::text = 'SALES_REP'
      ORDER BY "createdAt" ASC`,
  )
  if (reps.length === 0) return

  let rrIdx = 0
  function nextRep(): string {
    const id = reps[rrIdx % reps.length].id
    rrIdx++
    return id
  }

  // Quote sent, no response in 3 days (HIGH).
  const staleQuotes: any[] = await prisma.$queryRawUnsafe(
    `SELECT q."id" AS "quoteId", q."quoteNumber",
            q."createdAt", q."status"::text AS "status",
            b."companyName" AS "builderName",
            b."id" AS "builderId"
       FROM "Quote" q
       JOIN "Project" p ON p."id" = q."projectId"
       JOIN "Builder" b ON b."id" = p."builderId"
      WHERE q."status"::text = 'SENT'
        AND q."createdAt" < NOW() - INTERVAL '3 days'
      LIMIT 200`,
  )
  for (const q of staleQuotes) {
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: nextRep(),
        title: `Follow up: Quote ${q.quoteNumber} for ${q.builderName}`,
        description: `Quote ${q.quoteNumber} sent ${
          q.createdAt ? new Date(q.createdAt).toLocaleDateString() : ''
        }, no response yet. Reach out for status.`,
        priority: 'HIGH',
        category: 'BUILDER_COMMUNICATION',
        dueDate: endOfTodayDate(),
        sourceKey: `quote-followup:${q.quoteId}:${week}`,
        builderId: q.builderId,
      },
      result,
      'sales',
    )
  }
}

// ──────────────────────────────────────────────────────────────────
// Accounting Tasks
// ──────────────────────────────────────────────────────────────────

async function generateAccountingTasks(creatorId: string, result: GenResult) {
  const today = isoDate()
  const week = weekOf()

  // Find the accounting team to round-robin assignments across.
  const accountingStaff: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "active" = true
        AND "role"::text = 'ACCOUNTING'
      ORDER BY "createdAt" ASC`,
  )
  if (accountingStaff.length === 0) return

  let rrIdx = 0
  function nextAcctAssignee(): string {
    const id = accountingStaff[rrIdx % accountingStaff.length].id
    rrIdx++
    return id
  }

  // Invoice overdue > 30d (CRITICAL).
  const invoicesCritical: any[] = await prisma.$queryRawUnsafe(
    `SELECT i."id", i."invoiceNumber",
            (i."total" - COALESCE(i."amountPaid", 0))::float AS "balance",
            i."dueDate",
            EXTRACT(DAY FROM NOW() - i."dueDate")::int AS "daysLate",
            b."companyName" AS "builderName",
            b."id" AS "builderId"
       FROM "Invoice" i
       JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF', 'DRAFT')
        AND i."dueDate" IS NOT NULL
        AND i."dueDate" < NOW() - INTERVAL '30 days'
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      LIMIT 200`,
  )
  for (const inv of invoicesCritical) {
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: nextAcctAssignee(),
        title: `Collections: ${inv.builderName} — $${formatMoney(inv.balance)} (${inv.daysLate}d)`,
        description: `Invoice ${inv.invoiceNumber} is ${inv.daysLate} days overdue. Initiate collections call or escalate.`,
        priority: 'CRITICAL',
        category: 'INVOICE_FOLLOW_UP',
        dueDate: new Date(),
        sourceKey: `invoice-overdue:${inv.id}:30plus:${week}`,
        builderId: inv.builderId,
      },
      result,
      'accounting',
    )
  }

  // Invoice overdue 7-30d (HIGH).
  const invoicesHigh: any[] = await prisma.$queryRawUnsafe(
    `SELECT i."id", i."invoiceNumber",
            (i."total" - COALESCE(i."amountPaid", 0))::float AS "balance",
            i."dueDate",
            EXTRACT(DAY FROM NOW() - i."dueDate")::int AS "daysLate",
            b."companyName" AS "builderName",
            b."id" AS "builderId"
       FROM "Invoice" i
       JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF', 'DRAFT')
        AND i."dueDate" IS NOT NULL
        AND i."dueDate" < NOW() - INTERVAL '7 days'
        AND i."dueDate" >= NOW() - INTERVAL '30 days'
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      LIMIT 200`,
  )
  for (const inv of invoicesHigh) {
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: nextAcctAssignee(),
        title: `Follow up: Invoice ${inv.invoiceNumber} — $${formatMoney(inv.balance)}`,
        description: `${inv.builderName} — invoice ${inv.daysLate} days past due. Send reminder.`,
        priority: 'HIGH',
        category: 'INVOICE_FOLLOW_UP',
        dueDate: endOfTodayDate(),
        sourceKey: `invoice-followup:${inv.id}:${week}`,
        builderId: inv.builderId,
      },
      result,
      'accounting',
    )
  }
}

// ──────────────────────────────────────────────────────────────────
// Leadership Tasks
// ──────────────────────────────────────────────────────────────────

async function generateLeadershipTasks(creatorId: string, result: GenResult) {
  const week = weekOf()
  const today = new Date()

  // Find leadership staff (ADMIN + MANAGER) for assignment.
  const leaders: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "active" = true
        AND "role"::text IN ('ADMIN', 'MANAGER')
      ORDER BY "createdAt" ASC`,
  )
  if (leaders.length === 0) return

  let rrIdx = 0
  function nextLeader(): string {
    const id = leaders[rrIdx % leaders.length].id
    rrIdx++
    return id
  }

  // PO > $5,000 needs approval (HIGH).
  const bigPOs: any[] = await prisma.$queryRawUnsafe(
    `SELECT po."id", po."poNumber", po."total"::float AS "total",
            v."name" AS "vendorName"
       FROM "PurchaseOrder" po
       JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status"::text IN ('DRAFT', 'PENDING_APPROVAL')
        AND po."total" > 5000
      LIMIT 100`,
  )
  for (const po of bigPOs) {
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: nextLeader(),
        title: `Approve PO: ${po.poNumber} — $${formatMoney(po.total)} (${po.vendorName})`,
        description: `Purchase order pending approval. Review and approve in /ops/purchasing.`,
        priority: 'HIGH',
        category: 'GENERAL',
        dueDate: endOfTodayDate(),
        sourceKey: `po-approve:${po.id}`,
        // Multiple leaders may have a copy — sourceKey doesn't include
        // assigneeId, so only the first one wins. That's intentional —
        // the first responder claims the approval.
      },
      result,
      'leadership',
    )
  }

  // Weekly P&L review (Monday only).
  if (today.getDay() === 1) {
    for (const leader of leaders) {
      await createTaskIfMissing(
        creatorId,
        {
          assigneeId: leader.id,
          title: "Review last week's P&L",
          description: 'Weekly financial review — open the finance dashboard and check revenue/spend against plan.',
          priority: 'MEDIUM',
          category: 'GENERAL',
          dueDate: endOfTodayDate(),
          sourceKey: `weekly-pl:${leader.id}:${week}`,
        },
        result,
        'leadership',
      )
    }
  }

  // Staff task BLOCKED > 2 days (MEDIUM).
  const blocked: any[] = await prisma.$queryRawUnsafe(
    `SELECT t."id", t."title", t."assigneeId", t."updatedAt",
            s."firstName", s."lastName", s."managerId"
       FROM "Task" t
       JOIN "Staff" s ON s."id" = t."assigneeId"
      WHERE t."status"::text = 'BLOCKED'
        AND t."updatedAt" < NOW() - INTERVAL '2 days'
      LIMIT 100`,
  )
  for (const b of blocked) {
    const assignee =
      b.managerId || (leaders.length > 0 ? nextLeader() : null)
    if (!assignee) continue
    await createTaskIfMissing(
      creatorId,
      {
        assigneeId: assignee,
        title: `Blocked escalation: ${b.title} (${b.firstName} ${b.lastName})`,
        description: `Task has been BLOCKED since ${
          b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : 'recently'
        }. Help unblock or reassign.`,
        priority: 'MEDIUM',
        category: 'EXCEPTION_RESOLUTION',
        dueDate: null,
        sourceKey: `blocked-escalation:${b.id}:${week}`,
      },
      result,
      'leadership',
    )
  }
}

// ──────────────────────────────────────────────────────────────────
// Escalation Rules
// ──────────────────────────────────────────────────────────────────

async function generateEscalations(creatorId: string, result: GenResult) {
  const today = isoDate()
  const week = weekOf()

  const fallbackLeaders: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE "active" = true
        AND "role"::text IN ('ADMIN', 'MANAGER')`,
  )
  const fallbackIds: string[] = fallbackLeaders.map((s: any) => s.id)

  async function targets(staffManagerId: string | null): Promise<string[]> {
    if (staffManagerId) return [staffManagerId]
    return fallbackIds
  }

  // Rule 1: CRITICAL overdue → daily escalation.
  const criticalOverdue: any[] = await prisma.$queryRawUnsafe(
    `SELECT t."id" AS "taskId", t."title", t."dueDate", t."assigneeId",
            s."firstName" || ' ' || s."lastName" AS "staffName",
            s."managerId",
            EXTRACT(DAY FROM NOW() - t."dueDate")::int AS "daysLate"
       FROM "Task" t
       JOIN "Staff" s ON s."id" = t."assigneeId"
      WHERE t."priority"::text = 'CRITICAL'
        AND t."status"::text NOT IN ('DONE', 'CANCELLED')
        AND t."dueDate" IS NOT NULL
        AND t."dueDate" < NOW()
      LIMIT 200`,
  )
  for (const c of criticalOverdue) {
    const escTargets = await targets(c.managerId)
    if (escTargets.length === 0) continue
    for (const targetId of escTargets) {
      await createTaskIfMissing(
        creatorId,
        {
          assigneeId: targetId,
          title: `⚠ ESCALATION: ${c.title} — ${c.staffName} missed critical deadline (${c.daysLate}d)`,
          description: `Original task: "${c.title}"\nAssignee: ${c.staffName}\nDue: ${
            c.dueDate ? new Date(c.dueDate).toLocaleDateString() : ''
          }\nDays late: ${c.daysLate}\n\nReview and assist or reassign.`,
          priority: 'CRITICAL',
          category: 'EXCEPTION_RESOLUTION',
          dueDate: new Date(),
          // sourceKey includes date → one new escalation per day
          sourceKey: `critical-esc:${c.taskId}:${today}`,
        },
        result,
        'escalations',
      )
    }
  }

  // Rule 2: HIGH overdue > 2 days → weekly escalation.
  const highOverdue: any[] = await prisma.$queryRawUnsafe(
    `SELECT t."id" AS "taskId", t."title", t."dueDate", t."assigneeId",
            s."firstName" || ' ' || s."lastName" AS "staffName",
            s."managerId",
            EXTRACT(DAY FROM NOW() - t."dueDate")::int AS "daysLate"
       FROM "Task" t
       JOIN "Staff" s ON s."id" = t."assigneeId"
      WHERE t."priority"::text = 'HIGH'
        AND t."status"::text NOT IN ('DONE', 'CANCELLED')
        AND t."dueDate" IS NOT NULL
        AND t."dueDate" < NOW() - INTERVAL '2 days'
      LIMIT 200`,
  )
  for (const h of highOverdue) {
    const escTargets = await targets(h.managerId)
    if (escTargets.length === 0) continue
    for (const targetId of escTargets) {
      await createTaskIfMissing(
        creatorId,
        {
          assigneeId: targetId,
          title: `Overdue flag: ${h.title} — ${h.staffName} (${h.daysLate}d past due)`,
          description: `HIGH-priority task is more than 2 days overdue.\nAssignee: ${h.staffName}\nDue: ${
            h.dueDate ? new Date(h.dueDate).toLocaleDateString() : ''
          }`,
          priority: 'HIGH',
          category: 'EXCEPTION_RESOLUTION',
          dueDate: null,
          // sourceKey includes weekOf → at most one escalation per week
          sourceKey: `high-esc:${h.taskId}:${week}`,
        },
        result,
        'escalations',
      )
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function endOfTodayDate(): Date {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d
}

function formatMoney(n: number): string {
  return Math.round(n).toLocaleString()
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const runId = await startCronRun('daily-task-gen', 'schedule')

  const result: GenResult = {
    pm: 0,
    sales: 0,
    accounting: 0,
    leadership: 0,
    escalations: 0,
    skipped: 0,
    errors: [],
  }

  try {
    const creatorId = await resolveSystemCreator()
    if (!creatorId) {
      throw new Error('No active staff to act as system creator')
    }

    await generatePmTasks(creatorId, result)
    await generateSalesTasks(creatorId, result)
    await generateAccountingTasks(creatorId, result)
    await generateLeadershipTasks(creatorId, result)
    // Escalations run last so they pick up newly-overdue tasks created
    // earlier in the day's flow.
    await generateEscalations(creatorId, result)

    if (runId) {
      await finishCronRun(runId, 'SUCCESS', Date.now() - start, {
        result: { ...result, errors: result.errors.length },
      })
    }

    return NextResponse.json({
      success: true,
      ...result,
      created:
        result.pm +
        result.sales +
        result.accounting +
        result.leadership +
        result.escalations,
    })
  } catch (err: any) {
    console.error('[daily-task-gen] failed:', err)
    if (runId) {
      await finishCronRun(runId, 'FAILURE', Date.now() - start, {
        error: err?.message || 'unknown',
      })
    }
    return NextResponse.json(
      { error: err?.message || 'Generation failed', partial: result },
      { status: 500 },
    )
  }
}

// Suppress lint for the unused `crypto` import — kept available in case we
// move from `task_<base36>` IDs to `crypto.randomUUID()` later.
void crypto
