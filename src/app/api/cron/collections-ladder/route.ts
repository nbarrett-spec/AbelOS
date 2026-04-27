/**
 * Cron: Collections Ladder
 *
 * Runs daily at 8am CT (1pm UTC). For each past-due Invoice, walks a fixed
 * Day-15 / Day-30 / Day-45 / Day-60 escalation ladder and fires the
 * appropriate action exactly once per step:
 *
 *   Day 15 — friendly reminder email to builder contact
 *   Day 30 — firm past-due email + InboxItem for Dawn
 *   Day 45 — final notice email + phone-call task for Dawn (InboxItem)
 *   Day 60 — account-hold InboxItem + email to builder contact AND Nate
 *
 * Idempotent: we check CollectionAction for a prior step of the same actionType
 * on the same invoice before firing, so re-runs are safe.
 *
 * Audit trail: every step writes a CollectionAction row (id, invoiceId,
 * actionType, channel, sentBy='cron:collections-ladder', notes, sentAt).
 *
 * Complementary to the older /api/cron/collections-cycle route, which does
 * rule-table-driven processing with approval gates and BuilderIntelligence
 * tone calibration. This ladder cron is the simpler, dumber, fire-and-log
 * worker that Dawn can reason about at a glance.
 *
 * Schedule: 0 13 * * * (8 AM Central standard, 1 PM UTC).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withCronRun } from '@/lib/cron'
import { sendDay15ReminderEmail } from '@/lib/email/collections/day-15-reminder'
import { sendDay30PastDueEmail } from '@/lib/email/collections/day-30-past-due'
import { sendDay45FinalNoticeEmail } from '@/lib/email/collections/day-45-final'
import { sendDay60HoldEmail } from '@/lib/email/collections/day-60-hold'

type LadderStep = 'DAY_15' | 'DAY_30' | 'DAY_45' | 'DAY_60'

// Ladder-step → CollectionAction.actionType mapping. The action type doubles
// as the idempotency key — we won't fire the same step twice on an invoice.
const STEP_ACTION: Record<LadderStep, string> = {
  DAY_15: 'REMINDER',
  DAY_30: 'PAST_DUE',
  DAY_45: 'FINAL_NOTICE',
  DAY_60: 'ACCOUNT_HOLD',
}

// Priority of the InboxItem created (Day-30 onward). Day-60 is CRITICAL
// because the account is going on hold — Nate needs to see it.
const STEP_PRIORITY: Record<LadderStep, string> = {
  DAY_15: 'LOW',
  DAY_30: 'MEDIUM',
  DAY_45: 'HIGH',
  DAY_60: 'CRITICAL',
}

interface OverdueInvoiceRow {
  id: string
  invoiceNumber: string
  builderId: string
  total: number
  amountPaid: number
  balanceDue: number
  status: string
  dueDate: Date
  builderName: string | null
  builderEmail: string | null
  builderContactName: string | null
  // Best contact for receiving this kind of email — prefers a BuilderContact
  // flagged receivesInvoice=true over the default Builder.email.
  invoiceContactEmail: string | null
  invoiceContactName: string | null
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

// Map days-past-due to the most advanced ladder step that applies. Invoices
// fire steps in order as they age past each threshold — Day-15 when 15-29,
// Day-30 when 30-44, etc. We don't skip steps; if an invoice appears for the
// first time at Day-32 (rare, manual import), it still fires Day-15 and
// Day-30 on the same run because CollectionAction is missing for both.
function stepsDue(daysPastDue: number): LadderStep[] {
  const steps: LadderStep[] = []
  if (daysPastDue >= 15) steps.push('DAY_15')
  if (daysPastDue >= 30) steps.push('DAY_30')
  if (daysPastDue >= 45) steps.push('DAY_45')
  if (daysPastDue >= 60) steps.push('DAY_60')
  return steps
}

async function fetchOverdueInvoices(): Promise<OverdueInvoiceRow[]> {
  const rows = await prisma.$queryRawUnsafe<OverdueInvoiceRow[]>(`
    SELECT
      i."id", i."invoiceNumber", i."builderId",
      i."total"::float AS "total",
      COALESCE(i."amountPaid", 0)::float AS "amountPaid",
      (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
      i."status"::text AS "status",
      i."dueDate",
      b."companyName" AS "builderName",
      b."email" AS "builderEmail",
      b."contactName" AS "builderContactName",
      ic."email" AS "invoiceContactEmail",
      ic."firstName" AS "invoiceContactName"
    FROM "Invoice" i
    LEFT JOIN "Builder" b ON b."id" = i."builderId"
    LEFT JOIN LATERAL (
      SELECT "email", "firstName"
      FROM "BuilderContact"
      WHERE "builderId" = i."builderId"
        AND "active" = true
        AND "email" IS NOT NULL
        AND "receivesInvoice" = true
      ORDER BY "isPrimary" DESC, "createdAt" ASC
      LIMIT 1
    ) ic ON true
    WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
      AND i."dueDate" IS NOT NULL
      AND i."dueDate" < NOW() - INTERVAL '14 days'
      AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
    ORDER BY i."dueDate" ASC
  `)
  return rows
}

async function alreadyFired(invoiceId: string, actionType: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "CollectionAction"
     WHERE "invoiceId" = $1 AND "actionType" = $2
     LIMIT 1`,
    invoiceId,
    actionType,
  )
  return rows.length > 0
}

async function logCollectionAction(
  invoiceId: string,
  actionType: string,
  channel: string,
  notes: string,
): Promise<string> {
  const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CollectionAction"
       ("id", "invoiceId", "actionType", "channel", "sentBy", "notes", "sentAt", "createdAt")
     VALUES ($1, $2, $3, $4, 'cron:collections-ladder', $5, NOW(), NOW())`,
    id,
    invoiceId,
    actionType,
    channel,
    notes,
  )
  return id
}

async function createInboxItem(args: {
  type: string
  title: string
  description: string
  priority: string
  entityType: string
  entityId: string
  financialImpact?: number
  dueBy?: Date
}): Promise<string> {
  const id = `inb_col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
       ("id", "type", "source", "title", "description", "priority", "status",
        "entityType", "entityId", "financialImpact", "dueBy",
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'collections-ladder', $3, $4, $5, 'PENDING',
             $6, $7, $8, $9, NOW(), NOW())`,
    id,
    args.type,
    args.title,
    args.description,
    args.priority,
    args.entityType,
    args.entityId,
    args.financialImpact ?? null,
    args.dueBy ?? null,
  )
  return id
}

// Total account balance across all open invoices — shown on the Day-60 email
// so the builder sees the full picture when the hold lands.
async function totalOutstandingForBuilder(builderId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ sum: number | null }>>(
    `SELECT COALESCE(SUM(i."total" - COALESCE(i."amountPaid", 0)), 0)::float AS "sum"
     FROM "Invoice" i
     WHERE i."builderId" = $1
       AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
       AND (i."total" - COALESCE(i."amountPaid", 0)) > 0`,
    builderId,
  )
  return Number(rows[0]?.sum ?? 0)
}

async function runLadder() {
  const invoices = await fetchOverdueInvoices()
  const now = new Date()

  let fired = 0
  let emailsSent = 0
  let inboxCreated = 0
  let skipped = 0
  let errors = 0
  const byStep: Record<LadderStep, number> = { DAY_15: 0, DAY_30: 0, DAY_45: 0, DAY_60: 0 }

  for (const inv of invoices) {
    const dueDate = new Date(inv.dueDate)
    const daysPastDue = daysBetween(now, dueDate)
    const steps = stepsDue(daysPastDue)
    if (steps.length === 0) continue

    // Pick the best contact: invoice-designated first, then builder.contactName,
    // then a generic fallback. Skip the email if we have no address at all.
    const contactEmail = inv.invoiceContactEmail || inv.builderEmail
    const contactName =
      inv.invoiceContactName || inv.builderContactName || inv.builderName || 'there'
    const builderName = inv.builderName || 'your account'

    for (const step of steps) {
      const actionType = STEP_ACTION[step]
      try {
        if (await alreadyFired(inv.id, actionType)) {
          skipped++
          continue
        }

        // Day-15 — friendly email only
        if (step === 'DAY_15') {
          if (!contactEmail) {
            // Can't email, log a note anyway so the ledger shows we tried.
            await logCollectionAction(
              inv.id,
              actionType,
              'NONE',
              `Day-15 ladder: no email on file. ${daysPastDue}d past due.`,
            )
            skipped++
            continue
          }
          const res = await sendDay15ReminderEmail({
            to: contactEmail,
            contactName,
            builderName,
            invoiceNumber: inv.invoiceNumber,
            balanceDue: Number(inv.balanceDue),
            originalDueDate: dueDate,
            daysPastDue,
          })
          if (res.success) emailsSent++
          await logCollectionAction(
            inv.id,
            actionType,
            'EMAIL',
            `Day-15 friendly reminder → ${contactEmail}${res.success ? '' : ' (send failed: ' + (res.error || 'unknown') + ')'}`,
          )
          fired++
          byStep.DAY_15++
          continue
        }

        // Day-30 — past-due email + InboxItem for Dawn
        if (step === 'DAY_30') {
          if (contactEmail) {
            const res = await sendDay30PastDueEmail({
              to: contactEmail,
              contactName,
              builderName,
              invoiceNumber: inv.invoiceNumber,
              balanceDue: Number(inv.balanceDue),
              originalDueDate: dueDate,
              daysPastDue,
            })
            if (res.success) emailsSent++
            await logCollectionAction(
              inv.id,
              actionType,
              'EMAIL',
              `Day-30 past-due → ${contactEmail}${res.success ? '' : ' (send failed: ' + (res.error || 'unknown') + ')'}`,
            )
          } else {
            await logCollectionAction(
              inv.id,
              actionType,
              'NONE',
              `Day-30: no email on file, inbox-only. ${daysPastDue}d past due.`,
            )
          }
          await createInboxItem({
            type: 'COLLECTION_ACTION',
            title: `Past-due 30d — ${inv.invoiceNumber} (${builderName})`,
            description: `${builderName} invoice ${inv.invoiceNumber} is ${daysPastDue} days past due. Balance ${formatMoney(Number(inv.balanceDue))}. Firm email sent; follow up if no response in 48h.`,
            priority: STEP_PRIORITY.DAY_30,
            entityType: 'Invoice',
            entityId: inv.id,
            financialImpact: Number(inv.balanceDue),
          })
          inboxCreated++
          fired++
          byStep.DAY_30++
          continue
        }

        // Day-45 — final notice + phone-call task for Dawn
        if (step === 'DAY_45') {
          if (contactEmail) {
            const res = await sendDay45FinalNoticeEmail({
              to: contactEmail,
              contactName,
              builderName,
              invoiceNumber: inv.invoiceNumber,
              balanceDue: Number(inv.balanceDue),
              originalDueDate: dueDate,
              daysPastDue,
            })
            if (res.success) emailsSent++
            await logCollectionAction(
              inv.id,
              actionType,
              'EMAIL',
              `Day-45 FINAL NOTICE → ${contactEmail}${res.success ? '' : ' (send failed: ' + (res.error || 'unknown') + ')'}`,
            )
          } else {
            await logCollectionAction(
              inv.id,
              actionType,
              'NONE',
              `Day-45: no email on file, phone-only. ${daysPastDue}d past due.`,
            )
          }
          // Phone-call task for Dawn — 2 business-day SLA.
          const callBy = new Date(now.getTime() + 2 * 86_400_000)
          await createInboxItem({
            type: 'COLLECTION_ACTION',
            title: `CALL — ${inv.invoiceNumber} (${builderName}) ${daysPastDue}d past due`,
            description: `${builderName} invoice ${inv.invoiceNumber}: ${daysPastDue} days past due, ${formatMoney(Number(inv.balanceDue))} balance. Final-notice email sent. Call ${contactName}${inv.invoiceContactEmail ? '' : ' (use builder phone on file)'} by end-of-day in 2 business days; confirm payment plan or escalate to Nate for account-hold decision.`,
            priority: STEP_PRIORITY.DAY_45,
            entityType: 'Invoice',
            entityId: inv.id,
            financialImpact: Number(inv.balanceDue),
            dueBy: callBy,
          })
          inboxCreated++
          fired++
          byStep.DAY_45++
          continue
        }

        // Day-60 — account hold + email both contact AND Nate
        if (step === 'DAY_60') {
          const accountTotal = await totalOutstandingForBuilder(inv.builderId)
          if (contactEmail) {
            const res = await sendDay60HoldEmail({
              to: contactEmail,
              contactName,
              builderName,
              invoiceNumber: inv.invoiceNumber,
              balanceDue: Number(inv.balanceDue),
              originalDueDate: dueDate,
              daysPastDue,
              totalOutstanding: accountTotal,
            })
            if (res.success) emailsSent++
            await logCollectionAction(
              inv.id,
              actionType,
              'EMAIL',
              `Day-60 HOLD notice → ${contactEmail}${res.success ? '' : ' (send failed: ' + (res.error || 'unknown') + ')'}`,
            )
          } else {
            await logCollectionAction(
              inv.id,
              actionType,
              'NONE',
              `Day-60: no email on file, inbox-only. ${daysPastDue}d past due.`,
            )
          }
          // Also email Nate with the same payload so he's in the loop before
          // anyone calls him about the hold.
          const nateRes = await sendDay60HoldEmail({
            to: 'n.barrett@abellumber.com',
            contactName: 'Nate',
            builderName,
            invoiceNumber: inv.invoiceNumber,
            balanceDue: Number(inv.balanceDue),
            originalDueDate: dueDate,
            daysPastDue,
            totalOutstanding: accountTotal,
          })
          if (nateRes.success) emailsSent++

          await createInboxItem({
            type: 'COLLECTION_ACTION',
            title: `ACCOUNT HOLD — ${builderName} (${formatMoney(accountTotal)} outstanding)`,
            description: `${builderName} is on delivery hold as of today. Triggering invoice ${inv.invoiceNumber}: ${daysPastDue} days past due, ${formatMoney(Number(inv.balanceDue))}. Total account balance ${formatMoney(accountTotal)}. Nate emailed; builder emailed. Stop all pending deliveries until cleared.`,
            priority: STEP_PRIORITY.DAY_60,
            entityType: 'Invoice',
            entityId: inv.id,
            financialImpact: accountTotal,
          })
          inboxCreated++
          fired++
          byStep.DAY_60++
          continue
        }
      } catch (e) {
        errors++
        logger.error('collections_ladder_step_failed', e, {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          step,
        })
      }
    }
  }

  return {
    invoicesScanned: invoices.length,
    actionsFired: fired,
    emailsSent,
    inboxCreated,
    alreadyDoneSkipped: skipped,
    errors,
    byStep,
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n)
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2026-04-27 fix: wrapper moved UP so the kill-switch path also writes a
  // CronRun row. Previously the kill-switch returned before withCronRun() ever
  // ran, which is why /admin/crons showed "never fired" despite a daily
  // schedule (zero rows in CronRun for 30+ days). Mirror pm-daily-digest's
  // pattern: SUCCESS skipped=true on kill-switch off so observability stays
  // honest.
  return withCronRun('collections-ladder', async () => {
    // ── Kill switch: collections ladder is OFF until explicitly enabled ──
    if (process.env.COLLECTIONS_EMAILS_ENABLED !== 'true') {
      return NextResponse.json({
        success: true,
        skipped: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skippedCount: 1,
        notes: 'Kill switch off: COLLECTIONS_EMAILS_ENABLED !== "true"',
        reason: 'Collections ladder disabled (set COLLECTIONS_EMAILS_ENABLED=true to enable)',
      })
    }

    const result = await runLadder()
    logger.info('collections_ladder_complete', result)
    return NextResponse.json({
      success: true,
      processed: result.invoicesScanned,
      succeeded: result.actionsFired,
      failed: result.errors,
      skipped: result.alreadyDoneSkipped,
      notes: `${result.actionsFired} actions fired (D15:${result.byStep.DAY_15} D30:${result.byStep.DAY_30} D45:${result.byStep.DAY_45} D60:${result.byStep.DAY_60}); ${result.emailsSent} emails sent, ${result.inboxCreated} inbox items created`,
      ...result,
      timestamp: new Date().toISOString(),
    })
  })
}
