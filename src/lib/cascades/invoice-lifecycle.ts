/**
 * Invoice Lifecycle Cascades
 *
 * Fired when an Invoice status transitions. The paid-cascade closes the loop
 * all the way back to Order.paymentStatus and Job.status, and drops an
 * InboxItem on the PM so the handoff isn't silent.
 *
 * Triggered from:
 *  - POST /api/ops/payments            (after the Invoice is marked PAID)
 *  - Hyphen payment webhook            (src/lib/integrations/hyphen.ts)
 *  - Cron: overdue sweep               (src/app/api/cron/invoice-overdue)
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

type CascadeResult = {
  ok: boolean
  action: string
  detail?: string
}

/**
 * onInvoicePaid — invoice balance hit 0. Cascade to Order and Job and notify PM.
 * Idempotent — running twice produces no additional writes beyond timestamps.
 */
export async function onInvoicePaid(invoiceId: string): Promise<CascadeResult> {
  try {
    const invRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."id", i."invoiceNumber", i."builderId", i."orderId", i."jobId",
              i."status"::text AS status, i."total", i."amountPaid"
       FROM "Invoice" i WHERE i."id" = $1 LIMIT 1`,
      invoiceId
    )
    if (invRows.length === 0) return { ok: false, action: 'onInvoicePaid', detail: 'invoice_not_found' }
    const inv = invRows[0]

    // Guard: only run when actually paid in full
    const total = Number(inv.total || 0)
    const paid = Number(inv.amountPaid || 0)
    if (paid + 0.005 < total) {
      return { ok: true, action: 'onInvoicePaid', detail: 'not_fully_paid' }
    }

    // Stamp paidAt / final status in a single txn with the downstream updates
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "Invoice"
         SET "status" = 'PAID'::"InvoiceStatus",
             "paidAt" = COALESCE("paidAt", NOW()),
             "balanceDue" = 0,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        invoiceId
      )

      if (inv.orderId) {
        await tx.$executeRawUnsafe(
          `UPDATE "Order"
           SET "paymentStatus" = 'PAID'::"PaymentStatus",
               "paidAt" = COALESCE("paidAt", NOW()),
               "updatedAt" = NOW()
           WHERE "id" = $1`,
          inv.orderId
        )
      }

      // Derive linked jobs either from invoice.jobId or via order
      const jobRows: any[] = inv.jobId
        ? await tx.$queryRawUnsafe(
            `SELECT "id", "status"::text AS status, "assignedPMId", "jobNumber"
             FROM "Job" WHERE "id" = $1`, inv.jobId
          )
        : inv.orderId
          ? await tx.$queryRawUnsafe(
              `SELECT "id", "status"::text AS status, "assignedPMId", "jobNumber"
               FROM "Job" WHERE "orderId" = $1`, inv.orderId
            )
          : []

      for (const job of jobRows) {
        if (['COMPLETE', 'INVOICED'].includes(job.status)) {
          await tx.$executeRawUnsafe(
            `UPDATE "Job" SET "status" = 'CLOSED'::"JobStatus", "updatedAt" = NOW() WHERE "id" = $1`,
            job.id
          )
        }
      }

      // PM inbox — one item per affected job, assigned to the PM when known.
      for (const job of jobRows) {
        await safeInboxInsert(tx, {
          type: 'PAYMENT_RECEIVED',
          source: 'invoice-lifecycle',
          title: `Paid — ${inv.invoiceNumber}`,
          description: `Invoice ${inv.invoiceNumber} fully paid. Job ${job.jobNumber} is now CLOSED.`,
          priority: 'LOW',
          entityType: 'Invoice',
          entityId: invoiceId,
          financialImpact: total,
          assignedTo: job.assignedPMId || undefined,
        })
      }

      // Audit
      await safeAuditInsert(tx, {
        staffId: 'system',
        action: 'INVOICE_PAID',
        entity: 'Invoice',
        entityId: invoiceId,
        details: { amount: total, orderId: inv.orderId, jobIds: jobRows.map((j: any) => j.id) },
        severity: 'INFO',
      })
    })

    return { ok: true, action: 'onInvoicePaid', detail: 'cascaded' }
  } catch (e: any) {
    logger.error('cascade_onInvoicePaid_failed', e, { invoiceId })
    return { ok: false, action: 'onInvoicePaid', detail: e?.message }
  }
}

/**
 * onInvoiceOverdue — called by a cron. Bumps status to OVERDUE if balance > 0
 * and dueDate is in the past, and opens a COLLECTION_ACTION InboxItem.
 * Safe to run repeatedly; we skip invoices that already have an active
 * COLLECTION_ACTION for this cycle (last 3 days).
 */
export async function onInvoiceOverdue(invoiceId: string): Promise<CascadeResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."id", i."invoiceNumber", i."builderId", i."total", i."amountPaid",
              i."status"::text AS status, i."dueDate",
              b."companyName" AS "builderName"
       FROM "Invoice" i
       LEFT JOIN "Builder" b ON b."id" = i."builderId"
       WHERE i."id" = $1`,
      invoiceId
    )
    if (rows.length === 0) return { ok: false, action: 'onInvoiceOverdue', detail: 'invoice_not_found' }
    const inv = rows[0]

    const balance = Number(inv.total || 0) - Number(inv.amountPaid || 0)
    if (balance <= 0) return { ok: true, action: 'onInvoiceOverdue', detail: 'no_balance' }
    if (!inv.dueDate || new Date(inv.dueDate) >= new Date()) {
      return { ok: true, action: 'onInvoiceOverdue', detail: 'not_past_due' }
    }

    if (inv.status !== 'OVERDUE') {
      await prisma.$executeRawUnsafe(
        `UPDATE "Invoice" SET "status" = 'OVERDUE'::"InvoiceStatus", "updatedAt" = NOW() WHERE "id" = $1`,
        invoiceId
      )
    }

    // Avoid churning duplicate inbox rows: if one opened in last 3 days, skip.
    const recent: any[] = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "InboxItem"
       WHERE "type" = 'COLLECTION_ACTION'
         AND "entityType" = 'Invoice'
         AND "entityId" = $1
         AND "status" = 'PENDING'
         AND "createdAt" > NOW() - INTERVAL '3 days'
       LIMIT 1`,
      invoiceId
    )
    if (recent.length === 0) {
      const daysOverdue = Math.floor(
        (Date.now() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      )
      await safeInboxInsert(prisma, {
        type: 'COLLECTION_ACTION',
        source: 'invoice-lifecycle',
        title: `Overdue ${daysOverdue}d — ${inv.invoiceNumber} ($${balance.toFixed(0)})`,
        description: `${inv.builderName || 'Unknown Builder'} invoice ${inv.invoiceNumber} is ${daysOverdue} days past due. Balance $${balance.toFixed(2)}.`,
        priority: daysOverdue > 30 ? 'HIGH' : 'MEDIUM',
        entityType: 'Invoice',
        entityId: invoiceId,
        financialImpact: balance,
      })
    }

    return { ok: true, action: 'onInvoiceOverdue', detail: 'marked_overdue' }
  } catch (e: any) {
    logger.error('cascade_onInvoiceOverdue_failed', e, { invoiceId })
    return { ok: false, action: 'onInvoiceOverdue', detail: e?.message }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

async function safeInboxInsert(db: any, item: {
  type: string
  source: string
  title: string
  description?: string
  priority?: string
  entityType?: string
  entityId?: string
  financialImpact?: number
  assignedTo?: string
}): Promise<void> {
  try {
    const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await db.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (
        "id", "type", "source", "title", "description",
        "priority", "status", "entityType", "entityId",
        "financialImpact", "assignedTo",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'PENDING', $7, $8,
        $9, $10,
        NOW(), NOW()
      )`,
      id, item.type, item.source, item.title, item.description || null,
      item.priority || 'MEDIUM', item.entityType || null, item.entityId || null,
      item.financialImpact ?? null, item.assignedTo ?? null,
    )
  } catch {
    // best-effort
  }
}

async function safeAuditInsert(db: any, params: {
  staffId: string
  action: string
  entity: string
  entityId?: string
  details?: Record<string, any>
  severity?: string
}): Promise<void> {
  try {
    const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await db.$executeRawUnsafe(
      `INSERT INTO "AuditLog" ("id", "staffId", "action", "entity", "entityId", "details", "severity", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())`,
      id, params.staffId, params.action, params.entity, params.entityId || null,
      params.details ? JSON.stringify(params.details) : '{}', params.severity || 'INFO',
    )
  } catch {
    // best-effort — audit table might not exist yet in dev
  }
}
