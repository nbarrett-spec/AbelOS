export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { invalidateSystemAutomationCache } from '@/lib/system-automations'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/system-automations/seed
//
// Idempotent setup for the SystemAutomation table:
//   1. CREATE TABLE IF NOT EXISTS
//   2. CREATE UNIQUE INDEX IF NOT EXISTS
//   3. INSERT … ON CONFLICT (key) DO NOTHING for the canonical 39 rows
//
// Safe to run multiple times. New automations added to the seed list in
// future commits will land on the next POST. Existing rows (and their
// `enabled` toggles) are never overwritten.
//
// Auth: ADMIN only — this is a setup/migration endpoint.
// ──────────────────────────────────────────────────────────────────────────

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "SystemAutomation" (
    "id" TEXT PRIMARY KEY,
    "key" TEXT UNIQUE NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN DEFAULT true,
    "triggerStatus" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedBy" TEXT
  )
`

const INDEX_DDL = `
  CREATE UNIQUE INDEX IF NOT EXISTS "idx_system_automation_key"
    ON "SystemAutomation"("key")
`

interface SeedRow {
  id: string
  key: string
  name: string
  description: string
  category: string
  triggerStatus: string | null
  enabled: boolean
}

// All 39 seed rows. Phase 2 = sa_001..sa_022. Phase 3 staff notifications
// and tasks = sa_030..sa_046. Gaps intentional for future expansion.
const SEED_ROWS: SeedRow[] = [
  // ── Phase 2: Order lifecycle (existing hard-coded cascades) ────────────
  { id: 'sa_001', key: 'order.confirmed.create_job',       name: 'Create Job on Order Confirm',         description: 'Creates a Job row (JOB-YYYY-NNNN) linked to the order',                    category: 'Order Lifecycle', triggerStatus: 'CONFIRMED',     enabled: true },
  { id: 'sa_002', key: 'order.confirmed.pm_inbox',         name: 'PM Inbox: Job Assignment',            description: 'Creates an inbox item for PM to claim/schedule the job',                   category: 'Order Lifecycle', triggerStatus: 'CONFIRMED',     enabled: true },
  { id: 'sa_003', key: 'order.confirmed.email_builder',    name: 'Email Builder: Order Confirmed',      description: 'Sends confirmation email to builder contact',                              category: 'Builder Emails',  triggerStatus: 'CONFIRMED',     enabled: false },
  { id: 'sa_004', key: 'order.ready.create_delivery',      name: 'Create Delivery on Ready to Ship',    description: 'Creates a Delivery record (DEL-YYYY-NNNN) with SCHEDULED status',          category: 'Order Lifecycle', triggerStatus: 'READY_TO_SHIP', enabled: true },
  { id: 'sa_005', key: 'order.ready.schedule_entry',       name: 'Create Calendar Entry',               description: 'Creates a ScheduleEntry for the delivery date',                            category: 'Order Lifecycle', triggerStatus: 'READY_TO_SHIP', enabled: true },
  { id: 'sa_006', key: 'order.shipped.email_builder',      name: 'Email Builder: Order Shipped',        description: 'Sends "your order has shipped" email to builder',                          category: 'Builder Emails',  triggerStatus: 'SHIPPED',       enabled: false },
  { id: 'sa_007', key: 'order.delivered.create_invoice',   name: 'Create Invoice on Delivery',          description: 'Creates DRAFT invoice (INV-YYYY-NNNN) from order total',                   category: 'Order Lifecycle', triggerStatus: 'DELIVERED',     enabled: true },
  { id: 'sa_008', key: 'order.delivered.set_invoiced',     name: 'Set Payment Status to INVOICED',      description: 'Updates Order.paymentStatus to INVOICED',                                  category: 'Order Lifecycle', triggerStatus: 'DELIVERED',     enabled: true },
  { id: 'sa_009', key: 'order.delivered.email_builder',    name: 'Email Builder: Order Delivered',      description: 'Sends delivery confirmation email to builder',                             category: 'Builder Emails',  triggerStatus: 'DELIVERED',     enabled: false },
  { id: 'sa_010', key: 'order.complete.advance_job',       name: 'Advance Job to COMPLETE',             description: 'Moves linked Job to COMPLETE status',                                      category: 'Order Lifecycle', triggerStatus: 'COMPLETE',      enabled: true },
  { id: 'sa_011', key: 'order.complete.ensure_invoice',    name: 'Ensure Invoice Exists',               description: 'Creates invoice if missing (backfill safety net)',                         category: 'Order Lifecycle', triggerStatus: 'COMPLETE',      enabled: true },
  // ── Builder emails (master switch governed by BUILDER_INVOICE_EMAILS_ENABLED) ──
  { id: 'sa_012', key: 'order.received.email_builder',     name: 'Email Builder: Order Received',       description: 'Sends acknowledgment email when order is received',                        category: 'Builder Emails',  triggerStatus: 'RECEIVED',      enabled: false },
  { id: 'sa_013', key: 'order.complete.email_builder',     name: 'Email Builder: Thank You',            description: 'Sends thank-you email when order completes',                               category: 'Builder Emails',  triggerStatus: 'COMPLETE',      enabled: false },
  { id: 'sa_014', key: 'order.cancelled.email_builder',    name: 'Email Builder: Order Cancelled',      description: 'Notifies builder their order was cancelled',                               category: 'Builder Emails',  triggerStatus: 'CANCELLED',     enabled: false },
  // ── Proposed new automations (Phase 3B — all OFF by default) ───────────
  { id: 'sa_015', key: 'order.confirmed.check_inventory',     name: 'Check Inventory on Confirm',       description: 'Flags backorders and material shortages immediately',                       category: 'Inventory', triggerStatus: 'CONFIRMED',      enabled: false },
  { id: 'sa_016', key: 'order.confirmed.generate_pick_list',  name: 'Auto-Generate Pick List',          description: 'Creates warehouse pick list from order items',                              category: 'Warehouse', triggerStatus: 'CONFIRMED',      enabled: false },
  { id: 'sa_017', key: 'order.production.sla_timer',          name: 'Production SLA Timer',             description: 'Alerts PM if order sits in IN_PRODUCTION longer than configured window',    category: 'SLA',       triggerStatus: 'IN_PRODUCTION', enabled: false },
  { id: 'sa_018', key: 'order.ready.notify_builder',          name: 'Notify Builder: Delivery Scheduled', description: 'Sends delivery date/window to builder when order is ready to ship',       category: 'Builder Emails', triggerStatus: 'READY_TO_SHIP', enabled: false },
  { id: 'sa_019', key: 'order.shipped.delivery_watchdog',     name: 'Delivery Watchdog (24h)',          description: 'Alerts ops if no delivery confirmation within 24h of ship',                 category: 'SLA',       triggerStatus: 'SHIPPED',        enabled: false },
  { id: 'sa_020', key: 'order.delivered.create_qc_task',      name: 'Auto-Create QC Task',              description: 'Creates a QC inspection task for the delivered job',                         category: 'Quality',   triggerStatus: 'DELIVERED',     enabled: false },
  { id: 'sa_021', key: 'order.cancelled.release_inventory',   name: 'Release Reserved Inventory',       description: 'Returns reserved materials to available stock on cancel',                    category: 'Inventory', triggerStatus: 'CANCELLED',     enabled: false },
  { id: 'sa_022', key: 'order.cancelled.void_draft_invoice',  name: 'Void Draft Invoice on Cancel',     description: 'Automatically voids any linked DRAFT invoice',                               category: 'Finance',   triggerStatus: 'CANCELLED',     enabled: false },
  // ── Phase 3: Staff notifications (all ON by default) ───────────────────
  { id: 'sa_030', key: 'order.received.notify_pms',         name: 'Notify PMs: New Order Received',         description: 'All PMs get notified of new orders to review',                  category: 'Staff Notifications', triggerStatus: 'RECEIVED',       enabled: true },
  { id: 'sa_031', key: 'order.received.task_review',         name: 'Task: Review New Order',                description: 'Creates review task for the order creator',                     category: 'Staff Tasks',         triggerStatus: 'RECEIVED',       enabled: true },
  { id: 'sa_032', key: 'order.confirmed.notify_warehouse',   name: 'Notify Warehouse: Order Confirmed',     description: 'Warehouse leads get stock check / production alert',            category: 'Staff Notifications', triggerStatus: 'CONFIRMED',      enabled: true },
  { id: 'sa_033', key: 'order.confirmed.notify_accounting',  name: 'Notify Accounting: Order Confirmed',    description: 'Accounting gets heads-up on incoming invoice',                  category: 'Staff Notifications', triggerStatus: 'CONFIRMED',      enabled: true },
  { id: 'sa_034', key: 'order.confirmed.task_schedule',      name: 'Task: Schedule Delivery',               description: 'PM gets task to schedule delivery for the confirmed job',       category: 'Staff Tasks',         triggerStatus: 'CONFIRMED',      enabled: true },
  { id: 'sa_035', key: 'order.production.notify_pm',         name: 'Notify PM: In Production',              description: 'PM knows their order is being built',                           category: 'Staff Notifications', triggerStatus: 'IN_PRODUCTION',  enabled: true },
  { id: 'sa_036', key: 'order.ready.notify_logistics',       name: 'Notify Logistics: Ready to Ship',       description: 'Drivers + warehouse leads get staging notification',            category: 'Staff Notifications', triggerStatus: 'READY_TO_SHIP',  enabled: true },
  { id: 'sa_037', key: 'order.ready.notify_pm',              name: 'Notify PM: Ready to Ship',              description: 'PM knows delivery record was created',                          category: 'Staff Notifications', triggerStatus: 'READY_TO_SHIP',  enabled: true },
  { id: 'sa_038', key: 'order.shipped.notify_pm',            name: 'Notify PM: Order Shipped',              description: 'PM needs to confirm delivery within 24h',                       category: 'Staff Notifications', triggerStatus: 'SHIPPED',        enabled: true },
  { id: 'sa_039', key: 'order.shipped.notify_mgr_highvalue', name: 'Notify Managers: High-Value Shipped',   description: 'Managers alerted on orders $5K+ shipped',                       category: 'Staff Notifications', triggerStatus: 'SHIPPED',        enabled: true },
  { id: 'sa_040', key: 'order.delivered.notify_accounting',  name: 'Notify Accounting + Task: Invoice',     description: 'Accounting gets notification + task to review/issue invoice',   category: 'Staff Tasks',         triggerStatus: 'DELIVERED',      enabled: true },
  { id: 'sa_041', key: 'order.delivered.task_qc',            name: 'Task: Delivery QC Check',               description: 'PM gets task to verify delivery quality and builder sign-off',  category: 'Staff Tasks',         triggerStatus: 'DELIVERED',      enabled: true },
  { id: 'sa_042', key: 'order.complete.notify_mgr',          name: 'Notify Managers: Order Complete',       description: 'Managers get summary of completed order',                       category: 'Staff Notifications', triggerStatus: 'COMPLETE',       enabled: true },
  { id: 'sa_043', key: 'order.complete.task_followup',       name: 'Task: Sales Follow-Up',                 description: 'Sales rep gets task to follow up with builder',                 category: 'Staff Tasks',         triggerStatus: 'COMPLETE',       enabled: true },
  { id: 'sa_044', key: 'order.cancelled.notify_pm',          name: 'Notify PM: Order Cancelled',            description: 'PM needs to clean up linked Job',                              category: 'Staff Notifications', triggerStatus: 'CANCELLED',      enabled: true },
  { id: 'sa_045', key: 'order.cancelled.notify_accounting',  name: 'Notify Accounting: Order Cancelled',    description: 'Accounting voids any DRAFT invoices',                          category: 'Staff Notifications', triggerStatus: 'CANCELLED',      enabled: true },
  { id: 'sa_046', key: 'order.cancelled.notify_warehouse',   name: 'Notify Warehouse: Order Cancelled',     description: 'Warehouse releases pulled/reserved materials',                 category: 'Staff Notifications', triggerStatus: 'CANCELLED',      enabled: true },
]

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN'] })
  if (auth.error) return auth.error

  try {
    // 1. Ensure table + index exist (idempotent).
    await prisma.$executeRawUnsafe(TABLE_DDL)
    await prisma.$executeRawUnsafe(INDEX_DDL)

    // 2. Upsert all canonical rows. ON CONFLICT (key) DO NOTHING preserves
    // any admin-applied `enabled` overrides — we only ever ADD new rows
    // here, never reset the toggle state.
    let inserted = 0
    let skipped = 0
    for (const row of SEED_ROWS) {
      const result = await prisma.$executeRawUnsafe(
        `INSERT INTO "SystemAutomation"
           ("id", "key", "name", "description", "category", "enabled", "triggerStatus", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT ("key") DO NOTHING`,
        row.id,
        row.key,
        row.name,
        row.description,
        row.category,
        row.enabled,
        row.triggerStatus,
      )
      // $executeRawUnsafe returns the row count affected.
      if (Number(result) > 0) inserted++
      else skipped++
    }

    invalidateSystemAutomationCache()

    await audit(request, 'CREATE', 'SystemAutomation', undefined, {
      action: 'seed',
      totalRows: SEED_ROWS.length,
      inserted,
      skipped,
    })

    return NextResponse.json({
      success: true,
      totalRows: SEED_ROWS.length,
      inserted,
      skipped,
      message: `Seeded ${inserted} new automation rows (${skipped} already existed).`,
    })
  } catch (error: any) {
    console.error('POST /api/ops/system-automations/seed error:', error)
    return NextResponse.json(
      { error: error?.message || 'seed failed' },
      { status: 500 },
    )
  }
}
