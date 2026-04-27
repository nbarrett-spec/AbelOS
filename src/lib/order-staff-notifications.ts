/**
 * Order status → staff notifications & tasks dispatcher.
 *
 * Phase 3 of AUTOMATIONS-HANDOFF.md (sections 3.2 / 3.3 / 3.4). Called
 * from the order PATCH route (and order POST for RECEIVED) after the
 * existing cascades + automation events. Fire-and-forget — never block
 * the source mutation.
 *
 * The CONFIRMED branch is intentionally absent here — it lives in the
 * onOrderConfirmed() cascade in src/lib/cascades/order-lifecycle.ts,
 * because the cascade is reached from multiple entry points and the
 * staff notifications are co-located with the Job creation that they
 * reference.
 *
 * Each branch is gated by a SystemAutomation toggle so admins can flip
 * individual notifications/tasks off from /ops/automations.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isSystemAutomationEnabled } from '@/lib/system-automations'
import {
  notifyStaff,
  getStaffByRole,
  getAssignedPM,
  getManagers,
  getSystemCreatorId,
} from '@/lib/notifications'

export interface OrderStaffEventContext {
  orderId: string
  orderNumber: string
  newStatus: string
  builderId: string
  builderName: string
  total: number
  /** Staff ID of the person who triggered the status change. Used as
   *  the assignee for the RECEIVED review task (defaults to system
   *  creator if missing). */
  staffId: string
}

const HIGH_VALUE_THRESHOLD = 5000

/**
 * Fire all status-specific staff notifications and tasks for an order
 * status change. Each gate is checked independently. Errors are logged
 * but never thrown — this is best-effort signal, not a control plane.
 */
export async function fireStaffNotifications(ctx: OrderStaffEventContext): Promise<void> {
  try {
    switch (ctx.newStatus) {
      case 'RECEIVED':
        await onReceived(ctx)
        break
      case 'IN_PRODUCTION':
        await onInProduction(ctx)
        break
      case 'READY_TO_SHIP':
        await onReadyToShip(ctx)
        break
      case 'SHIPPED':
        await onShipped(ctx)
        break
      case 'DELIVERED':
        await onDelivered(ctx)
        break
      case 'COMPLETE':
        await onComplete(ctx)
        break
      case 'CANCELLED':
        await onCancelled(ctx)
        break
      // CONFIRMED is handled in the onOrderConfirmed cascade — skip here.
      default:
        // Unknown / non-actionable status — silent.
        break
    }
  } catch (e) {
    logger.error('fireStaffNotifications_failed', e as Error, {
      orderId: ctx.orderId,
      newStatus: ctx.newStatus,
    })
  }
}

// ─── Per-status branches ────────────────────────────────────────────────

async function onReceived(ctx: OrderStaffEventContext): Promise<void> {
  // Notify all PMs of new order
  if (await isSystemAutomationEnabled('order.received.notify_pms')) {
    try {
      const pms = await getStaffByRole('PROJECT_MANAGER')
      if (pms.length > 0) {
        notifyStaff({
          staffIds: pms,
          type: 'JOB_UPDATE',
          title: `New order ${ctx.orderNumber} from ${ctx.builderName}`,
          body: `$${ctx.total.toLocaleString()} — review and confirm.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_received_pms_failed', err as Error, { ...ctx })
    }
  }

  // Task: review new order
  if (await isSystemAutomationEnabled('order.received.task_review')) {
    try {
      // Assignee = the person who created the order (likely a sales rep
      // or the order intake user). Fall back to system creator if no
      // staffId is available.
      const creatorId = await getSystemCreatorId()
      const assignee = ctx.staffId && ctx.staffId !== 'system' ? ctx.staffId : creatorId
      if (assignee && creatorId) {
        await insertSystemTask({
          assigneeId: assignee,
          creatorId,
          jobId: null,
          title: `Review order ${ctx.orderNumber} — verify pricing and terms`,
          description: `${ctx.builderName} — $${ctx.total.toLocaleString()}. Check pricing, payment terms, delivery date, and confirm.`,
          priority: 'HIGH',
          category: 'GENERAL',
          dueInterval: '1 day',
        })
      }
    } catch (err) {
      logger.error('staff_task_received_review_failed', err as Error, { ...ctx })
    }
  }
}

async function onInProduction(ctx: OrderStaffEventContext): Promise<void> {
  if (!(await isSystemAutomationEnabled('order.production.notify_pm'))) return
  try {
    const pmId = await getAssignedPM(ctx.orderId)
    if (!pmId) return
    notifyStaff({
      staffIds: [pmId],
      type: 'JOB_UPDATE',
      title: `Order ${ctx.orderNumber} in production`,
      body: `${ctx.builderName} order is now being built.`,
      link: `/ops/orders/${ctx.orderId}`,
    }).catch(() => {})
  } catch (err) {
    logger.error('staff_notify_in_production_failed', err as Error, { ...ctx })
  }
}

async function onReadyToShip(ctx: OrderStaffEventContext): Promise<void> {
  // Notify logistics — drivers + warehouse leads
  if (await isSystemAutomationEnabled('order.ready.notify_logistics')) {
    try {
      const drivers = await getStaffByRole('DRIVER')
      const warehouseLeads = await getStaffByRole('WAREHOUSE_LEAD')
      const recipients = Array.from(new Set([...drivers, ...warehouseLeads]))
      if (recipients.length > 0) {
        notifyStaff({
          staffIds: recipients,
          type: 'DELIVERY_UPDATE',
          title: `Order ${ctx.orderNumber} ready for delivery`,
          body: `${ctx.builderName} — stage for pickup/delivery.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_ready_logistics_failed', err as Error, { ...ctx })
    }
  }

  // Notify PM
  if (await isSystemAutomationEnabled('order.ready.notify_pm')) {
    try {
      const pmId = await getAssignedPM(ctx.orderId)
      if (pmId) {
        notifyStaff({
          staffIds: [pmId],
          type: 'DELIVERY_UPDATE',
          title: `Order ${ctx.orderNumber} ready to ship`,
          body: `Delivery record created. Confirm schedule with ${ctx.builderName}.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_ready_pm_failed', err as Error, { ...ctx })
    }
  }
}

async function onShipped(ctx: OrderStaffEventContext): Promise<void> {
  // Notify PM — confirm delivery within 24h
  if (await isSystemAutomationEnabled('order.shipped.notify_pm')) {
    try {
      const pmId = await getAssignedPM(ctx.orderId)
      if (pmId) {
        notifyStaff({
          staffIds: [pmId],
          type: 'DELIVERY_UPDATE',
          title: `Order ${ctx.orderNumber} shipped`,
          body: `Confirm delivery within 24h.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_shipped_pm_failed', err as Error, { ...ctx })
    }
  }

  // High-value: notify managers
  if (
    ctx.total >= HIGH_VALUE_THRESHOLD &&
    (await isSystemAutomationEnabled('order.shipped.notify_mgr_highvalue'))
  ) {
    try {
      const managers = await getManagers()
      if (managers.length > 0) {
        notifyStaff({
          staffIds: managers,
          type: 'DELIVERY_UPDATE',
          title: `High-value order ${ctx.orderNumber} shipped — $${ctx.total.toLocaleString()}`,
          body: `${ctx.builderName}. Track delivery confirmation.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_shipped_mgr_failed', err as Error, { ...ctx })
    }
  }
}

async function onDelivered(ctx: OrderStaffEventContext): Promise<void> {
  // Accounting: notification + invoice review task
  if (await isSystemAutomationEnabled('order.delivered.notify_accounting')) {
    try {
      const accounting = await getStaffByRole('ACCOUNTING')
      if (accounting.length > 0) {
        notifyStaff({
          staffIds: accounting,
          type: 'INVOICE_OVERDUE', // closest enum match for invoice events
          title: `Order ${ctx.orderNumber} delivered — DRAFT invoice created`,
          body: `${ctx.builderName}, $${ctx.total.toLocaleString()}. Review and issue.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})

        const creatorId = await getSystemCreatorId()
        if (creatorId) {
          await insertSystemTask({
            assigneeId: accounting[0], // routes to first active accounting member
            creatorId,
            jobId: null,
            title: `Review and issue invoice for ${ctx.orderNumber}`,
            description: `${ctx.builderName} — $${ctx.total.toLocaleString()}. DRAFT invoice auto-created. Verify line items, then move to ISSUED.`,
            priority: 'HIGH',
            category: 'INVOICE_FOLLOW_UP',
            dueInterval: '1 day',
          })
        }
      }
    } catch (err) {
      logger.error('staff_notify_delivered_accounting_failed', err as Error, { ...ctx })
    }
  }

  // PM: delivery QC task
  if (await isSystemAutomationEnabled('order.delivered.task_qc')) {
    try {
      const pmId = await getAssignedPM(ctx.orderId)
      const creatorId = await getSystemCreatorId()
      if (pmId && creatorId) {
        const jobs: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Job" WHERE "orderId" = $1 LIMIT 1`,
          ctx.orderId,
        )
        await insertSystemTask({
          assigneeId: pmId,
          creatorId,
          jobId: jobs[0]?.id || null,
          title: `Delivery QC — ${ctx.orderNumber}`,
          description: `Confirm delivery quality for ${ctx.builderName}. Check for damage, shortages, and get builder sign-off.`,
          priority: 'MEDIUM',
          category: 'QUALITY_REVIEW',
          dueInterval: '2 days',
        })
      }
    } catch (err) {
      logger.error('staff_task_delivered_qc_failed', err as Error, { ...ctx })
    }
  }
}

async function onComplete(ctx: OrderStaffEventContext): Promise<void> {
  // Managers: order-complete summary
  if (await isSystemAutomationEnabled('order.complete.notify_mgr')) {
    try {
      const managers = await getManagers()
      if (managers.length > 0) {
        notifyStaff({
          staffIds: managers,
          type: 'JOB_UPDATE',
          title: `Order ${ctx.orderNumber} complete`,
          body: `${ctx.builderName} — $${ctx.total.toLocaleString()}.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_complete_mgr_failed', err as Error, { ...ctx })
    }
  }

  // Sales: follow-up task
  if (await isSystemAutomationEnabled('order.complete.task_followup')) {
    try {
      const salesStaff = await getStaffByRole('SALES_REP')
      const creatorId = await getSystemCreatorId()
      const assignee = salesStaff[0] || (ctx.staffId !== 'system' ? ctx.staffId : null) || creatorId
      if (assignee && creatorId) {
        await insertSystemTask({
          assigneeId: assignee,
          creatorId,
          jobId: null,
          title: `Follow up with ${ctx.builderName} after order ${ctx.orderNumber}`,
          description: `Order complete. Schedule next touchpoint — check satisfaction and upcoming project needs.`,
          priority: 'LOW',
          category: 'BUILDER_COMMUNICATION',
          dueInterval: '7 days',
        })
      }
    } catch (err) {
      logger.error('staff_task_complete_followup_failed', err as Error, { ...ctx })
    }
  }
}

async function onCancelled(ctx: OrderStaffEventContext): Promise<void> {
  // PM: cleanup
  if (await isSystemAutomationEnabled('order.cancelled.notify_pm')) {
    try {
      const pmId = await getAssignedPM(ctx.orderId)
      if (pmId) {
        notifyStaff({
          staffIds: [pmId],
          type: 'JOB_UPDATE',
          title: `Order ${ctx.orderNumber} cancelled`,
          body: `${ctx.builderName}. Clean up linked Job and materials.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_cancelled_pm_failed', err as Error, { ...ctx })
    }
  }

  // Accounting: void DRAFT invoices
  if (await isSystemAutomationEnabled('order.cancelled.notify_accounting')) {
    try {
      const accounting = await getStaffByRole('ACCOUNTING')
      if (accounting.length > 0) {
        notifyStaff({
          staffIds: accounting,
          type: 'INVOICE_OVERDUE',
          title: `Order ${ctx.orderNumber} cancelled — check for DRAFT invoices`,
          body: `${ctx.builderName}. Void any unpaid invoices linked to this order.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_cancelled_accounting_failed', err as Error, { ...ctx })
    }
  }

  // Warehouse: release materials
  if (await isSystemAutomationEnabled('order.cancelled.notify_warehouse')) {
    try {
      const warehouse = await getStaffByRole('WAREHOUSE_LEAD')
      if (warehouse.length > 0) {
        notifyStaff({
          staffIds: warehouse,
          type: 'JOB_UPDATE',
          title: `Order ${ctx.orderNumber} cancelled — release materials`,
          body: `${ctx.builderName}. Return any pulled/reserved items to available stock.`,
          link: `/ops/orders/${ctx.orderId}`,
        }).catch(() => {})
      }
    } catch (err) {
      logger.error('staff_notify_cancelled_warehouse_failed', err as Error, { ...ctx })
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * INSERT a Task with system attribution. Writes both `creatorId`
 * (Prisma-modeled) and `createdById` (drifted column added by
 * sales/migrate). Matches the run-automations cron pattern.
 */
async function insertSystemTask(params: {
  assigneeId: string
  creatorId: string
  jobId: string | null
  title: string
  description: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  category: string
  dueInterval: string // Postgres INTERVAL literal e.g. '2 days'
}): Promise<void> {
  const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Task" (
      "id", "assigneeId", "creatorId", "jobId", "title", "description",
      "priority", "status", "category", "dueDate",
      "createdAt", "updatedAt", "createdById"
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7::"TaskPriority", 'TODO'::"TaskStatus", $8::"TaskCategory",
      (NOW() + ($9)::INTERVAL),
      NOW(), NOW(), $3
    )`,
    taskId,
    params.assigneeId,
    params.creatorId,
    params.jobId,
    params.title,
    params.description,
    params.priority,
    params.category,
    params.dueInterval,
  )
}
